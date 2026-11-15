import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { DirectiveBundle, HeadExpectation, canonicalDigest } from "../src/contracts.ts";
import { ResolverSnapshot } from "../src/policy/resolver-contracts.ts";
import type { Result } from "../src/ports.ts";
import { TurnImage, failure, ok } from "../src/turn/contracts.ts";
import type { Execution, TurnExecutor } from "../src/turn/contracts.ts";
import { compileDirective, selectDirectiveSubset } from "../src/policy/directive-compiler.ts";
import { base, checkpoint, envelope } from "./fixture.ts";

export function take<T>(result: Result<T> | { ok: false; diagnostics: unknown }): T {
  if (!result.ok) assert.fail(JSON.stringify(result));
  return result.value;
}
export const endpoint = { entity_id: "remix:room", field: "presentation:label" };
const nativeField = { entity_id: "native:room", field: "progression:counter" };
const nativeWrite = { ...nativeField, change: "write" as const };
const nativeState = z.strictObject({ counter: z.int().nonnegative(), rng: z.int().nonnegative(), output: z.array(z.string()) });
const imageNative = { counter: 0, rng: 7, output: [] };
const head = HeadExpectation.parse({
  owner_id: base.owner_id, session_id: base.session_id, branch_id: base.branch_id, generation_id: base.generation_id,
  expected_revision: base.expected_revision, expected_policy_revision: base.expected_policy_revision,
});
const policy = DirectiveBundle.parse(JSON.parse(readFileSync(new URL(
  "../../docs/examples/initial-directive-bundle.v1.json", import.meta.url), "utf8")));
const entities = [
  { id: endpoint.entity_id, origin: "remix", region_ids: [], existence: "present", evidence_id: "evidence:room",
    surfaces: [{ field: endpoint.field, owner: "remix", domain: "presentation", risk: "low_reversible",
      direct_assignment: true, coverage: "complete", dependencies: [],
      fact: { state: "present", value: "Before", evidence_id: "evidence:label" } }], takeover_surfaces: null },
  { id: nativeField.entity_id, origin: "native", region_ids: [], existence: "present", evidence_id: "evidence:native",
    surfaces: [{ field: nativeField.field, owner: "native", domain: "progression", risk: "consequential",
      direct_assignment: false, coverage: "complete", dependencies: [],
      fact: { state: "present", value: 0, evidence_id: "evidence:timer" } }], takeover_surfaces: null },
];
const rules = {
  policy: { ...policy, revision: head.expected_policy_revision, world_patch: [], preferences: [], unresolved: [],
    policy_amendment: { ...policy.policy_amendment, generation_rules: [], invariants: [] } },
  history: [], applicability: [],
};
const state = TurnImage.parse({
  checkpoint: { ...checkpoint, story_sha256: policy.story_sha256, revision: head.expected_revision,
    checkpoint_id: "checkpoint:initial", native_state: { pending_input: { kind: "line" },
      payload_sha256: canonicalDigest(imageNative), payload_ref: "blob:" + canonicalDigest(imageNative) },
    remix_state_ref: "blob:" + canonicalDigest(entities), policy_ref: "blob:" + canonicalDigest(rules),
    clocks: { native: 0, overlay: 0, policy: "native_running" },
  },
  snapshot: { version: "1.0.0", head, story_sha256: policy.story_sha256, mode: "PLAY", trigger: "player_attempt",
    clock: { overlay_turn: 0, native_running: true }, ...rules, regions: [], entities, native: null, bridges: [],
    editor_authority: null, guard_evidence: [], compiler_context: null },
  native: imageNative, amendment: null,
});
const access = { owner_id: head.owner_id, session_id: head.session_id, branch_id: head.branch_id };

export function play(requestId = "request:play", current = state, line = "open") {
  const target = current.snapshot.head;
  const boundary = current.checkpoint.native_state.pending_input.kind;
  const operation = boundary === "character" ? { kind: "native.character", value: "y" } : { kind: "native.line", text: line };
  const input = boundary === "character" ? { kind: "character", value: "y" } : { kind: "line", text: line };
  return { access, state: structuredClone(current), envelope: { ...envelope, ...target, input, request_id: requestId, intent: "play" },
    proposal: { ...target, version: "1.0.0", request_id: requestId, mode: "PLAY",
      operations: [operation], declared_effects: [nativeWrite], amendment: null } };
}

