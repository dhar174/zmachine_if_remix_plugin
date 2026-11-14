import { createHash, randomUUID } from "node:crypto";
import { Authority } from "../auth/authority.ts";
import type { Permit } from "../auth/authority.ts";
import { CandidateHandle, HeadExpectation, RequestIdentity, TurnEnvelope, canonicalDigest, canonicalJson } from "../contracts.ts";
import type { Result } from "../ports.ts";
import { CompilationInput } from "../policy/directive-contracts.ts";
import { ResolverProposal } from "../policy/resolver-contracts.ts";
import type { EffectPlan, ResolverSnapshot } from "../policy/resolver-contracts.ts";
import { DurableReceipt, TurnImage, conflict, failure, invalid, limits, ok, stale } from "./contracts.ts";
import type { Access, FaultPoint, Stage, TurnExecutor } from "./contracts.ts";
import { buildImage, jsonEvent, supported, validateImage } from "./execution.ts";
import { SQLiteTurns, branchKey } from "./sqlite-turns.ts";
import type { TurnStore } from "./sqlite-turns.ts";

type Head = ReturnType<typeof expected>;
type Prepared = { kind: "prepared"; handle: CandidateHandle; diff: string; diff_digest: string };
type Preparation = Prepared | { kind: "committed"; record: DurableReceipt } |
  { kind: "inspection"; facts: readonly string[]; time_cost: 0 };
type Work = { image: TurnImage; stage: Stage; plan: EffectPlan; claim: string };
type Commit = Result<DurableReceipt>;
type BrowserOperations = Pick<Authority, "display" | "confirm" | "control" | "issueLease" | "revokeCandidate" | "revokeLease">;

function expected(item: HeadExpectation): HeadExpectation {
  const { owner_id, session_id, branch_id, generation_id, expected_revision, expected_policy_revision } = item;
  return { owner_id, session_id, branch_id, generation_id, expected_revision, expected_policy_revision };
}
function requestKey(item: RequestIdentity) {
  return canonicalJson(RequestIdentity.parse({
    owner_id: item.owner_id, session_id: item.session_id, branch_id: item.branch_id,
    generation_id: item.generation_id, request_id: item.request_id,
  }));
}
function validateAccess(access: Access, raw: unknown) {
  const envelope = TurnEnvelope.safeParse(raw);
  return envelope.success && branchKey(access) === branchKey(envelope.data) ? envelope.data : null;
}
function candidateView(stage: Stage): Prepared {
  return { kind: "prepared", handle: stage.handle, diff: stage.diff, diff_digest: stage.diff_digest };
}
class RejectPublication extends Error {
  readonly result: Extract<Result<never>, { ok: false }>;
  constructor(result: Extract<Result<never>, { ok: false }>) { super(result.error.message); this.result = result; }
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const timedOut = () => failure("ABORTED", "The candidate was cancelled or exceeded its deadline.", "same_request");
const unavailable = () => failure("ABORTED", "Turn storage or execution is unavailable. Retry the same request to check its receipt.", "same_request");

/** Application boundary. Access and compiler context come from the authenticated coordinator. */
export class TurnService {
  private readonly store: TurnStore;
  private readonly authority: Authority;
  private readonly inFlight = new Map<string, { digest: string; candidate: string; promise: Promise<Commit>; abort: AbortController }>();
  readonly browser: BrowserOperations;

  private readonly executor: TurnExecutor;
  private readonly clock: () => number;
  private readonly fault: (point: FaultPoint) => void;
  constructor(storage: string | TurnStore, executor: TurnExecutor,
    clock: () => number = Date.now, fault: (point: FaultPoint) => void = () => {}) {
    this.executor = executor;
    this.clock = clock;
    this.fault = fault;
    this.store = typeof storage === "string" ? new SQLiteTurns(storage) : storage;
    this.authority = new Authority(clock, this.store.authority);
    this.browser = {
      display: (...args) => this.atomic(() => this.authority.display(...args)),
      confirm: (...args) => this.atomic(() => this.authority.confirm(...args)),
      control: (...args) => this.atomic(() => this.authority.control(...args)),
      issueLease: (...args) => this.atomic(() => this.authority.issueLease(...args)),
      revokeCandidate: (...args) => this.atomic(() => this.authority.revokeCandidate(...args)),
      revokeLease: (...args) => this.atomic(() => this.authority.revokeLease(...args)),
    };
  }

