import { createHash } from "node:crypto";
import { z } from "zod";

const version = z.literal("1.0.0");
const identifier = z.string().regex(/^[a-z][a-z0-9_-]*:[A-Za-z0-9._:-]+$/).max(256);
const id = <const T extends string>(prefix: T) => identifier
  .refine((value) => value.startsWith(prefix + ":")).brand<T>();
export const OwnerId = id("owner");
export const SessionId = id("session");
export const BranchId = id("branch");
export const GenerationId = id("generation");
export const Revision = z.int().nonnegative().brand<"Revision">();
const RequestId = id("request");
const EntityId = identifier.refine((value) => /^(native|remix):/.test(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(32000);
const char = z.string().refine((value) => [...value].length === 1 && !/[\uD800-\uDFFF]/u.test(value));
const json = z.json();
const scopeFields = { owner_id: OwnerId, session_id: SessionId, branch_id: BranchId, generation_id: GenerationId };
const headFields = { ...scopeFields, expected_revision: Revision, expected_policy_revision: Revision };
export const HeadExpectation = z.strictObject(headFields);
export const RequestIdentity = z.strictObject({ ...scopeFields, request_id: RequestId });
export const PendingInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line") }),
  z.strictObject({ kind: z.literal("character") }),
  z.strictObject({ kind: z.literal("halted") }),
]);
const input = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), text }),
  z.strictObject({ kind: z.literal("character"), value: char }),
]);
const policyReferenceId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(256);
const mode = z.enum(["PLAY", "EDITOR"]);
const route = z.enum(["native", "remix", "bridged"]);
export const TurnEnvelope = z.strictObject({
  version, ...headFields, request_id: RequestId, input,
  intent: z.enum(["play", "editor", "inspect"]).optional(),
});
const operation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("native.line"), text }),
  z.strictObject({ kind: z.literal("native.character"), value: char }),
  z.strictObject({ kind: z.literal("inspect.entity"), entity_id: EntityId }),
  z.strictObject({ kind: z.literal("remix.assign"), entity_id: EntityId, field: identifier, value: json }),
]);
const effect = z.strictObject({ entity_id: EntityId, field: identifier, change: z.enum(["read", "write"]), });
export const TurnProposal = z.strictObject({
  version, ...headFields, request_id: RequestId, route, intent: mode,
  normalized_intent: text, entity_ids: z.array(EntityId), operations: z.array(operation).min(1),
  known_effects: z.array(effect), effect_coverage: z.enum(["known", "incomplete"]),
  rule_ids: z.array(policyReferenceId), guard_ids: z.array(policyReferenceId), unresolved: z.array(text),
  time: z.enum(["native", "overlay", "none"]),
  generation_requests: z.array(z.strictObject({ kind: z.enum(["location", "character", "item", "connection", "rule"]), region_id: identifier, count: z.int().positive() })),
});
const nonCommit = z.enum(["NEEDS_CLARIFICATION", "NEEDS_APPROVAL", "POLICY_CONFLICT", "CAPABILITY_MISSING", "STALE_REVISION", "VALIDATION_FAILED", "ABORTED"]);
const receiptFields = { version, ...scopeFields, request_id: RequestId, warnings: z.array(text) };
export const TurnReceipt = z.union([
  z.strictObject({
    ...receiptFields, status: z.literal("COMMITTED"), revision: Revision,
    pre_checkpoint: identifier, post_checkpoint: identifier, native_output: z.array(text),
    event_ids: z.array(identifier), narration_facts: z.array(text), visibility: z.enum(["owner", "player"]),
    time_cost: z.int().nonnegative(), policy_revision: Revision, in_fiction_result: z.enum(["success", "failure"]),
  }),
  z.strictObject({
    ...receiptFields, status: nonCommit, message: text, retry: z.enum(["none", "same_request", "refresh"]),
    subtype: z.literal("IDEMPOTENCY_CONFLICT").optional(),
  }).refine((value) => value.subtype === undefined || value.status === "VALIDATION_FAILED"),
]);

