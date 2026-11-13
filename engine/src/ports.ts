import type {
  CandidateHandle, CapabilityManifest, CombinedCheckpoint, DirectiveBundle, Effect, HeadExpectation,
  PendingInput, RequestIdentity, TurnEnvelope, TurnOperation, TurnProposal, TurnReceipt,
} from "./contracts.ts";

type Rejected = Extract<TurnReceipt, { message: string }>;
export type Failure = Pick<Rejected, "status" | "message" | "retry" | "subtype">;
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };

export interface TrustedContext {
  readonly owner_id: HeadExpectation["owner_id"];
  readonly head: HeadExpectation;
  readonly mode: "PLAY" | "EDITOR";
}
export interface TrustedApproval {
  readonly candidate: CandidateHandle;
  readonly owner_id: HeadExpectation["owner_id"];
  readonly grant_id: string;
}
export type NativeOperation = Extract<TurnOperation, { kind: "native.line" | "native.character" }>;

/**
 * Unsupported operations/boundaries return CAPABILITY_MISSING/none. Malformed
 * or incompatible checkpoint data returns VALIDATION_FAILED/none.
 * An interrupted native operation returns ABORTED/none.
 */
export interface NativePort<IsolatedVM> {
  /** Bind coverage to the exact story and runtime/adapter build. */
  manifest(checkpoint: CombinedCheckpoint): Promise<Result<CapabilityManifest>>;
  /** Restore an isolated VM or reject unsupported or mismatched checkpoints. */
  restore(checkpoint: CombinedCheckpoint): Promise<Result<IsolatedVM>>;
  /** Capture only supported pending-input boundaries. */
  capture(vm: IsolatedVM): Promise<Result<CombinedCheckpoint["native_state"]>>;
  /** Read state without executing a turn or advancing time. */
  inspect(vm: IsolatedVM, target: Extract<TurnOperation, { kind: "inspect.entity" }>): Promise<Result<readonly string[]>>;
  /** Mutate only the isolated VM and report all known effects before publication. */
  execute(vm: IsolatedVM, operation: NativeOperation): Promise<Result<{
    pending: PendingInput; effects: readonly Effect[]; output: readonly string[]; time_cost: number;
    outcome: "success" | "failure";
  }>>;
}
export interface PolicyPort {
  /** Evaluate without mutation. Return POLICY_CONFLICT/none for a denied effect,
   * NEEDS_CLARIFICATION/none for ambiguity, NEEDS_APPROVAL/none for a missing
   * required grant, or CAPABILITY_MISSING/none for unsupported coverage. */
  evaluate(policy: DirectiveBundle, proposal: TurnProposal, context: TrustedContext): Promise<Result<readonly Effect[]>>;
}
export interface AuthorizationPort {
  /** Use trusted context. Invalid identity/scope returns VALIDATION_FAILED/none,
   * outdated revisions return STALE_REVISION/refresh, and missing Editor
   * authority returns NEEDS_APPROVAL/none. */
  authorize(context: TrustedContext, envelope: TurnEnvelope, proposal: TurnProposal): Promise<Result<void>>;
  /** Verify without consuming the grant. Identity/scope mismatch returns
   * VALIDATION_FAILED/none, outdated revisions return STALE_REVISION/refresh,
   * and a missing, expired or mismatched grant returns NEEDS_APPROVAL/none. */
  verifyApproval(context: TrustedContext, candidate: CandidateHandle, approval: TrustedApproval): Promise<Result<void>>;
}
export interface StagedCandidate {
  readonly handle: CandidateHandle;
  readonly checkpoint: CombinedCheckpoint;
}
export interface CandidateStore {
  /** Stage or discard privately. Invalid, absent or out-of-scope handles
   * return VALIDATION_FAILED/none for lookup. Discard is idempotent for absent handles. */
  put(candidate: StagedCandidate): Promise<Result<void>>;
  get(handle: CandidateHandle): Promise<Result<StagedCandidate>>;
  discard(handle: CandidateHandle): Promise<Result<void>>;
}
type CommittedReceipt = Extract<TurnReceipt, { status: "COMMITTED" }>;
export interface Publication {
  readonly expected: HeadExpectation;
  readonly candidate: StagedCandidate;
  readonly receipt: CommittedReceipt;
  readonly request_digest: string;
}
export interface HeadPublisher {
  /** Atomically publish the candidate head, receipt and idempotency result.
   * A changed head returns STALE_REVISION/refresh. Inconsistent candidate or
   * receipt data returns VALIDATION_FAILED/none. Either failure publishes nothing. */
  compareAndPublish(publication: Publication): Promise<Result<CommittedReceipt>>;
}
export interface ReceiptLookup {
  /** An absent scoped receipt is unknown. A mismatched digest returns
   * VALIDATION_FAILED/none with the IDEMPOTENCY_CONFLICT subtype. */
  find(identity: RequestIdentity, requestDigest: string): Promise<Result<TurnReceipt | undefined>>;
}