  close(): void { this.store.close(); }

  private atomic<T>(run: () => Result<T>): Result<T> {
    try { return this.store.transaction(run); } catch (error) {
      return error instanceof RejectPublication ? error.result : unavailable();
    }
  }

  initialize(raw: unknown): Result<void> {
    const parsed = TurnImage.safeParse(raw);
    if (!parsed.success) return invalid();
    return this.atomic(() => {
      const image = parsed.data;
      const valid = validateImage(image, this.executor);
      if (!valid.ok) return valid;
      const set = this.authority.setHead(image.snapshot.head, "initialize");
      if (!set.ok) return set;
      this.store.initialize(image);
      return ok(undefined);
    });
  }

  lookupApproval(access: Access, head: Head, candidate: CandidateHandle["candidate_id"]) {
    if (branchKey(access) !== branchKey(head)) return invalid();
    return this.atomic(() => this.authority.lookupApproval(access.owner_id, head, candidate));
  }

  private snapshot(image: TurnImage, proposal: ResolverProposal, compiler: Stage["compiler"]): Result<ResolverSnapshot> {
    const native = this.executor.project(structuredClone(image), structuredClone(proposal));
    if (!native.ok) return native;
    const checkpoint = image.checkpoint;
    if (native.value && (native.value.identity.story_sha256 !== checkpoint.story_sha256 ||
        native.value.identity.runtime_build !== checkpoint.runtime_build ||
        native.value.identity.adapter_build !== checkpoint.adapter_build ||
        native.value.identity.checkpoint_format !== checkpoint.checkpoint_format ||
        native.value.pending.kind !== checkpoint.native_state.pending_input.kind)) return invalid();
    return ok({ ...image.snapshot, native: native.value, compiler_context: compiler });
  }

