import { z } from "zod";
import { CombinedCheckpoint, HeadExpectation } from "../contracts.ts";
import { digest, opaque, publicHead, requestId, target } from "./session-contracts.ts";

export const saveId = opaque("save");
export const restoreId = opaque("restore");
const checkpointId = CombinedCheckpoint.shape.checkpoint_id;
export const savedSession = z.strictObject({
  version: z.literal("1.0.0"), save_id: saveId, head: HeadExpectation,
  checkpoint: checkpointId, digest,
});
export const restoreIntent = z.strictObject({
  id: restoreId, target, base: checkpointId, base_digest: digest, save: savedSession,
  epoch: z.int().nonnegative(), expires: z.int().nonnegative(),
});
export const saveResult = z.strictObject({ status: z.literal("SAVED"), save_id: saveId, head: publicHead });
export const restoreResult = z.strictObject({
  status: z.literal("RESTORED"), save_id: saveId, request_id: requestId,
  head: publicHead, restored_from: publicHead, previous_head: publicHead,
});
export const recoveryResult = z.discriminatedUnion("status", [saveResult, restoreResult]);
export type SavedSession = z.infer<typeof savedSession>;
export type RestoreIntent = z.infer<typeof restoreIntent>;
export type RestoreResult = z.infer<typeof restoreResult>;