export function edit(requestId = "request:edit") {
  return { access, state: structuredClone(state), envelope: { ...envelope, ...head, request_id: requestId, intent: "editor" },
    proposal: { ...head, version: "1.0.0", request_id: requestId, mode: "EDITOR",
      operations: [{ kind: "remix.assign", ...endpoint, value: "Changed" }],
      declared_effects: [{ ...endpoint, change: "write" }], amendment: null } };
}

export function amendment(current?: TurnImage) {
  const request = edit("request:amendment");
  if (current) {
    request.state = structuredClone(current);
    const head = current.snapshot.head;
    Object.assign(request.envelope, head, { request_id: "request:second-amendment" });
    Object.assign(request.proposal, head, { request_id: "request:second-amendment" });
  }
  const priorPolicy = request.state.snapshot.policy;
  const sourceId = priorPolicy.sources[0]?.id;
  if (!sourceId) throw new Error("Fixture needs a prior source.");
  if (!current) priorPolicy.unresolved.push({ source: { source_id: sourceId, start: 0, end: 1 }, reason: "Retain prior clarification." });
  request.state.checkpoint.policy_ref = "blob:" + canonicalDigest({ policy: priorPolicy,
    applicability: request.state.snapshot.applicability, history: request.state.snapshot.history });
  const text = "Change the label. Disable creation. Make everything realistic.";
  const source = { id: current ? "edit-second" : "edit", message_id: current ? "message:2" : "message:1", origin: "editor", provenance: "caller_recorded", text };
  const context = { version: "1.0.0", head: request.state.snapshot.head, story_sha256: state.snapshot.story_sha256,
    policy_id: priorPolicy.policy_id, sources: [source], active_rules: [
      ...priorPolicy.policy_amendment.generation_rules.map((rule) => ({ ...rule, kind: "permission" })),
    ], history: request.state.snapshot.history, guards: [] };
  const interpretation = { version: "1.0.0", context_digest: canonicalDigest(context), clauses: [{
    id: "label", source: { source_id: source.id, start: 0, end: 17 }, quote: text.slice(0, 17),
    entries: [{ kind: "assignment", ...endpoint, value: "Updated" }],
  }, {
    id: "fixed", source: { source_id: source.id, start: 18, end: 35 }, quote: text.slice(18, 35),
    entries: [{ kind: "permission", id: current ? "rule:no-generation-second" : "rule:no-generation", decision: "deny",
      scope: { origins: ["remix"], entity_ids: [], region_ids: [], domains: ["presentation"] },
      action: "generate.item", triggers: ["player_attempt"] }],
  }] };
  const full = take(compileDirective(context, interpretation));
  const selection = { version: "1.0.0", proposal_digest: full.digest, clause_ids: ["label", "fixed"] };
  const compiled = take(selectDirectiveSubset(context, interpretation, selection));
  return { ...request, proposal: { ...request.proposal, operations: [], amendment: { compiled, interpretation, selection } }, context };
}

