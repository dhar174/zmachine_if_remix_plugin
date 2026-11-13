import { z } from "zod";
import { CapabilityManifest, DirectiveBundle, HeadExpectation, PendingInput, RequestIdentity, TurnProposal } from "../contracts.ts";
import type { Failure } from "../ports.ts";
import { CompilationInput, CompilationProposal, ModelInterpretation, PolicyRule, SupportedSubsetSelection } from "./directive-contracts.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).max(256);
const effect = TurnProposal.shape.known_effects.element;
const entityId = effect.shape.entity_id;
const field = effect.shape.field;
const digest = CapabilityManifest.shape.story_sha256;
const version = z.literal("1.0.0");
const owner = z.enum(["native", "remix"]);
const trigger = z.enum(["player_attempt", "autonomous_event"]);
const scope = PolicyRule.options[0].shape.scope.shape;
const operation = z.discriminatedUnion("kind", [
  ...TurnProposal.shape.operations.element.options,
  z.strictObject({ kind: z.literal("inventory.transfer"), item: entityId, from: entityId, to: entityId }),
  z.strictObject({ kind: z.literal("overlay.create"), entity: entityId, region: id,
    entity_kind: z.enum(["location", "character", "item", "rule"]), label: z.string().min(1).max(32000) }),
  z.strictObject({ kind: z.literal("overlay.connect"), connection: entityId, from: entityId, to: entityId }),
  z.strictObject({ kind: z.literal("dialogue.change"), character: entityId,
    text: z.string().min(1).max(32000), takeover: z.boolean() }),
]);
const fact = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), value: z.json(), evidence_id: id }),
  z.strictObject({ state: z.enum(["absent", "unobserved", "unmapped", "contradictory"]), evidence_id: id }),
]);
const surface = z.strictObject({
  field, owner, domain: scope.domains.element, fact,
  risk: z.enum(["low_reversible", "consequential"]),
  direct_assignment: z.boolean(),
  coverage: z.enum(["complete", "incomplete"]),
  dependencies: z.array(effect).max(64),
});
const entity = z.strictObject({
  id: entityId, origin: owner, region_ids: z.array(id).max(64).nullable(),
  existence: z.enum(["present", "absent", "unobserved", "unmapped", "contradictory"]),
  evidence_id: id, surfaces: z.array(surface).max(256),
  // Null means the set of conflicting native routines has not been established.
  takeover_surfaces: z.array(effect).max(64).nullable(),
});
const condition = z.strictObject({ entity_id: entityId, field, equals: z.json() });
const capabilityBinding = z.strictObject({
  capability_id: id, operation_digest: digest,
  preconditions: z.array(condition.extend({ name: z.string().min(1).max(256) })).max(64),
  suppressed_surfaces: z.array(effect).max(64),
});
const native = z.strictObject({
  identity: CapabilityManifest.pick({ story_sha256: true, runtime_build: true, adapter_build: true, checkpoint_format: true }),
  manifest: CapabilityManifest.extend({
    capabilities: z.array(CapabilityManifest.shape.capabilities.element.extend({
      operation: z.enum(["native.line", "native.character", "inspect.entity", "remix.assign",
        "inventory.transfer", "overlay.connect", "dialogue.change"]),
    })).max(256),
  }), pending: PendingInput,
  bindings: z.array(capabilityBinding).max(256),
});
const bridge = z.strictObject({
  id, operation_digest: digest, native_capability_id: id, effects: z.array(effect).max(256), evidence_id: id,
});
const guardEvidence = z.strictObject({
  rule_id: id, operation_digest: digest, proposal_digest: digest,
  kind: z.enum(["adapter", "semantic"]),
  verdict: z.enum(["satisfied", "violated", "uncertain"]), evidence_id: id,
  confidence: z.enum(["bounded", "uncertain"]),
});
export const ResolverSnapshot = z.strictObject({
  version, head: HeadExpectation, story_sha256: digest,
  mode: z.enum(["PLAY", "EDITOR"]), trigger,
  clock: z.strictObject({ overlay_turn: z.int().nonnegative(), native_running: z.boolean() }),
  policy: DirectiveBundle, history: CompilationInput.shape.history,
  applicability: z.array(z.strictObject({
    rule_id: id, from_turn: z.int().nonnegative(), until_turn: z.int().positive().nullable(),
  })).max(512),
  regions: z.array(id).max(256),
  entities: z.array(entity).max(1024), native: native.nullable(), bridges: z.array(bridge).max(256),
  editor_authority: z.strictObject({ proposal_digest: digest, evidence_id: id }).nullable(),
  guard_evidence: z.array(guardEvidence).max(512),
  compiler_context: CompilationInput.nullable(),
});
export const ResolverProposal = HeadExpectation.extend({
  version, request_id: RequestIdentity.shape.request_id, mode: z.enum(["PLAY", "EDITOR"]),
  operations: z.array(operation).max(32),
  declared_effects: z.array(effect).max(512),
  amendment: z.strictObject({
    compiled: CompilationProposal, interpretation: ModelInterpretation, selection: SupportedSubsetSelection.nullable(),
  }).nullable(),
}).refine((value) => value.amendment ? value.operations.length === 0 : value.operations.length > 0);

export type ResolverSnapshot = z.infer<typeof ResolverSnapshot>;
export type ResolverProposal = z.infer<typeof ResolverProposal>;
export type ResolverOperation = z.infer<typeof operation>;
export type EffectRef = z.infer<typeof effect>;
export type EntityProjection = z.infer<typeof entity>;
export type ActiveRule = z.infer<typeof PolicyRule>;
export type PolicyAction = z.infer<typeof PolicyRule.options[0]>["action"];

export interface DecisionTrace {
  readonly rule_ids: readonly string[];
  readonly capability_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly semantic: readonly { rule_id: string; evidence_id: string; confidence: "bounded" | "uncertain";
    outcome: "satisfied" | "violated" | "uncertain" | "best_effort" }[];
}

export interface EffectPlan {
  readonly version: "1.0.0";
  readonly head: z.infer<typeof HeadExpectation>;
  readonly request_id: ResolverProposal["request_id"];
  readonly proposal_digest: string;
  readonly route: "native" | "remix" | "bridged";
  readonly time: "native" | "overlay" | "none";
  readonly operations: readonly {
    operation: ResolverOperation;
    effects: readonly EffectRef[];
    capability_ids: readonly string[];
  }[];
  readonly amendment: { compiled: CompilationProposal; active_rules: readonly ActiveRule[];
    applicability: ResolverSnapshot["applicability"]; preferences: CompilationProposal["bundle"]["preferences"] } | null;
  readonly trace: DecisionTrace;
}

export type Resolution = { ok: true; plan: EffectPlan } |
  { ok: false; error: Failure & { reason: string }; trace: DecisionTrace };

/** The coordinator supplies authenticated, revision-bound snapshot evidence. */
export interface PolicyResolverPort {
  resolve(snapshot: ResolverSnapshot, proposal: ResolverProposal): Resolution;
}
