import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CandidateHandle, HeadExpectation, TurnEnvelope, TurnProposal, canonicalDigest, canonicalJson } from "../contracts.ts";
import type { AuthorizationPort, Failure, Result, TrustedApproval, TrustedContext } from "../ports.ts";
import { previewPolicy, resolvePolicy } from "../policy/policy-resolver.ts";
import { ResolverProposal, ResolverSnapshot } from "../policy/resolver-contracts.ts";

type Head = z.infer<typeof HeadExpectation>;
type Handle = z.infer<typeof CandidateHandle>;
type Mode = TrustedContext["mode"];
type Preview = Extract<ReturnType<typeof previewPolicy>, { ok: true }>["preview"];
type Entry = Pick<Head, "owner_id" | "session_id" | "branch_id" | "generation_id">;
type Endpoint = { entity_id: string; field: string };
type StoreState = { head: Head; mode: Mode; epoch: number };
type Bound = { head: Head; epoch: number; expires: number };
type Override = Bound & { instruction: string };
type Lease = Bound & { remaining: number; fields: Endpoint[] };
type Candidate = Bound & {
  handle: Handle;
  diff: { handle: Handle; preview: Preview; before: { entity_id: string; field: string; fact: z.infer<typeof ResolverSnapshot>["entities"][number]["surfaces"][number]["fact"] | null }[] };
  diffDigest: string;
  leaseTarget: Endpoint | null;
  oneTurn: boolean;
  grant: string | null;
  spent: boolean;
};
type Permit = { candidate_id: string; source: "approval" | "lease"; reference: string; diff_digest: string };
type Identity = Entry["owner_id"];
const ttl = 300_000;
const success = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(status: Failure["status"], message: string): Result<T> =>
  ({ ok: false, error: { status, message, retry: status === "STALE_REVISION" ? "refresh" : "none" } });
const deny = <T>(): Result<T> => fail("VALIDATION_FAILED", "Invalid or unavailable authorization target.");
const approvalNeeded = <T>(message = "The exact change needs authenticated approval."): Result<T> => fail("NEEDS_APPROVAL", message);
const same = (a: Parameters<typeof canonicalJson>[0], b: Parameters<typeof canonicalJson>[0]) => canonicalJson(a) === canonicalJson(b);
function identity(head: Entry) {
  const { owner_id, session_id, branch_id, generation_id } = head;
  return { owner_id, session_id, branch_id, generation_id };
}
function expected(head: Head) {
  return { ...identity(head), expected_revision: head.expected_revision, expected_policy_revision: head.expected_policy_revision };
}
function lowRisk(snapshot: ResolverSnapshot, preview: Preview): Endpoint | null {
  const item = preview.operations[0];
  if (preview.amendment || preview.route !== "remix" || preview.operations.length !== 1 ||
      !item || item.operation.kind !== "remix.assign" || item.effects.length !== 1) return null;
  const { entity_id, field } = item.operation;
  const effect = item.effects[0];
  if (effect?.entity_id !== entity_id || effect.field !== field || effect.change !== "write") return null;
  const entity = snapshot.entities.find((entry) => entry.id === entity_id);
  const surface = entity?.surfaces.find((entry) => entry.field === field);
  return entity?.origin === "remix" && surface?.owner === "remix" && surface.domain === "presentation" &&
    surface.risk === "low_reversible" && surface.direct_assignment && surface.fact.state === "present" &&
    surface.coverage === "complete" && typeof surface.fact.value === "string" && typeof item.operation.value === "string"
    ? { entity_id, field } : null;
}
function displayDiff(snapshot: ResolverSnapshot, handle: Handle, preview: Preview): Candidate["diff"] {
  const before = preview.operations.flatMap(({ effects }) => effects.filter(({ change }) => change === "write")
    .map(({ entity_id, field }) => ({ entity_id, field, fact: snapshot.entities.find(({ id }) => id === entity_id)
      ?.surfaces.find((surface) => surface.field === field)?.fact ?? null })));
  return { handle, preview, before };
}
function diffJson(diff: Candidate["diff"]): string {
  const value: unknown = JSON.parse(JSON.stringify(diff));
  return canonicalJson(z.json().parse(value));
}
function digestDiff(diff: Candidate["diff"]): string {
  return createHash("sha256").update(diffJson(diff)).digest("hex");
}

