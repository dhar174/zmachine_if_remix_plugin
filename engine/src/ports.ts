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
  /** Evaluate at the supplied revision and report rejection without mutation. */
  evaluate(policy: DirectiveBundle, proposal: TurnProposal, context: TrustedContext): Promise<Result<readonly Effect[]>>;
}
export interface AuthorizationPort {
  /** Use trusted context rather than claims in the untrusted envelope or proposal. */
  authorize(context: TrustedContext, envelope: TurnEnvelope, proposal: TurnProposal): Promise<Result<void>>;
  /** Verify the exact candidate, scope, revision and expiry without consuming the grant. */
  verifyApproval(context: TrustedContext, candidate: CandidateHandle, approval: TrustedApproval): Promise<Result<void>>;
}
export interface StagedCandidate {
  readonly handle: CandidateHandle;
  readonly checkpoint: CombinedCheckpoint;
}
export interface CandidateStore {
  /** Stage or discard privately. Scope all lookups by the candidate handle. */
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
  /** Atomically publish the candidate head, receipt and idempotency result, or publish nothing. */
  compareAndPublish(publication: Publication): Promise<Result<CommittedReceipt>>;
}
export interface ReceiptLookup {
  /** A mismatched digest fails with IDEMPOTENCY_CONFLICT. An absent receipt is unknown. */
  find(identity: RequestIdentity, requestDigest: string): Promise<Result<TurnReceipt | undefined>>;
}