  prepareTurn(access: Access, rawEnvelope: unknown, rawProposal: unknown, trustedCompiler: unknown = null): Result<Preparation> {
    const envelope = validateAccess(access, rawEnvelope);
    if (!envelope) return invalid();
    const owner = access.owner_id;
    return this.atomic<Preparation>(() => {
      const id = requestKey(envelope);
      const envelopeHash = canonicalDigest(envelope);
      const prior = this.store.request(id);
      if (prior && prior.envelope !== envelopeHash) return conflict();
      if (prior?.receipt) return ok({ kind: "committed", record: prior.receipt });
      const image = this.store.head(access);
      const wanted = expected(envelope);
      if (!image) return invalid();
      if (canonicalDigest(image.snapshot.head) !== canonicalDigest(wanted)) return stale();
      const parsed = ResolverProposal.safeParse(rawProposal);
      const compiler = CompilationInput.nullable().safeParse(trustedCompiler);
      const reject = (result: Extract<Result<never>, { ok: false }>) => {
        this.authority.finish(wanted, envelope.request_id);
        return result;
      };
      if (!parsed.success || !compiler.success) return reject(invalid());
      const proposal = parsed.data;
      if (requestKey(proposal) !== id || canonicalDigest(expected(proposal)) !== canonicalDigest(wanted) ||
          Buffer.byteLength(canonicalJson([proposal, compiler.data])) > limits.checkpoint_bytes) return reject(invalid());
      const nativeInput = proposal.operations.find(({ kind }) => kind === "native.line" || kind === "native.character");
      if ((nativeInput?.kind === "native.line" && (envelope.input.kind !== "line" || envelope.input.text !== nativeInput.text)) ||
          (nativeInput?.kind === "native.character" &&
            (envelope.input.kind !== "character" || envelope.input.value !== nativeInput.value))) {
        return reject(failure("VALIDATION_FAILED", "The proposal does not match the request input boundary."));
      }
      const proposalHash = canonicalDigest(proposal);
      if (prior?.proposal && prior.proposal !== proposalHash) return conflict();
      if (prior?.cancelled) return timedOut();
      const inspect = !proposal.amendment && proposal.operations.every(({ kind }) => kind === "inspect.entity");
      if ((envelope.intent === "inspect") !== inspect && (envelope.intent === "inspect" || inspect && envelope.intent) ||
          (envelope.intent === "editor" && proposal.mode !== "EDITOR") || (envelope.intent === "play" && proposal.mode !== "PLAY")) {
        return reject(failure("NEEDS_CLARIFICATION", "Separate Play, Editor, and read-only requests."));
      }
      if (prior?.stage && Date.parse(prior.stage.handle.expires_at) > this.clock()) {
        if (canonicalDigest(prior.stage.compiler) !== canonicalDigest(compiler.data)) return conflict();
        return ok(candidateView(prior.stage));
      }
      if (prior?.claim) return failure("ABORTED", "The expired candidate still has an active execution.", "same_request");
      if (prior?.stage?.editor) {
        this.authority.finish(wanted, envelope.request_id);
        this.store.cancel(id);
        return failure("NEEDS_APPROVAL", "The Editor candidate expired. Prepare a fresh request.");
      }
      const snapshot = this.snapshot(image, proposal, compiler.data);
      if (!snapshot.ok) return reject(snapshot);
      const editor = proposal.mode === "EDITOR" && !inspect;
      let stage: Stage;
      if (editor) {
        const prepared = this.authority.prepare(owner, snapshot.value, proposal, []);
        if (!prepared.ok) return prepared;
        const display = this.authority.display(owner, prepared.value.handle.candidate_id);
        if (!display.ok) return reject(display);
        stage = { handle: prepared.value.handle, diff: display.value.diff, diff_digest: display.value.digest,
          proposal, compiler: compiler.data, editor };
      } else {
        const resolved = this.authority.resolveWithoutGrant(owner, snapshot.value, proposal);
        if (!resolved.ok) return reject(resolved);
        if (!supported(resolved.plan.operations)) return reject(failure("CAPABILITY_MISSING", "This operation has no complete executor."));
        if (inspect) {
          const readable = new Set(resolved.plan.operations.flatMap(({ effects }) => effects.filter(({ change }) => change === "read")
            .map(({ entity_id, field }) => canonicalJson([entity_id, field]))));
          const facts = image.snapshot.entities.flatMap(({ id: entity, surfaces }) => surfaces.flatMap(({ field, domain, coverage, fact }) =>
            domain === "presentation" && coverage === "complete" && fact.state === "present" && readable.has(canonicalJson([entity, field])) ?
              [canonicalJson({ entity, field, value: fact.value })] : []));
          this.authority.finish(wanted, envelope.request_id);
          return ok({ kind: "inspection", facts, time_cost: 0 });
        }
        const handle = CandidateHandle.parse({ ...wanted, version: "1.0.0", request_id: envelope.request_id,
          candidate_id: "candidate:" + randomUUID(), proposal_digest: proposalHash, approval_scope: [],
          expires_at: new Date(this.clock() + 300_000).toISOString() });
        const diff = canonicalJson(jsonEvent.parse({ handle, ...resolved.plan }));
        stage = { handle, diff, diff_digest: digest(diff), proposal, compiler: compiler.data, editor };
      }
      this.store.bind(id, envelopeHash, stage);
      return ok(candidateView(stage));
    });
  }

