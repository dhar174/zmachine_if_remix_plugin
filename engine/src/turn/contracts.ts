import { z } from "zod";
import { CandidateHandle, CombinedCheckpoint, HeadExpectation, TurnReceipt } from "../contracts.ts";
import type { World } from "../world/model.ts";
import type { Json } from "../contracts.ts";
import type { EffectPlan, EffectRef, ResolverProposal, ResolverSnapshot } from "../policy/resolver-contracts.ts";
import { ResolverProposal as ProposalSchema, ResolverSnapshot as SnapshotSchema } from "../policy/resolver-contracts.ts";
import { CompilationInput, CompilationProposal } from "../policy/directive-contracts.ts";
import type { Result } from "../ports.ts";
import { BridgeReceipt } from "./bridge-contracts.ts";
import type { BridgeState } from "./bridge-contracts.ts";

export const TurnImage = z.strictObject({
  checkpoint: CombinedCheckpoint,
  snapshot: SnapshotSchema,
  native: z.json(),
  amendment: CompilationProposal.nullable(),
});
export type TurnImage = z.infer<typeof TurnImage>;

export const Stage = z.strictObject({
  handle: CandidateHandle,
  proposal: ProposalSchema,
  compiler: CompilationInput.nullable(),
  diff: z.string(),
  diff_digest: z.string().regex(/^[0-9a-f]{64}$/),
  editor: z.boolean(),
});
export type Stage = z.infer<typeof Stage>;

export const DurableReceipt = z.strictObject({
  version: z.literal("1.0.0"),
  receipt: TurnReceipt.options[0],
  rule_ids: z.array(z.string()),
  capability_ids: z.array(z.string()),
  world_proposal: ProposalSchema.optional(),
  bridge: BridgeReceipt.optional(),
  recovery: z.strictObject({ retry: z.literal("same_request"), checkpoint: CombinedCheckpoint.shape.checkpoint_id }),
});
export type DurableReceipt = z.infer<typeof DurableReceipt>;

export type Access = Pick<z.infer<typeof HeadExpectation>, "owner_id" | "session_id" | "branch_id">;

import { limits } from "./limits.ts";
export { limits };
export type FaultPoint = "before_checkpoint" | "after_checkpoint" | "before_commit" | "after_commit";
export type Execution = {
  native: Json;
  pending: TurnImage["checkpoint"]["native_state"]["pending_input"];
  entities: ResolverSnapshot["entities"];
  world?: World;
  bridge?: BridgeState;
  effects: readonly EffectRef[];
  time_cost: number;
  outcome: "success" | "failure";
  output: readonly string[];
  events: readonly Json[];
  facts: readonly string[];
};

/** Runtime-neutral, bounded execution against a private, re-created input image. */
export interface TurnExecutor {
  project(image: TurnImage, proposal: ResolverProposal): Result<ResolverSnapshot["native"]>;
  execute(image: TurnImage, plan: EffectPlan, budget: typeof limits, signal: AbortSignal): Promise<Result<Execution>>;
  verifyNative(before: TurnImage, after: Execution, plan: EffectPlan): Result<void>;
  /** Verify persisted version, identity and state consistency without running a turn.
   * Executors with isolated workers verify actual recreation before returning executable images. */
  verifyRestore(image: TurnImage): Result<void>;
  /** Recreate a persisted native image in isolation without executing input. */
  recreateNative?(image: TurnImage, signal: AbortSignal, uploadedStory?: Buffer): Promise<Result<void>>;
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export function failure(status: Extract<Result<never>, { ok: false }>["error"]["status"], message: string,
  retry: "none" | "same_request" | "refresh" = "none"): { ok: false; error: Extract<Result<never>, { ok: false }>["error"] } {
  return { ok: false, error: { status, message, retry } };
}
export const invalid = () => failure("VALIDATION_FAILED", "The request or candidate is invalid for this session.");
export const stale = () => failure("STALE_REVISION", "The candidate head has changed.", "refresh");
export const conflict = (): Result<never> => ({ ok: false, error: {
  status: "VALIDATION_FAILED", subtype: "IDEMPOTENCY_CONFLICT", message: "This request ID is already bound to different input.", retry: "none",
} });
