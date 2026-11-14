import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CombinedCheckpoint, DirectiveBundle, HeadExpectation, Revision, canonicalDigest, canonicalJson } from "../contracts.ts";
import type { Json } from "../contracts.ts";
import type { Result } from "../ports.ts";
import type { EffectPlan, ResolverSnapshot } from "../policy/resolver-contracts.ts";
import { effectKey } from "../policy/resolver-effects.ts";
import { TurnImage, failure, limits, ok } from "./contracts.ts";
import type { Execution, TurnExecutor } from "./contracts.ts";

export function supported(operations: EffectPlan["operations"]): boolean {
  return operations.length <= limits.operations && operations.every(({ operation }) =>
    operation.kind === "native.line" || operation.kind === "native.character" ||
    operation.kind === "remix.assign" || operation.kind === "inspect.entity");
}

const invalidEffect = () => failure("VALIDATION_FAILED", "Observed effects or postconditions differ from the verified turn.");
const fits = (value: string, max: number) => Buffer.byteLength(value) <= max;
const presentValue = (surface: ResolverSnapshot["entities"][number]["surfaces"][number], value: Json) =>
  ({ ...surface, fact: { state: "present" as const, value, evidence_id: surface.fact.evidence_id } });

function nextPolicy(before: TurnImage, plan: EffectPlan) {
  const { policy, applicability, history } = before.snapshot;
  if (!plan.amendment) return { policy, applicability, history };
  const { active_rules: rules, compiled, preferences } = plan.amendment;
  const sources = new Map(policy.sources.map((source) => [source.id, source]));
  for (const source of compiled.bundle.sources) {
    const prior = sources.get(source.id);
    if (prior && canonicalDigest(prior) !== canonicalDigest(source)) throw new Error("Amendment source ID already used.");
    sources.set(source.id, source);
  }
  const next = DirectiveBundle.parse({ ...policy, revision: policy.revision + 1, sources: [...sources.values()],
    world_patch: [], preferences, unresolved: [], policy_amendment: { ...policy.policy_amendment,
      generation_rules: rules.flatMap(({ kind, ...rule }) => kind === "permission" ? [rule] : []),
      invariants: rules.flatMap(({ kind, ...rule }) => kind === "invariant" ? [rule] : []),
    } });
  return { policy: next, applicability: plan.amendment.applicability,
    history: [...history, ...compiled.lineage.map(({ old_rule }) => ({ id: old_rule.id, supersedes: old_rule.supersedes }))] };
}