/** In-memory reference for #17. Callers authenticate principals before entering this boundary. */
export class Authority implements AuthorizationPort {
  private readonly states = new Map<string, StoreState>();
  private readonly overrides = new Map<string, Override>();
  private readonly leases = new Map<string, Lease>();
  private readonly candidates = new Map<string, Candidate>();
  private readonly requestCandidates = new Map<string, Candidate>();
  private readonly generations = new Map<string, Set<Head["generation_id"]>>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) { this.clock = clock; }

  private branch(head: Entry) { return canonicalJson([head.owner_id, head.session_id, head.branch_id]); }
  private request(head: Head, id: string) { return canonicalJson([this.branch(head), head.generation_id, id]); }

  /** Called by the coordinator on creation and publication, never from restored authorization data. */
  setHead(raw: Head, reason: "initialize" | "publish" | "restore" | "protected_scope"): Result<void> {
    const parsed = HeadExpectation.safeParse(raw);
    if (!parsed.success) return deny();
    const head = parsed.data;
    const key = this.branch(head);
    const old = this.states.get(key);
    if ((reason === "initialize") !== !old) return deny();
    if (old) {
      const changedGeneration = old.head.generation_id !== head.generation_id;
      if (changedGeneration !== (reason === "restore") ||
          head.expected_revision <= old.head.expected_revision ||
          (reason !== "restore" && head.expected_policy_revision < old.head.expected_policy_revision) ||
          (changedGeneration && this.generations.get(key)?.has(head.generation_id))) return deny();
    }
    const seen = this.generations.get(key) ?? new Set<Head["generation_id"]>();
    seen.add(head.generation_id);
    this.generations.set(key, seen);
    this.states.set(key, { head, mode: reason === "restore" ? "PLAY" : old?.mode ?? "PLAY",
      epoch: (old?.epoch ?? 0) + (reason === "restore" || reason === "protected_scope" ? 1 : 0) });
    return success(undefined);
  }

  private state(owner: Identity, head: Head): Result<StoreState> {
    if (owner !== head.owner_id) return deny();
    const state = this.states.get(this.branch(head));
    if (!state) return deny();
    return same(state.head, expected(head)) ? success(state) : fail("STALE_REVISION", "Refresh the session head.");
  }

  /** Only a verified human control handler may call this method. */
  control(owner: Identity, head: Head, requestId: string, command: string): Result<{ mode: Mode; instruction: string | null }> {
    const result = this.state(owner, head);
    if (!result.ok) return result;
    const state = result.value;
    if (command === "/play" || command === "/edit") {
      state.mode = command === "/play" ? "PLAY" : "EDITOR";
      if (command === "/play") state.epoch++;
      return success({ mode: state.mode, instruction: null });
    }
    const match = /^\/edit ([^\r\n]+)$/.exec(command);
    const instruction = match?.[1]?.trim();
    const key = this.request(head, requestId);
    if (!instruction || /(?:^|\s)\/(?:play|edit)(?:\s|$)/.test(instruction) || !/^request:[A-Za-z0-9._:-]+$/.test(requestId) ||
        this.overrides.has(key) || this.requestCandidates.has(key)) {
      return fail("NEEDS_CLARIFICATION", "Use a single explicit mode control for a fresh logical request.");
    }
    this.overrides.set(key, { head: state.head, epoch: state.epoch, expires: this.clock() + ttl, instruction });
    return success({ mode: "EDITOR", instruction });
  }

  finish(head: Head, requestId: string): void {
    const override = this.overrides.get(this.request(head, requestId));
    if (override) override.expires = 0;
  }

  private activeOverride(state: StoreState, requestId: string) {
    const override = this.overrides.get(this.request(state.head, requestId));
    return override && override.expires > this.clock() && override.epoch === state.epoch && same(override.head, state.head)
      ? override : undefined;
  }

  /** Only a verified human control handler may issue leases. */
  issueLease(owner: Identity, head: Head, fields: Endpoint[], duration: number, uses: number): Result<string> {
    const state = this.state(owner, head);
    if (!state.ok) return state;
    if (state.value.mode !== "EDITOR" || !Number.isSafeInteger(duration) || duration < 1 || duration > ttl ||
        !Number.isSafeInteger(uses) || uses < 1 || uses > 3 || fields.length < 1 || fields.length > 32 ||
        fields.some(({ entity_id, field }) => !/^remix:[A-Za-z0-9._:-]+$/.test(entity_id) ||
          !/^[a-z][a-z0-9_-]*:[A-Za-z0-9._:-]+$/.test(field))) return deny();
    const id = `lease:${randomUUID()}`;
    this.leases.set(id, { head: state.value.head, epoch: state.value.epoch, expires: this.clock() + duration,
      remaining: uses, fields: structuredClone(fields) });
    return success(id);
  }

  revokeLease(owner: Identity, id: string): Result<void> {
    const lease = this.leases.get(id);
    if (!lease || lease.head.owner_id !== owner) return deny();
    lease.remaining = 0;
    return success(undefined);
  }

  context(owner: Identity, head: Head, requestId: string): Result<TrustedContext> {
    const result = this.state(owner, head);
    if (!result.ok) return result;
    const state = result.value;
    const override = this.activeOverride(state, requestId);
    if (!override && this.overrides.has(this.request(state.head, requestId))) return approvalNeeded("The one-turn Editor instruction has ended.");
    return success({ owner_id: owner, head: structuredClone(state.head), mode: override ? "EDITOR" : state.mode });
  }

  /** Resolver entry for ordinary Play and read-only requests. Ignore supplied Editor evidence. */
  resolveWithoutGrant(owner: Identity, rawSnapshot: unknown, rawProposal: unknown) {
    const snapshot = ResolverSnapshot.safeParse(rawSnapshot);
    const proposal = ResolverProposal.safeParse(rawProposal);
    if (!snapshot.success || !proposal.success) return deny();
    const actual = this.context(owner, expected(proposal.data), proposal.data.request_id);
    if (!actual.ok) return actual;
    return resolvePolicy({ ...snapshot.data, mode: actual.value.mode, editor_authority: null }, proposal.data);
  }

  prepare(owner: Identity, rawSnapshot: unknown, rawProposal: unknown,
    approvalScope: string[]): Result<{ handle: Handle; diff_digest: string }> {
    const snapshot = ResolverSnapshot.safeParse(rawSnapshot);
    const proposal = ResolverProposal.safeParse(rawProposal);
    if (!snapshot.success || !proposal.success) {
      if (proposal.success && owner === proposal.data.owner_id) this.finish(expected(proposal.data), proposal.data.request_id);
      return deny();
    }
    const request = proposal.data;
    const trusted = this.context(owner, expected(request), request.request_id);
    if (!trusted.ok) {
      if (owner === request.owner_id) this.finish(expected(request), request.request_id);
      return trusted;
    }
    const state = this.states.get(this.branch(trusted.value.head));
    if (!state) return deny();
    const override = this.activeOverride(state, request.request_id);
    const key = this.request(state.head, request.request_id);
    const previous = this.requestCandidates.get(key);
    if (previous?.spent) return approvalNeeded("This logical request has already ended.");
    if (trusted.value.mode !== request.mode || request.mode !== "EDITOR") {
      this.finish(state.head, request.request_id);
      return approvalNeeded("The request needs a verified Editor control action.");
    }
    const result = previewPolicy({ ...snapshot.data, mode: trusted.value.mode, editor_authority: null }, request);
    if (!result.ok) {
      this.finish(trusted.value.head, request.request_id);
      return result;
    }
    const expires = Math.min(this.clock() + ttl, override?.expires ?? Infinity);
    const ruleIds = [...new Set([...result.preview.trace.rule_ids,
      ...(result.preview.amendment?.compiled.lineage.map(({ old_rule }) => old_rule.id) ?? [])])].sort();
    const scopedRules = ruleIds.map((id) => `scope:rule:${canonicalDigest(id)}`);
    const handle = CandidateHandle.safeParse({ ...trusted.value.head, version: "1.0.0", request_id: request.request_id,
      candidate_id: `candidate:${randomUUID()}`, proposal_digest: result.preview.proposal_digest,
      approval_scope: [...new Set([...approvalScope, ...scopedRules])].sort(), expires_at: new Date(expires).toISOString() });
    if (!handle.success) {
      this.finish(trusted.value.head, request.request_id);
      return deny();
    }
    if (override && request.amendment && !snapshot.data.compiler_context?.sources.some((source) =>
      source.origin === "editor" && source.provenance === "caller_recorded" && source.text === override.instruction)) {
      this.finish(state.head, request.request_id);
      return deny();
    }
    const diff = displayDiff(snapshot.data, handle.data, result.preview);
    const diffDigest = digestDiff(diff);
    const candidate = { handle: handle.data, head: trusted.value.head, epoch: state.epoch, expires,
      diff, diffDigest, leaseTarget: lowRisk(snapshot.data, result.preview), oneTurn: !!override, grant: null, spent: false };
    if (previous) previous.expires = 0;
    this.candidates.set(candidate.handle.candidate_id, candidate);
    this.requestCandidates.set(key, candidate);
    return success({ handle: structuredClone(handle.data), diff_digest: diffDigest });
  }

  private candidate(owner: Identity, id: string): Result<Candidate> {
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.head.owner_id !== owner) return deny();
    const state = this.state(owner, candidate.head);
    if (!state.ok) return state;
    if (candidate.spent || candidate.expires <= this.clock() || candidate.epoch !== state.value.epoch ||
        (candidate.oneTurn && !this.activeOverride(state.value, candidate.handle.request_id))) return approvalNeeded();
    return success(candidate);
  }

  /** Only the separately authenticated browser handler performs these actions. */
  display(owner: Identity, id: string): Result<{ diff: string; digest: string }> {
    const result = this.candidate(owner, id);
    return result.ok ? success({ diff: diffJson(result.value.diff), digest: result.value.diffDigest }) : result;
  }
  confirm(owner: Identity, id: string, digest: string): Result<TrustedApproval> {
    const result = this.candidate(owner, id);
    if (!result.ok) return result;
    const candidate = result.value;
    if (candidate.diffDigest !== digest || candidate.grant !== null) return approvalNeeded();
    candidate.grant = `grant:${randomUUID()}`;
    return success({ candidate: structuredClone(candidate.handle), owner_id: owner, grant_id: candidate.grant });
  }
  /** An authenticated tool may retrieve an existing reference within its authorized head. */
  lookupApproval(owner: Identity, head: Head, id: string): Result<TrustedApproval> {
    const current = this.state(owner, head);
    if (!current.ok) return current;
    const candidate = this.candidates.get(id);
    if (!candidate || !same(candidate.head, head)) return deny();
    const result = this.candidate(owner, id);
    if (!result.ok) return result;
    return candidate.grant ? success({ candidate: structuredClone(candidate.handle), owner_id: owner,
      grant_id: candidate.grant }) : approvalNeeded();
  }
  revokeCandidate(owner: Identity, id: string): Result<void> {
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.head.owner_id !== owner) return deny();
    candidate.spent = true;
    this.finish(candidate.head, candidate.handle.request_id);
    return success(undefined);
  }

  private permit(owner: Identity, permit: Permit): Result<Candidate> {
    const result = this.candidate(owner, permit.candidate_id);
    if (!result.ok) return result;
    const candidate = result.value;
    if (permit.diff_digest !== candidate.diffDigest) return approvalNeeded();
    if (permit.source === "approval") {
      return candidate.grant !== null && candidate.grant === permit.reference ? result : approvalNeeded();
    }
    if (permit.source !== "lease") return deny();
    const lease = this.leases.get(permit.reference);
    if (!lease || lease.head.owner_id !== owner || !same(identity(lease.head), identity(candidate.head)) ||
        lease.epoch !== candidate.epoch || lease.head.expected_policy_revision !== candidate.head.expected_policy_revision ||
        lease.expires <= this.clock() || lease.remaining < 1 || !candidate.leaseTarget ||
        !lease.fields.some((field) => same(field, candidate.leaseTarget))) return approvalNeeded();
    return result;
  }

  resolveApproved(owner: Identity, rawSnapshot: unknown, rawProposal: unknown, permit: Permit) {
    const result = this.permit(owner, permit);
    if (!result.ok) return result;
    const candidate = result.value;
    const snapshot = ResolverSnapshot.safeParse(rawSnapshot);
    const proposal = ResolverProposal.safeParse(rawProposal);
    if (!snapshot.success || !proposal.success || canonicalDigest(proposal.data) !== candidate.handle.proposal_digest) {
      return approvalNeeded("The proposal changed after preview.");
    }
    const consistent = { ...snapshot.data, mode: "EDITOR" as const, editor_authority: null };
    const preview = previewPolicy(consistent, proposal.data);
    if (!preview.ok) return preview;
    if (digestDiff(displayDiff(snapshot.data, candidate.handle, preview.preview)) !== candidate.diffDigest ||
        (permit.source === "lease" && !same(lowRisk(snapshot.data, preview.preview), candidate.leaseTarget))) return approvalNeeded();
    return resolvePolicy({ ...consistent, editor_authority: {
      proposal_digest: candidate.handle.proposal_digest, evidence_id: permit.reference,
    } }, proposal.data);
  }

  /** #18 must combine this conditional update with head and receipt publication. */
  consume(owner: Identity, head: Head, permit: Permit, requestId: string): Result<void> {
    const current = this.state(owner, head);
    if (!current.ok) return current;
    const target = this.candidates.get(permit.candidate_id);
    if (!target || !same(target.head, head)) return deny();
    const result = this.permit(owner, permit);
    if (!result.ok) return result;
    const candidate = result.value;
    if (candidate.handle.request_id !== requestId) return deny();
    if (permit.source === "lease") {
      const lease = this.leases.get(permit.reference);
      if (!lease) return approvalNeeded();
      lease.remaining--;
    }
    candidate.spent = true;
    this.finish(candidate.head, requestId);
    return success(undefined);
  }

  authorize(context: TrustedContext, envelope: TurnEnvelope, proposal: TurnProposal): Promise<Result<void>> {
    const e = TurnEnvelope.safeParse(envelope);
    const p = TurnProposal.safeParse(proposal);
    if (!e.success || !p.success || e.data.request_id !== p.data.request_id ||
        !same({ ...identity(e.data), request_id: e.data.request_id }, { ...identity(p.data), request_id: p.data.request_id }) ||
        !same(identity(context.head), identity(e.data))) return Promise.resolve(deny());
    const actual = this.context(context.owner_id, expected(e.data), e.data.request_id);
    if (!actual.ok) return Promise.resolve(actual);
    if (!same(actual.value.head, context.head) || !same(actual.value.head, expected(p.data))) {
      return Promise.resolve(fail("STALE_REVISION", "Refresh the session head."));
    }
    if (e.data.intent === "editor" && p.data.intent === "PLAY" || e.data.intent === "play" && p.data.intent === "EDITOR") {
      return Promise.resolve(fail("NEEDS_CLARIFICATION", "Separate Play and Editor intentions."));
    }
    const inspection = p.data.operations.every(({ kind }) => kind === "inspect.entity");
    if ((!inspection && (p.data.intent !== "PLAY" || actual.value.mode !== "PLAY" ||
        p.data.operations.some(({ kind }) => kind === "remix.assign"))) || actual.value.mode !== context.mode) {
      return Promise.resolve(approvalNeeded("Use resolver evidence to authorize the exact Editor request."));
    }
    return Promise.resolve(success(undefined));
  }

  verifyApproval(context: TrustedContext, handle: Handle, approval: TrustedApproval): Promise<Result<void>> {
    if (!CandidateHandle.safeParse(handle).success || !CandidateHandle.safeParse(approval.candidate).success ||
        typeof approval.grant_id !== "string") return Promise.resolve(deny());
    const result = this.candidate(context.owner_id, handle.candidate_id);
    if (!result.ok) return Promise.resolve(result);
    const candidate = result.value;
    if (approval.owner_id !== context.owner_id || !same(identity(context.head), identity(candidate.head))) {
      return Promise.resolve(deny());
    }
    if (!same(context.head, candidate.head)) return Promise.resolve(fail("STALE_REVISION", "Refresh the session head."));
    const actual = this.context(context.owner_id, candidate.head, candidate.handle.request_id);
    if (!actual.ok) return Promise.resolve(actual);
    return Promise.resolve(actual.value.mode === "EDITOR" && context.mode === actual.value.mode &&
      same(handle, candidate.handle) && same(approval.candidate, candidate.handle) &&
      candidate.grant === approval.grant_id ? success(undefined) : approvalNeeded());
  }
}

export type { Permit, Head };