  private plan(access: Access, image: TurnImage, stage: Stage, permit: Permit | undefined): Result<EffectPlan> {
    const proposal = stage.proposal;
    if (canonicalDigest(proposal) !== stage.handle.proposal_digest || digest(stage.diff) !== stage.diff_digest) return invalid();
    if (Date.parse(stage.handle.expires_at) <= this.clock()) {
      return stage.editor ? failure("NEEDS_APPROVAL", "The Editor candidate expired.") : timedOut();
    }
    const snapshot = this.snapshot(image, proposal, stage.compiler);
    if (!snapshot.ok) return snapshot;
    const owner = access.owner_id;
    if (stage.editor && (!permit || permit.candidate_id !== stage.handle.candidate_id || permit.diff_digest !== stage.diff_digest)) {
      return failure("NEEDS_APPROVAL", "The exact candidate needs current Editor authority.");
    }
    const result = stage.editor && permit
      ? this.authority.resolveApproved(owner, snapshot.value, proposal, permit)
      : this.authority.resolveWithoutGrant(owner, snapshot.value, proposal);
    if (!result.ok) return result;
    if (!supported(result.plan.operations)) return failure("CAPABILITY_MISSING", "This operation has no complete executor.");
    if (result.plan.time === "native" && image.checkpoint.clocks.policy !== "native_running") {
      return failure("CAPABILITY_MISSING", "The native clock is paused.");
    }
    return ok(result.plan);
  }

  commitTurn(access: Access, rawEnvelope: unknown, candidateId: string, permit?: Permit): Promise<Commit> {
    const envelope = validateAccess(access, rawEnvelope);
    if (!envelope) return Promise.resolve(invalid());
    const id = requestKey(envelope);
    const hash = canonicalDigest(envelope);
    const active = this.inFlight.get(id);
    if (active) {
      if (active.digest !== hash) return Promise.resolve(conflict());
      return active.candidate === candidateId ? active.promise : Promise.resolve(invalid());
    }
    const result = this.atomic<Work | DurableReceipt>(() => {
      const request = this.store.request(id);
      if (request && request.envelope !== hash) return conflict();
      if (request?.receipt) return ok(request.receipt);
      const image = this.store.head(access);
      const wanted = expected(envelope);
      if (!image) return invalid();
      if (canonicalDigest(image.snapshot.head) !== canonicalDigest(wanted)) return stale();
      if (request?.cancelled) return timedOut();
      const stage = request?.stage;
      if (!stage || stage.handle.candidate_id !== candidateId || request?.claim ||
          request?.proposal !== stage.handle.proposal_digest || stage.handle.request_id !== envelope.request_id) return invalid();
      const plan = this.plan(access, image, stage, permit);
      if (!plan.ok) return plan;
      const claim = randomUUID();
      this.store.claim(id, claim);
      return ok({ image, stage, plan: plan.value, claim });
    });
    if (!result.ok) return Promise.resolve(result);
    if ("receipt" in result.value) return Promise.resolve(ok(result.value));
    const abort = new AbortController();
    const work = result.value;
    const boundPermit = permit ? structuredClone(permit) : undefined;
    const scope = { ...access };
    const promise = Promise.resolve().then(() => this.execute(scope, envelope, work, boundPermit, abort))
      .finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, { digest: hash, candidate: candidateId, promise, abort });
    return promise;
  }