export function buildImage(before: TurnImage, execution: Execution, plan: EffectPlan, executor: TurnExecutor): Result<TurnImage> {
  const runNative = plan.time === "native";
  if (!Number.isSafeInteger(execution.time_cost) || execution.time_cost < 0 ||
      (!runNative && execution.time_cost !== 0) || execution.events.length > limits.events ||
      !fits(JSON.stringify([execution.output, execution.facts]), limits.output_bytes)) {
    return failure("ABORTED", "The isolated turn exceeded its execution or output budget.");
  }
  const expected = new Set(plan.operations.flatMap(({ effects }) => effects.map(effectKey)));
  const observed = execution.effects.map(effectKey);
  if (new Set(observed).size !== observed.length || observed.some((key) => !expected.has(key))) return invalidEffect();
  // Native adapters account for hidden fixture state as well as exposed native surfaces.
  if (runNative) {
    const verified = executor.verifyNative(structuredClone(before), structuredClone(execution), structuredClone(plan));
    if (!verified.ok) return verified;
  } else if (canonicalDigest(execution.native) !== canonicalDigest(before.native) ||
      canonicalDigest(execution.pending) !== canonicalDigest(before.checkpoint.native_state.pending_input) || execution.output.length) {
    return invalidEffect();
  }
  const indexed = new Map(execution.entities.map((entity) => [entity.id, entity]));
  if (indexed.size !== execution.entities.length || indexed.size !== before.snapshot.entities.length) return invalidEffect();
  const assignments = new Map<string, Json>();
  for (const { operation } of plan.operations) {
    if (operation.kind === "remix.assign") assignments.set(canonicalJson([operation.entity_id, operation.field]), operation.value);
  }
  for (const entity of before.snapshot.entities) {
    const proposed = indexed.get(entity.id);
    if (!proposed || proposed.surfaces.length !== entity.surfaces.length ||
        canonicalDigest({ ...proposed, surfaces: [] }) !== canonicalDigest({ ...entity, surfaces: [] })) return invalidEffect();
    const fields = new Map(proposed.surfaces.map((surface) => [surface.field, surface]));
    for (const surface of entity.surfaces) {
      const after = fields.get(surface.field);
      if (!after) return invalidEffect();
      const key = canonicalJson([entity.id, surface.field]);
      const assignment = assignments.get(key);
      const write = effectKey({ entity_id: entity.id, field: surface.field, change: "write" });
      if (assignment !== undefined) {
        if (canonicalDigest(after) !== canonicalDigest(presentValue(surface, assignment)) || !observed.includes(write)) return invalidEffect();
      } else if (canonicalDigest(after) !== canonicalDigest(surface)) {
        if (!runNative || surface.owner !== "native" || !observed.includes(write) ||
            canonicalDigest({ ...after, fact: surface.fact }) !== canonicalDigest(surface)) return invalidEffect();
      }
    }
  }
  let rules: ReturnType<typeof nextPolicy>;
  try { rules = nextPolicy(before, plan); } catch { return invalidEffect(); }
  const revision = Revision.parse(before.checkpoint.revision + 1);
  const head = HeadExpectation.parse({ ...before.snapshot.head, expected_revision: revision,
    expected_policy_revision: rules.policy.revision });
  const nativeDigest = canonicalDigest(execution.native);
  const checkpoint = CombinedCheckpoint.parse({
    ...before.checkpoint, revision, policy_revision: rules.policy.revision, checkpoint_id: "checkpoint:" + randomUUID(),
    native_state: { pending_input: execution.pending, payload_ref: "blob:" + nativeDigest, payload_sha256: nativeDigest },
    remix_state_ref: "blob:" + canonicalDigest(execution.entities),
    policy_ref: "blob:" + canonicalDigest(rules), history_ref: "history:" + randomUUID(),
    clocks: { ...before.checkpoint.clocks, native: before.checkpoint.clocks.native + (runNative ? execution.time_cost : 0),
      overlay: before.checkpoint.clocks.overlay + (plan.time === "overlay" ? 1 : 0) },
  });
  const candidate = TurnImage.parse({ checkpoint, native: execution.native, amendment: plan.amendment?.compiled ?? null,
    snapshot: { ...before.snapshot, ...rules, head, entities: execution.entities, native: null, guard_evidence: [],
      clock: { ...before.snapshot.clock, overlay_turn: checkpoint.clocks.overlay }, editor_authority: null, compiler_context: null },
  });
  const valid = validateImage(candidate, executor);
  return valid.ok ? ok(candidate) : valid;
}

export function validateImage(image: TurnImage, executor: TurnExecutor): Result<void> {
  const { checkpoint, snapshot, native } = image;
  if (!fits(canonicalJson(image), limits.checkpoint_bytes)) return failure("ABORTED", "Checkpoint exceeds the size limit.");
  const digest = canonicalDigest(native);
  const rules = { policy: snapshot.policy, applicability: snapshot.applicability, history: snapshot.history };
  if (checkpoint.story_sha256 !== snapshot.story_sha256 || checkpoint.story_sha256 !== snapshot.policy.story_sha256 ||
      checkpoint.revision !== snapshot.head.expected_revision || checkpoint.policy_revision !== snapshot.head.expected_policy_revision ||
      checkpoint.policy_revision !== snapshot.policy.revision || checkpoint.owner_id !== snapshot.head.owner_id ||
      checkpoint.session_id !== snapshot.head.session_id || checkpoint.branch_id !== snapshot.head.branch_id ||
      checkpoint.generation_id !== snapshot.head.generation_id || checkpoint.native_state.payload_sha256 !== digest ||
      checkpoint.native_state.payload_ref !== "blob:" + digest || checkpoint.remix_state_ref !== "blob:" + canonicalDigest(snapshot.entities) ||
      checkpoint.policy_ref !== "blob:" + canonicalDigest(rules) ||
      snapshot.clock.overlay_turn !== checkpoint.clocks.overlay ||
      snapshot.clock.native_running !== (checkpoint.clocks.policy === "native_running") ||
      snapshot.editor_authority || snapshot.compiler_context || snapshot.native || snapshot.guard_evidence.length) return invalidEffect();
  return executor.verifyRestore(structuredClone(image));
}

export const jsonEvent = z.json();
