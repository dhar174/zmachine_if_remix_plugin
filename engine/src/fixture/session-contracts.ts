import { z } from "zod";
import { HeadExpectation, RequestIdentity, TurnEnvelope } from "../contracts.ts";
import { CompilationInput, CompilationProposal, ModelInterpretation } from "../policy/directive-contracts.ts";
import { startupRecord } from "../native/checkpoint.ts";

const version = z.literal("1.0.0");
export const opaque = (prefix: string) => z.string().regex(new RegExp("^" + prefix + ":[0-9a-f-]{36}$", "u"));
export const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const sessionRef = HeadExpectation.pick({ session_id: true, branch_id: true });
export const publicHead = HeadExpectation.omit({ owner_id: true });
export const requestId = RequestIdentity.shape.request_id;
export const target = publicHead.extend({ request_id: requestId });
export const sourcePurpose = z.enum(["initial", "assignment", "amendment"]);
export const sourceRecord = z.strictObject({
  head: HeadExpectation, request_id: requestId, purpose: sourcePurpose,
  source: CompilationInput.shape.sources.element,
});
export const launchRecord = z.strictObject({
  owner: HeadExpectation.shape.owner_id, expires: z.number(), session: sessionRef.nullable(),
  profile: z.literal("native-z5").optional(),
});
export const compilationRecord = z.strictObject({ interpretation: ModelInterpretation, proposal: CompilationProposal });
const play = z.strictObject({ kind: z.literal("play"), input: TurnEnvelope.shape.input });
const directive = z.strictObject({ kind: z.literal("directive"), source_ref: opaque("source") });
export const requestAction = z.discriminatedUnion("kind", [play, directive]);
export const preparedAction = z.discriminatedUnion("kind", [
  play, directive.extend({ interpretation: ModelInterpretation }),
  z.strictObject({ kind: z.literal("mixed") }),
]);
export const capture = target.extend({ purpose: sourcePurpose, text: z.string().min(1).max(4096) });
export const subset = z.strictObject({
  source_ref: opaque("source"), proposal_digest: digest,
  clause_ids: z.array(z.string().min(1).max(256)).min(1).max(128),
});
export const visibleFacts = z.array(z.strictObject({
  entity_id: z.string(), field: z.string(), value: z.string(), evidence_id: z.string(),
})).max(32);
export const publicRules = z.array(z.strictObject({
  id: z.string(), kind: z.enum(["invariant", "permission"]), source_id: z.string(), supersedes: z.array(z.string()),
})).max(128);
const nativeEntity = z.strictObject({ id: z.string(), name: z.string(), qualifier: z.string().nullable() });
const nativeContext = z.strictObject({
  version, opening: startupRecord,
  projection: z.strictObject({
    room: nativeEntity, inventory: z.array(nativeEntity), visible: z.array(nativeEntity), status_line: z.string(),
  }).nullable(),
});
export const fixtureContext = z.strictObject({
  head: publicHead, state: z.enum(["draft", "active"]), mode: z.enum(["PLAY", "EDITOR"]),
  story_sha256: digest, pending_input: z.enum(["line", "character", "halted"]).nullable(),
  operations: z.array(z.enum(["initial_directive", "play", "editor_assignment", "policy_amendment", "inspect"])),
  clocks: z.strictObject({ native: z.int().nonnegative(), overlay: z.int().nonnegative() }).nullable(),
  facts: visibleFacts, rules: publicRules, native: nativeContext.optional(), restored_from: publicHead.optional(),
});
export const compilerView = z.strictObject({
  source_ref: opaque("source"), source_id: z.string(), text: z.string(),
  purpose: sourcePurpose, request_id: requestId, context_digest: digest,
  fields: z.array(z.strictObject({ entity_id: z.string(), field: z.string() })),
  active_rules: CompilationInput.shape.active_rules, guards: CompilationInput.shape.guards,
});
export const receiptView = z.strictObject({
  version, ...publicHead.pick({ session_id: true, branch_id: true, generation_id: true }).shape, request_id: requestId,
  status: z.literal("COMMITTED"), revision: z.int().nonnegative(), policy_revision: z.int().nonnegative(),
  native_output: z.array(z.string()), event_ids: z.array(z.string()), narration_facts: z.array(z.string()),
  time_cost: z.int().nonnegative(), in_fiction_result: z.enum(["success", "failure"]), warnings: z.array(z.string()),
  rule_ids: z.array(z.string()), capability_ids: z.array(z.string()),
});