  private async execute(access: Access, envelope: TurnEnvelope, work: Work, permit: Permit | undefined, abort: AbortController): Promise<Commit> {
    const { image, stage, plan, claim } = work;
    const id = requestKey(envelope);
    const timeout = setTimeout(() => abort.abort(), 5_000);
    const interrupted = new Promise<ReturnType<typeof timedOut>>((resolve) => {
      if (abort.signal.aborted) resolve(timedOut());
      else abort.signal.addEventListener("abort", () => resolve(timedOut()), { once: true });
    });
    try {
      if (abort.signal.aborted) return timedOut();
      const valid = validateImage(image, this.executor);
      if (!valid.ok) return valid;
      const executed = await Promise.race([
        this.executor.execute(structuredClone(image), structuredClone(plan), limits, abort.signal), interrupted,
      ]);
      if (!executed.ok) return executed;
      if (abort.signal.aborted) return timedOut();
      const next = buildImage(image, executed.value, plan, this.executor);
      if (!next.ok) return next;
      const candidate = next.value;
      const events = executed.value.events.map((event) => jsonEvent.parse(event));
      const receipt = DurableReceipt.parse({
        version: "1.0.0", rule_ids: plan.trace.rule_ids, capability_ids: plan.trace.capability_ids,
        recovery: { retry: "same_request", checkpoint: candidate.checkpoint.checkpoint_id },
        receipt: {
          ...RequestIdentity.parse(JSON.parse(id) as unknown), version: "1.0.0", status: "COMMITTED",
          revision: candidate.checkpoint.revision, policy_revision: candidate.checkpoint.policy_revision,
          pre_checkpoint: image.checkpoint.checkpoint_id, post_checkpoint: candidate.checkpoint.checkpoint_id,
          native_output: executed.value.output, event_ids: events.map(() => "event:" + randomUUID()),
          narration_facts: executed.value.facts, time_cost: plan.time === "overlay" ? 1 : executed.value.time_cost,
          in_fiction_result: executed.value.outcome, visibility: stage.editor ? "owner" : "player",
          warnings: plan.trace.semantic.filter(({ outcome }) => outcome === "best_effort").map(({ rule_id }) => "Best-effort judgment: " + rule_id),
        },
      });
      this.fault("before_checkpoint");
      const staged = this.atomic(() => {
        if (abort.signal.aborted) return timedOut();
        if (this.store.request(id)?.claim !== claim) return timedOut();
        this.store.insertCheckpoint(candidate, claim);
        return ok(undefined);
      });
      if (!staged.ok) return staged;
      this.fault("after_checkpoint");
      const committed = this.atomic(() => {
        if (abort.signal.aborted) return timedOut();
        const request = this.store.request(id);
        if (request?.claim !== claim || request.stage?.handle.candidate_id !== stage.handle.candidate_id) return timedOut();
        const current = this.store.head(access);
        if (!current || current.checkpoint.checkpoint_id !== image.checkpoint.checkpoint_id) return stale();
        const fresh = this.plan(access, current, request.stage, permit);
        if (!fresh.ok) return fresh;
        if (canonicalDigest(jsonEvent.parse(fresh.value)) !== canonicalDigest(jsonEvent.parse(plan))) return invalid();
        if (permit && stage.editor) {
          const consumed = this.authority.consume(access.owner_id, image.snapshot.head, permit, envelope.request_id);
          if (!consumed.ok) return consumed;
        }
        const updated = this.authority.setHead(candidate.snapshot.head, plan.amendment ? "protected_scope" : "publish");
        if (!updated.ok) throw new RejectPublication(updated);
        this.store.publish(id, claim, current, candidate, receipt, events);
        this.fault("before_commit");
        return ok(receipt);
      });
      if (committed.ok) this.fault("after_commit");
      return committed;
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
      this.atomic(() => {
        if (this.store.request(id)?.claim === claim) {
          this.store.claim(id, null);
          this.authority.finish(expected(envelope), envelope.request_id);
        }
        return ok(undefined);
      });
    }
  }

  cancelTurn(access: Access, rawEnvelope: unknown, candidateId: string): Result<void> {
    const envelope = validateAccess(access, rawEnvelope);
    if (!envelope) return invalid();
    const id = requestKey(envelope);
    const stopped = this.atomic(() => {
      const request = this.store.request(id);
      if (!request || request.envelope !== canonicalDigest(envelope)) return invalid();
      if (request.receipt || request.cancelled) return ok(undefined);
      if (request.stage?.handle.candidate_id !== candidateId) return invalid();
      if (request.stage.editor) this.authority.revokeCandidate(access.owner_id, candidateId);
      this.authority.finish(expected(envelope), envelope.request_id);
      this.store.cancel(id);
      return ok(undefined);
    });
    if (stopped.ok) this.inFlight.get(id)?.abort.abort();
    return stopped;
  }

  collectAbandoned(): Result<number> { return this.atomic(() => ok(this.store.collect(this.clock()))); }
}