export function makeFixture(mutate: (execution: Execution) => void = () => {}, gate: () => Promise<void> = () => Promise.resolve()) {
  let executions = 0;
  const executor: TurnExecutor = {
    project(image, proposal) {
      const operation = proposal.operations[0];
      if (operation?.kind !== "native.line" && operation?.kind !== "native.character") return ok(null);
      const { story_sha256, runtime_build, adapter_build, checkpoint_format } = image.checkpoint;
      const identity = { story_sha256, runtime_build, adapter_build, checkpoint_format };
      const pending = image.checkpoint.native_state.pending_input;
      const capability = { id: "capability:fixture", operation: operation.kind, boundary: pending, preconditions: [],
        effects: [nativeWrite], coverage: "supported" as const, evidence: ["synthetic fixture"], recovery: "checkpoint" as const };
      const projected = ResolverSnapshot.shape.native.parse({ identity, pending, manifest: { version: "1.0.0", ...identity,
        capabilities: [capability] }, bindings: [{ capability_id: capability.id, operation_digest: canonicalDigest(operation),
        preconditions: [], suppressed_surfaces: [] }] });
      return ok(projected);
    },
    async execute(image, plan, budget, signal) {
      executions++;
      await gate();
      if (signal.aborted || plan.operations.length > budget.operations) return failure("ABORTED", "Fixture stopped.");
      const native = nativeState.parse(image.native);
      const entities = image.snapshot.entities;
      let pending = image.checkpoint.native_state.pending_input;
      const events = [];
      const output = [];
      let outcome: Execution["outcome"] = "success";
      for (const { operation } of plan.operations) {
        if (operation.kind === "remix.assign") {
          const field = entities.find(({ id }) => id === operation.entity_id)?.surfaces.find(({ field }) => field === operation.field);
          if (!field) return failure("VALIDATION_FAILED", "Unknown fixture field.");
          field.fact = { state: "present", value: operation.value, evidence_id: field.fact.evidence_id };
          events.push({ kind: "assignment", field: field.field });
        }
        if (operation.kind === "inventory.transfer") {
          const holder = entities.find(({ id }) => id === operation.item)?.surfaces.find(({ field }) => field === "inventory:holder");
          const from = entities.find(({ id }) => id === operation.from)?.surfaces.find(({ field }) => field === "inventory:contents");
          const to = entities.find(({ id }) => id === operation.to)?.surfaces.find(({ field }) => field === "inventory:contents");
          if (holder?.fact.state !== "present" || from?.fact.state !== "present" || to?.fact.state !== "present" ||
              !Array.isArray(from.fact.value) || !Array.isArray(to.fact.value)) return failure("VALIDATION_FAILED", "Missing fixture inventory.");
          holder.fact.value = operation.to;
          from.fact.value = from.fact.value.filter((item) => item !== operation.item);
          to.fact.value = [...to.fact.value, operation.item];
          events.push({ kind: "inventory_transfer", item: operation.item });
        }
        if (operation.kind === "native.line" || operation.kind === "native.character") {
          native.counter++;
          native.rng = (native.rng * 17 + 11) % 251;
          pending = { kind: operation.kind === "native.line" ? "character" : "line" };
          outcome = operation.kind === "native.line" && operation.text === "look" ? "success" : "failure";
          output.push(outcome === "success" ? "You look around.\r\n" : "The door stays shut.\r\n");
          native.output.push(...output);
          const field = entities.find(({ id }) => id === nativeField.entity_id)?.surfaces[0];
          if (!field) return failure("VALIDATION_FAILED", "Missing native surface.");
          field.fact = { state: "present", value: native.counter, evidence_id: field.fact.evidence_id };
          events.push({ kind: "native_attempt", counter: native.counter, draw: native.rng });
        }
      }
      const result: Execution = { native, entities, pending, events, output, facts: output.length ? [outcome === "success" ? "The room was observed." : "The door remains shut."] : [],
        effects: plan.operations.flatMap(({ effects }) => effects), time_cost: plan.time === "native" ? 1 : 0,
        outcome };
      mutate(result);
      return ok(result);
    },
    verifyNative(before, after, plan) {
      const old = nativeState.parse(before.native);
      const next = nativeState.parse(after.native);
      const exposed = after.entities.find(({ id }) => id === nativeField.entity_id)?.surfaces[0]?.fact;
      const operation = plan.operations[0]?.operation;
      const expected = operation?.kind === "native.line" ? "character" : "line";
      const successful = operation?.kind === "native.line" && operation.text === "look";
      return next.counter === old.counter + 1 && next.rng === (old.rng * 17 + 11) % 251 &&
        after.pending.kind === expected && exposed?.state === "present" && exposed.value === next.counter &&
        after.time_cost === 1 && after.outcome === (successful ? "success" : "failure") && after.output.length === 1 &&
        after.output[0] === (successful ? "You look around.\r\n" : "The door stays shut.\r\n") &&
        canonicalDigest(next.output) === canonicalDigest([...old.output, ...after.output])
        ? ok(undefined) : failure("VALIDATION_FAILED", "Fixture native postconditions do not hold.");
    },
    verifyRestore(image) {
      const parsed = nativeState.safeParse(structuredClone(image.native));
      return parsed.success && image.checkpoint.checkpoint_format === "format:synthetic" ? ok(undefined) :
        failure("VALIDATION_FAILED", "Unsupported fixture checkpoint.");
    },
  };
  return { ...executor, get executions() { return executions; } };
}
