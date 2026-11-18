import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { capture, compilationRecord, compilerView, fixtureContext, launchRecord, preparedAction, publicHead,
  receiptView, requestAction, sessionRef, sourceRecord, subset, target } from "../fixture/session-contracts.ts";
import { fixtureGuards, fixtureImage, fixtureNativeWrite, fixtureRoom, fixtureStory } from "../fixture/synthetic-world.ts";
import { compileDirective, selectDirectiveSubset } from "../policy/directive-compiler.ts";
import type { CompilationProposal, ModelInterpretation, SupportedSubsetSelection } from "../policy/directive-contracts.ts";
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
type Work = { image: TurnImage; stage: Stage; plan: EffectPlan; claim: string; draft: boolean; permit: Permit | undefined };
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
const expiredEditor = () => failure("NEEDS_APPROVAL", "The Editor candidate expired. Prepare a fresh request.");
const cancelled = () => failure("ABORTED", "The candidate was cancelled. Prepare a fresh request.");
const unavailable =() => failure("ABORTED", "Turn storage or execution is unavailable. Retry the same request to check its receipt.", "same_request");

/** Application boundary. Access and compiler context come from the authenticated coordinator. */
export class TurnService {
  private readonly store: TurnStore;
  private readonly authority: Authority;
  private readonly inFlight = new Map<string, { digest: string; candidate: string; diff: string; promise: Promise<Commit>; abort: AbortController }>();
  private inTransaction = false;
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
    if (this.inTransaction) return run();
    try {
      return this.store.transaction(() => {
        this.inTransaction = true;
        try { return run(); } finally { this.inTransaction = false; }
      });
    } catch (error) {
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
      if (this.store.hasCheckpoint(image.checkpoint.checkpoint_id)) {
        return failure("VALIDATION_FAILED", "The checkpoint ID is already in use.");
      }
      const set = this.authority.setHead(image.snapshot.head, "initialize");
      if (!set.ok) return set;
      this.store.initialize(image);
      return ok(undefined);
    });
  }

  issueFixtureLaunch(owner: Access["owner_id"]): Result<string> {
    return this.atomic(() => {
      const handle = "launch:" + randomUUID();
      this.store.saveFixtureRecord("launch", handle, { owner, session: null, expires: this.clock() + 300_000 });
      return ok(handle);
    });
  }

  openFixture(owner: Access["owner_id"], handle: string): Result<z.infer<typeof fixtureContext>> {
    return this.atomic(() => {
      const entry = launchRecord.safeParse(this.store.fixtureRecord("launch", handle));
      if (!entry.success || entry.data.owner !== owner) return invalid();
      const launch = entry.data;
      if (launch.session) return this.readFixture({ owner_id: owner, ...launch.session });
      if (launch.expires <= this.clock()) return invalid();
      const image = fixtureImage(owner);
      const validated = validateImage(image, this.executor);
      if (!validated.ok) return validated;
      const set = this.authority.setHead(image.snapshot.head, "initialize");
      if (!set.ok) return set;
      this.store.initializeDraft(image);
      this.store.saveFixtureRecord("session", branchKey(image.snapshot.head), true);
      const session = sessionRef.parse({ session_id: image.snapshot.head.session_id, branch_id: image.snapshot.head.branch_id });
      this.store.saveFixtureRecord("launch", handle, { ...launch, session });
      return this.readFixture({ owner_id: owner, ...session });
    });
  }

  private fixtureBase(access: Access) {
    const active = this.store.head(access);
    const image = active ?? this.store.draft(access);
    return image?.checkpoint.story_sha256 === fixtureStory ? { image, draft: !active } : undefined;
  }

  private publicFixtureHead({ session_id, branch_id, generation_id, expected_revision, expected_policy_revision }: Head) {
    return publicHead.parse({ session_id, branch_id, generation_id, expected_revision, expected_policy_revision });
  }

  private fixtureRules(image: TurnImage) {
    const { invariants, generation_rules } = image.snapshot.policy.policy_amendment;
    return [...invariants.map((rule) => ({ ...rule, kind: "invariant" as const })),
      ...generation_rules.map((rule) => ({ ...rule, kind: "permission" as const }))];
  }

  readFixture(access: Access, requestId?: string): Result<z.infer<typeof fixtureContext>> {
    return this.atomic(() => {
      const base = this.fixtureBase(access);
      if (!base) return invalid();
      const { image, draft } = base;
      const mode = this.authority.context(access.owner_id, image.snapshot.head, requestId);
      if (!mode.ok) return mode;
      const head = this.publicFixtureHead(image.snapshot.head);
      const facts = image.snapshot.entities.flatMap(({ id: entity_id, surfaces }) =>
        surfaces.flatMap(({ field, coverage, domain, fact }) =>
          coverage === "complete" && domain === "presentation" && fact.state === "present" && typeof fact.value === "string"
            ? [{ entity_id, field, value: fact.value, evidence_id: fact.evidence_id }] : []));
      return ok(fixtureContext.parse({
        head, state: draft ? "draft" : "active", mode: mode.value.mode, story_sha256: fixtureStory,
        pending_input: draft ? null : image.checkpoint.native_state.pending_input.kind,
        operations: draft ? ["initial_directive"] : ["play", "editor_assignment", "policy_amendment", "inspect"],
        clocks: draft ? null : { native: image.checkpoint.clocks.native, overlay: image.checkpoint.clocks.overlay },
        facts: draft ? [] : facts,
        rules: this.fixtureRules(image).slice(0, 128).map(({ id, kind, source, supersedes }) =>
          ({ id, kind, source_id: source.source_id, supersedes })),
      }));
    });
  }

  recordFixtureSource(owner: Access["owner_id"], input: z.infer<typeof capture>): Result<string> {
    return this.atomic(() => {
      const { request_id, purpose, text, ...requested } = input;
      const head = HeadExpectation.parse({ owner_id: owner, ...requested });
      const base = this.fixtureBase(head);
      if (!base || !text.trim() || base.draft !== (purpose === "initial")) return invalid();
      if (canonicalDigest(base.image.snapshot.head) !== canonicalDigest(head)) return stale();
      const id = "source:" + randomUUID();
      const record = sourceRecord.parse({ head, request_id, purpose, source: {
        id, message_id: "message:" + randomUUID(), origin: purpose === "initial" ? "initial" : "editor",
        provenance: "caller_recorded", text,
      } });
      const control = this.authority.controlRecordedDirective(owner, head, request_id, {
        id, text, origin: purpose === "initial" ? "initial" : "editor",
      });
      if (!control.ok) return control;
      this.store.saveFixtureRecord("source", id, record);
      return ok(id);
    });
  }

  private fixtureCompilation(access: Access, ref: string) {
    const base = this.fixtureBase(access);
    if (!base) return invalid();
    const parsed = sourceRecord.safeParse(this.store.fixtureRecord("source", ref));
    if (!parsed.success || branchKey(parsed.data.head) !== branchKey(access)) return invalid();
    const record = parsed.data;
    const { image, draft } = base;
    if (draft !== (record.purpose === "initial") || canonicalDigest(image.snapshot.head) !== canonicalDigest(record.head)) return stale();
    const mode = this.authority.context(access.owner_id, record.head, record.request_id);
    if (!mode.ok) return mode;
    if (mode.value.mode !== "EDITOR") return failure("NEEDS_APPROVAL", "The recorded directive needs current Editor control.");
    const context = CompilationInput.parse({
      version: "1.0.0", head: record.head, policy_id: image.snapshot.policy.policy_id, story_sha256: fixtureStory,
      sources: [record.source], guards: fixtureGuards, active_rules: this.fixtureRules(image), history: image.snapshot.history,
    });
    const fields = image.snapshot.entities.flatMap(({ id: entity_id, surfaces }) =>
      surfaces.filter(({ direct_assignment }) => direct_assignment).map(({ field }) => ({ entity_id, field })));
    return ok({ context, record, fields });
  }

  fixtureCompilerView(access: Access, ref: string): Result<z.infer<typeof compilerView>> {
    return this.atomic(() => {
      const compiled = this.fixtureCompilation(access, ref);
      if (!compiled.ok) return compiled;
      const { record, context, fields } = compiled.value;
      return ok(compilerView.parse({ source_ref: ref, source_id: record.source.id, text: record.source.text,
        request_id: record.request_id, purpose: record.purpose, context_digest: canonicalDigest(context),
        active_rules: context.active_rules, guards: context.guards, fields,
      }));
    });
  }

  private fixtureEnvelope(access: Access, request: z.infer<typeof target>, action: z.infer<typeof requestAction>) {
    return TurnEnvelope.parse({ ...request, owner_id: access.owner_id, version: "1.0.0", intent: action.kind === "play" ? "play" : "editor",
      input: action.kind === "play" ? action.input : { kind: "line", text: action.source_ref } });
  }

  private prepareCompiledFixture(access: Access, envelope: TurnEnvelope, context: z.infer<typeof CompilationInput>,
    purpose: z.infer<typeof sourceRecord>["purpose"], compiled: CompilationProposal, interpretation: ModelInterpretation,
    selection: SupportedSubsetSelection | null): Result<Preparation> {
    const { bundle, clauses } = compiled;
    const assignments = bundle.world_patch.map(({ entity_id, field, value }) => ({ kind: "remix.assign", entity_id, field, value }));
    if (assignments.some(({ value, entity_id }) => entity_id !== fixtureRoom || typeof value !== "string" || value.length > 256)) {
      return failure("CAPABILITY_MISSING", "Fixture assignments require a short string on a registered room field.");
    }
    const assignmentOnly = purpose === "assignment";
    if (assignmentOnly && (assignments.length !== 1 || clauses.some(({ entries }) => entries.some(({ kind }) => kind !== "assignment")))) {
      return failure("NEEDS_CLARIFICATION", "Use a single fixture assignment, or record the policy amendment separately.");
    }
    const { generation_rules, invariants } = bundle.policy_amendment;
    if (purpose === "amendment" && (!generation_rules.length && !invariants.length && !bundle.preferences.length || assignments.length > 0)) {
      return failure("NEEDS_CLARIFICATION", "Record an explicit policy amendment independently of a one-time assignment.");
    }
    const proposal = {
      ...expected(envelope), version: "1.0.0", request_id: envelope.request_id, mode: "EDITOR",
      operations: assignmentOnly ? assignments : [],
      declared_effects: assignments.map(({ entity_id, field }) => ({ entity_id, field, change: "write" })),
      amendment: assignmentOnly ? null : { compiled, interpretation, selection },
    };
    return this.prepareTurn(access, envelope, proposal, context);
  }

  prepareFixture(access: Access, request: z.infer<typeof target>, action: z.infer<typeof preparedAction>, browserAvailable: boolean):
    Result<Preparation | { kind: "inactive"; proposal: CompilationProposal }> {
    return this.atomic<Preparation | { kind: "inactive"; proposal: CompilationProposal }>(() => {
      const base = this.fixtureBase(access);
      if (!base) return invalid();
      if (action.kind === "mixed") return failure("NEEDS_CLARIFICATION", "Separate the Play attempt and Editor instruction.");
      const envelope = this.fixtureEnvelope(access, request, action);
      const id = requestKey(envelope);
      const prior = this.store.request(id);
      if (prior && prior.envelope !== canonicalDigest(envelope)) return conflict();
      if (action.kind === "play") {
        if (prior?.receipt) return ok({ kind: "committed", record: prior.receipt });
        if (base.draft) return failure("NEEDS_APPROVAL", "Approve the initial directive before Play.");
        const input = action.input;
        const pending = base.image.checkpoint.native_state.pending_input.kind;
        if (input.kind !== pending) return failure("CAPABILITY_MISSING", "Fixture input does not match the pending boundary.");
        const operation = input.kind === "line" ? { kind: "native.line", text: input.text } :
          { kind: "native.character", value: input.value };
        return this.prepareTurn(access, envelope, { ...expected(envelope), version: "1.0.0", request_id: envelope.request_id,
          mode: "PLAY", operations: [operation], declared_effects: [fixtureNativeWrite], amendment: null });
      }
      const existing = compilationRecord.safeParse(this.store.fixtureRecord("compilation", action.source_ref));
      if (existing.success && (branchKey(existing.data.proposal.head) !== branchKey(access) ||
          canonicalDigest(existing.data.interpretation) !== canonicalDigest(action.interpretation))) {
        return branchKey(existing.data.proposal.head) === branchKey(access) ? conflict() : invalid();
      }
      if (prior?.receipt) return existing.success ? ok({ kind: "committed", record: prior.receipt }) : invalid();
      if (!browserAvailable) return failure("NEEDS_APPROVAL", "Authenticated browser control is unavailable.");
      const trusted = this.fixtureCompilation(access, action.source_ref);
      if (!trusted.ok) return trusted;
      const { record, context } = trusted.value;
      if (id !== requestKey({ ...record.head, request_id: record.request_id }) || canonicalDigest(record.head) !== canonicalDigest(expected(envelope))) return invalid();
      const result = existing.success ? ok(existing.data.proposal) : compileDirective(context, action.interpretation);
      if (!result.ok) {
        const diagnostic = "diagnostics" in result ? result.diagnostics[0] : undefined;
        return failure(diagnostic?.code === "stale_context" ? "STALE_REVISION" : "VALIDATION_FAILED",
          diagnostic ? diagnostic.code + ": " + diagnostic.message : "Invalid directive interpretation.");
      }
      const compiled = result.value;
      if (!existing.success) this.store.saveFixtureRecord("compilation", action.source_ref, { interpretation: action.interpretation, proposal: compiled });
      if (base.draft) {
        if (prior?.stage && Date.parse(prior.stage.handle.expires_at) > this.clock()) return ok(candidateView(prior.stage));
        if (prior?.stage) return expiredEditor();
        return ok({ kind: "inactive", proposal: compiled });
      }
      if (compiled.clauses.some(({ status }) => status !== "supported")) {
        this.authority.finish(record.head, record.request_id);
        if (compiled.diagnostics.some(({ code }) => code === "policy_conflict")) {
          return failure("POLICY_CONFLICT", "A recorded directive conflicts with the current protected policy.");
        }
        return failure("NEEDS_CLARIFICATION", "Record a fully supported Editor instruction separately.");
      }
      return this.prepareCompiledFixture(access, envelope, context, record.purpose, compiled, action.interpretation, null);
    });
  }

  private fixtureSubset(owner: Access["owner_id"], ref: string) {
    const parsed = sourceRecord.safeParse(this.store.fixtureRecord("source", ref));
    if (!parsed.success || parsed.data.head.owner_id !== owner || parsed.data.purpose !== "initial") return invalid();
    const { head } = parsed.data;
    const trusted = this.fixtureCompilation(head, ref);
    if (!trusted.ok) return trusted;
    const compiled = compilationRecord.safeParse(this.store.fixtureRecord("compilation", ref));
    return compiled.success ? ok({ ...trusted.value, ...compiled.data }) : invalid();
  }

  readFixtureSubset(owner: Access["owner_id"], ref: string): Result<CompilationProposal> {
    return this.atomic(() => {
      const current = this.fixtureSubset(owner, ref);
      return current.ok ? ok(current.value.proposal) : current;
    });
  }

  selectFixtureSubset(owner: Access["owner_id"], selection: z.infer<typeof subset>): Result<Preparation> {
    return this.atomic(() => {
      const current = this.fixtureSubset(owner, selection.source_ref);
      if (!current.ok) return current;
      const { record, context, proposal, interpretation } = current.value;
      if (selection.proposal_digest !== proposal.digest) return invalid();
      const selected = { version: "1.0.0" as const, proposal_digest: selection.proposal_digest, clause_ids: selection.clause_ids };
      const result = selectDirectiveSubset(context, interpretation, selected);
      if (!result.ok) return failure("NEEDS_CLARIFICATION", "Select a coherent supported subset from the displayed proposal.");
      const targetHead = this.publicFixtureHead(record.head);
      const envelope = this.fixtureEnvelope(record.head, { ...targetHead, request_id: record.request_id },
        { kind: "directive", source_ref: selection.source_ref });
      return this.prepareCompiledFixture(record.head, envelope, context, "initial", result.value, interpretation, selected);
    });
  }

  commitFixture(access: Access, request: z.infer<typeof target>, action: z.infer<typeof requestAction>,
    candidate: string, diff: string, browserAvailable: boolean): Promise<Commit> {
    const owned = this.atomic(() => this.store.fixtureRecord("session", branchKey(access)) === true ? ok(undefined) : invalid());
    if (!owned.ok) return Promise.resolve(owned);
    return this.commitTurn(access, this.fixtureEnvelope(access, request, action), candidate, undefined, { diff, browserAvailable });
  }

  fixtureHistory(access: Access, identity?: Pick<z.infer<typeof target>, "generation_id" | "request_id">,
    limit = 10): Result<z.infer<typeof receiptView>[]> {
    return this.atomic(() => {
      const base = this.fixtureBase(access);
      if (!base) return invalid();
      if (identity) {
        const receipt = this.store.request(requestKey({ owner_id: access.owner_id, session_id: access.session_id,
          branch_id: access.branch_id, ...identity }))?.receipt;
        return receipt ? ok([this.viewFixtureReceipt(receipt)]) : ok([]);
      }
      return ok(this.store.fixtureReceipts(access, limit).map((record) => this.viewFixtureReceipt(record)));
    });
  }

  viewFixtureReceipt(record: DurableReceipt): z.infer<typeof receiptView> {
    const {
      version, session_id, branch_id, generation_id, request_id, status, revision, policy_revision,
      native_output, event_ids, narration_facts, time_cost, in_fiction_result, warnings,
    } = record.receipt;
    return receiptView.parse({ version, session_id, branch_id, generation_id, request_id, status, revision, policy_revision,
      native_output, event_ids, narration_facts, time_cost, in_fiction_result, warnings,
      rule_ids: record.rule_ids, capability_ids: record.capability_ids });
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
      const parsed = ResolverProposal.safeParse(rawProposal);
      const compiler = CompilationInput.nullable().safeParse(trustedCompiler);
      if (prior?.proposal && (!parsed.success || !compiler.success ||
          prior.proposal !== canonicalDigest(parsed.data) ||
          (prior.stage && canonicalDigest(prior.stage.compiler) !== canonicalDigest(compiler.data)))) return conflict();
      const live = this.store.head(access);
      const image = live ?? this.store.draft(access);
      const wanted = expected(envelope);
      if (!image) return invalid();
      if (canonicalDigest(image.snapshot.head) !== canonicalDigest(wanted)) return stale();
      if (prior?.disposition === "expired") return expiredEditor();
      if (prior?.disposition === "cancelled") return cancelled();
      const reject = (result: Extract<Result<never>, { ok: false }>) => {
        this.authority.finish(wanted, envelope.request_id);
        return result;
      };
      if (!parsed.success || !compiler.success) return reject(invalid());
      const proposal = parsed.data;
      if (!live && (envelope.intent !== "editor" || proposal.mode !== "EDITOR" ||
          !proposal.amendment?.selection || !compiler.data?.sources.every(({ origin }) => origin === "initial"))) {
        return reject(failure("NEEDS_APPROVAL", "The fixture draft requires an approved initial directive."));
      }
      if (requestKey(proposal) !== id || canonicalDigest(expected(proposal)) !== canonicalDigest(wanted) ||
          Buffer.byteLength(canonicalJson([proposal, compiler.data])) > limits.checkpoint_bytes) return reject(invalid());
      const nativeInput = proposal.operations.find(({ kind }) => kind === "native.line" || kind === "native.character");
      if ((nativeInput?.kind === "native.line" && (envelope.input.kind !== "line" || envelope.input.text !== nativeInput.text)) ||
          (nativeInput?.kind === "native.character" &&
            (envelope.input.kind !== "character" || envelope.input.value !== nativeInput.value))) {
        return reject(failure("VALIDATION_FAILED", "The proposal does not match the request input boundary."));
      }
      const proposalHash = canonicalDigest(proposal);

      const inspect = !proposal.amendment && proposal.operations.every(({ kind }) => kind === "inspect.entity");
      if ((envelope.intent === "inspect") !== inspect && (envelope.intent === "inspect" || inspect && envelope.intent) ||
          (envelope.intent === "editor" && proposal.mode !== "EDITOR") || (envelope.intent === "play" && proposal.mode !== "PLAY")) {
        return reject(failure("NEEDS_CLARIFICATION", "Separate Play, Editor, and read-only requests."));
      }
      if (prior?.stage && Date.parse(prior.stage.handle.expires_at) > this.clock()) {

        return ok(candidateView(prior.stage));
      }
      if (prior?.claim) return failure("ABORTED", "The expired candidate still has an active execution.", "same_request");
      if (prior?.stage?.editor) {
        this.authority.finish(wanted, envelope.request_id);
        this.store.cancel(id, "expired");
        return expiredEditor();
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

  commitTurn(access: Access, rawEnvelope: unknown, candidateId: string, permit?: Permit,
    exact?: { diff: string; browserAvailable: boolean }): Promise<Commit> {
    const envelope = validateAccess(access, rawEnvelope);
    if (!envelope) return Promise.resolve(invalid());
    const id = requestKey(envelope);
    const hash = canonicalDigest(envelope);
    const active = this.inFlight.get(id);
    if (active) {
      if (active.digest !== hash) return Promise.resolve(conflict());
      return active.candidate === candidateId && (!exact || exact.diff === active.diff)
        ? active.promise : Promise.resolve(invalid());
    }
    const result = this.atomic<Work | DurableReceipt>(() => {
      const request = this.store.request(id);
      if (request && request.envelope !== hash) return conflict();
      if (request?.receipt) {
        if (exact && (request.committed_candidate !== candidateId || request.committed_digest !== exact.diff)) return invalid();
        return ok(request.receipt);
      }
      if (exact && (!request || (request.stage && request.stage.handle.candidate_id !== candidateId))) return invalid();
      const live = this.store.head(access);
      const image = live ?? this.store.draft(access);
      const wanted = expected(envelope);
      if (!image) return invalid();
      if (canonicalDigest(image.snapshot.head) !== canonicalDigest(wanted)) return stale();
      if (request?.disposition === "expired") return expiredEditor();
      if (request?.disposition === "cancelled") return cancelled();
      const stage = request?.stage;
      if (!stage || stage.handle.candidate_id !== candidateId || request?.claim ||
          request?.proposal !== stage.handle.proposal_digest || stage.handle.request_id !== envelope.request_id) return invalid();
      if (exact && stage.diff_digest !== exact.diff) return invalid();
      if (!live && !stage.proposal.amendment?.selection) return invalid();
      let selectedPermit = permit;
      if (exact && stage.editor) {
        if (!exact.browserAvailable) return failure("NEEDS_APPROVAL", "Authenticated browser control is unavailable.");
        const approval = this.authority.lookupApproval(access.owner_id, wanted, stage.handle.candidate_id);
        if (!approval.ok) return approval;
        selectedPermit = { candidate_id: candidateId, source: "approval", reference: approval.value.grant_id, diff_digest: exact.diff };
      }
      const plan = this.plan(access, image, stage, selectedPermit);
      if (!plan.ok) return plan;
      const claim = randomUUID();
      this.store.claim(id, claim);
      return ok({ image, stage, plan: plan.value, claim, draft: !live, permit: selectedPermit });
    });
    if (!result.ok) return Promise.resolve(result);
    if ("receipt" in result.value) return Promise.resolve(ok(result.value));
    const abort = new AbortController();
    const work = result.value;
    const boundPermit = work.permit ? structuredClone(work.permit) : undefined;
    const scope = { ...access };
    const promise = Promise.resolve().then(() => this.execute(scope, envelope, work, boundPermit, abort))
      .then((result) => {
        this.atomic(() => {
          if (this.store.request(id)?.claim === work.claim) {
            this.store.claim(id, null);
            if (!result.ok && result.error.retry !== "same_request") {
              this.authority.finish(expected(envelope), envelope.request_id);
            }
          }
          return ok(undefined);
        });
        return result;
      }).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, { digest: hash, candidate: candidateId, diff: work.stage.diff_digest, promise, abort });
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
        const live = this.store.head(access);
        const current = work.draft && !live ? this.store.draft(access) : live;
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
        this.store.publish(id, claim, current, candidate, receipt, events, stage, work.draft);
        this.fault("before_commit");
        return ok(receipt);
      });
      if (committed.ok) this.fault("after_commit");
      return committed;
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);

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