const sourceId = policyReferenceId;
const source = z.strictObject({ id: sourceId, origin: z.enum(["initial", "editor"]), text: text.min(1) });
const span = z.strictObject({ source_id: sourceId, start: z.int().nonnegative(), end: z.int().positive() });
const scope = z.strictObject({
  origins: z.array(z.enum(["native", "remix"])).min(1).max(2),
  entity_ids: z.array(EntityId), region_ids: z.array(identifier),
  domains: z.array(z.enum(["topology", "identity", "characterization", "dialogue", "inventory", "progression", "presentation"])).min(1),
});
const rule = { id: policyReferenceId, source: span, scope, supersedes: z.array(policyReferenceId) };
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const DirectiveBundle = z.strictObject({
  version, policy_id: identifier, revision: Revision, story_sha256: digest,
  sources: z.array(source).min(1),
  policy_amendment: z.strictObject({
    defaults: z.strictObject({
      fidelity: z.literal("preserve_authored_behavior"), play_semantics: z.literal("attempt"),
      unlisted_generation: z.literal("deny"), unknown_facts: z.literal("unresolved"),
      implicit_retcons: z.literal(false), editor_time: z.literal("no_game_time"),
    }),
    generation_rules: z.array(z.strictObject({
      ...rule, action: z.enum(["generate.location", "generate.character", "generate.item", "generate.connection", "generate.rule", "dialogue.adapt", "presentation.embellish"]),
      triggers: z.array(z.enum(["player_attempt", "autonomous_event"])).min(1), decision: z.enum(["allow", "deny"]),
    })),
    invariants: z.array(z.strictObject({
      ...rule, protected: z.boolean(),
      guard: z.strictObject({ id: policyReferenceId, enforcement: z.enum(["structural", "adapter", "semantic"]),
        parameters: z.record(sourceId, z.union([scalar, z.array(scalar)])),
      }),
    })),
  }),
  world_patch: z.array(z.strictObject({ entity_id: EntityId, field: identifier, value: json, source: span })),
  preferences: z.array(z.strictObject({ id: policyReferenceId, source: span, text })),
  unresolved: z.array(z.strictObject({ source: span, reason: text })),
}).superRefine((bundle, context) => {
  const lengths = new Map<string, number>();
  for (const [index, entry] of bundle.sources.entries()) {
    if (lengths.has(entry.id)) context.addIssue({ code: "custom", path: ["sources", index, "id"], message: "Duplicate source ID" });
    lengths.set(entry.id, [...entry.text].length);
  }
  const validateSpans = (items: readonly { source: z.infer<typeof span> }[], path: (string | number)[]) => {
    for (const [index, item] of items.entries()) {
      const { source_id, start, end } = item.source;
      const length = lengths.get(source_id);
      if (length === undefined || start >= end || end > length) {
        context.addIssue({ code: "custom", path: [...path, index, "source"], message: "Invalid Unicode code-point span" });
      }
    }
  };
  const policyIds = new Set<string>();
  const uniqueIds = (items: readonly { id: string }[], path: string[]) => {
    for (const [index, item] of items.entries()) {
      if (policyIds.has(item.id)) context.addIssue({ code: "custom", path: [...path, index, "id"], message: "Duplicate policy entry ID" });
      policyIds.add(item.id);
    }
  };
  uniqueIds(bundle.policy_amendment.generation_rules, ["policy_amendment", "generation_rules"]);
  uniqueIds(bundle.policy_amendment.invariants, ["policy_amendment", "invariants"]);
  uniqueIds(bundle.preferences, ["preferences"]);
  validateSpans(bundle.policy_amendment.generation_rules, ["policy_amendment", "generation_rules"]);
  validateSpans(bundle.policy_amendment.invariants, ["policy_amendment", "invariants"]);
  validateSpans(bundle.world_patch, ["world_patch"]);
  validateSpans(bundle.preferences, ["preferences"]);
  validateSpans(bundle.unresolved, ["unresolved"]);
});

const runtimeIdentity = {
  story_sha256: digest, runtime_build: digest, adapter_build: digest, checkpoint_format: identifier,
};
export const CapabilityManifest = z.strictObject({
  version, ...runtimeIdentity, capabilities: z.array(z.strictObject({
    id: identifier, operation: z.enum(["native.line", "native.character", "inspect.entity", "remix.assign"]),
    boundary: PendingInput, preconditions: z.array(text), effects: z.array(effect),
    coverage: z.enum(["supported", "unsupported"]), evidence: z.array(text),
    recovery: z.enum(["checkpoint", "unsupported"]),
  })),
});
export const CandidateHandle = z.strictObject({
  version, ...headFields, request_id: RequestId, candidate_id: id("candidate"),
  proposal_digest: digest, approval_scope: z.array(identifier), expires_at: z.iso.datetime(),
});
export const CombinedCheckpoint = z.strictObject({
  version, ...scopeFields, ...runtimeIdentity, revision: Revision, policy_revision: Revision,
  checkpoint_id: id("checkpoint"), native_state: z.strictObject({ pending_input: PendingInput, payload_ref: identifier, payload_sha256: digest }),
  remix_state_ref: identifier, policy_ref: identifier, history_ref: identifier,
  clocks: z.strictObject({ native: z.int().nonnegative(), overlay: z.int().nonnegative(), policy: z.enum(["native_running", "native_paused"]) }),
});

export type TurnEnvelope = z.infer<typeof TurnEnvelope>;
export type TurnProposal = z.infer<typeof TurnProposal>;
export type TurnReceipt = z.infer<typeof TurnReceipt>;
export type DirectiveBundle = z.infer<typeof DirectiveBundle>;
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;
export type CandidateHandle = z.infer<typeof CandidateHandle>;
export type CombinedCheckpoint = z.infer<typeof CombinedCheckpoint>;
export type HeadExpectation = z.infer<typeof HeadExpectation>;
export type RequestIdentity = z.infer<typeof RequestIdentity>;
export type PendingInput = z.infer<typeof PendingInput>;
export type TurnOperation = z.infer<typeof operation>;
export type Effect = z.infer<typeof effect>;
export type Json = z.infer<typeof json>;

/** Validated JSON records may carry explicitly undefined optional object fields. */
export type CanonicalValue = string | number | boolean | null | CanonicalValue[] |
  { readonly [key: string]: CanonicalValue | undefined };

export function canonicalJson(value: CanonicalValue): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).filter((entry): entry is [string, CanonicalValue] => entry[1] !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => JSON.stringify(key) + ":" + canonicalJson(entry)).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function canonicalDigest(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
