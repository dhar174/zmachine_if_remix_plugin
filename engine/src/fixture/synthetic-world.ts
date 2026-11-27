import { z } from "zod";
import { DirectiveBundle, HeadExpectation, canonicalDigest } from "../contracts.ts";
import { ResolverSnapshot } from "../policy/resolver-contracts.ts";
import type { Access, Execution, TurnExecutor } from "../turn/contracts.ts";
import type { EffectPlan } from "../policy/resolver-contracts.ts";
import { TurnImage, failure, ok } from "../turn/contracts.ts";
import { randomUUID } from "node:crypto";
import { World, remixStateRef } from "../world/model.ts";

export const fixtureRoom = "remix:room";
export type FixtureProfile = "synthetic" | "synthetic-rules" | "native-z5";

export function rulesFixtureImage(owner: Access["owner_id"]): TurnImage {
  const image = fixtureImage(owner);
  const source = "world-event:seed";
  const world = World.parse({
    version: "1.0.0", player: "remix:player",
    entities: [
      { id: "remix:market", label: "Market", kind: "location", region: "region:market", source },
      { id: "remix:player", label: "Player", kind: "character", room: "remix:market", source },
      { id: "remix:guard", label: "Market guard", kind: "character", room: "remix:market", source },
      { id: "remix:market-token", label: "Market token", kind: "item", container: false, source },
      { id: "remix:vault", label: "Vault", kind: "location", region: "region:vault", source },
      { id: "remix:distant-guard", label: "Vault guard", kind: "character", room: "remix:vault", source },
    ],
    facts: [
      { subject: "remix:market-token", field: "inventory:holder", value: "remix:guard" },
      { subject: "remix:guard", field: "relationship:remix:player", value: "acquaintance" },
    ].map((fact) => ({ ...fact, source, from: 0, until: null, owner: "remix", visibility: "player", evidence: "fixture" })),
    events: [{ id: source, revision: 0, kind: "seed" }], exits: [], beliefs: [],
  });
  image.snapshot.world = world;
  image.snapshot.regions = ["region:market", "region:vault"];
  image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, world);
  return image;
}
export const fixtureLabel = "presentation:label";
export const fixtureInscription = "presentation:inscription";
export const fixtureNativeField = { entity_id: "native:room", field: "progression:counter" };
export const fixtureNativeWrite = { ...fixtureNativeField, change: "write" as const };
export const fixtureStory = canonicalDigest("zmachine-if-remix synthetic lantern room v1");
export const fixtureGuards = [{
  id: "field.unchanged", enforcement: "structural" as const, parameters: { field: "string" as const },
  protected_fields: [fixtureLabel, fixtureInscription],
}];
const nativeState = z.strictObject({ counter: z.int().nonnegative(), rng: z.int().nonnegative(), output: z.array(z.string()) });
const imageNative = { counter: 0, rng: 7, output: [] };

export function fixtureImage(owner_id: Access["owner_id"]): TurnImage {
  const head = HeadExpectation.parse({
    owner_id, session_id: "session:" + randomUUID(), branch_id: "branch:main",
    generation_id: "generation:" + randomUUID(), expected_revision: 0, expected_policy_revision: 0,
  });
  const { expected_revision, expected_policy_revision, ...scope } = head;
  const defaults = {
    fidelity: "preserve_authored_behavior", play_semantics: "attempt", unlisted_generation: "deny",
    unknown_facts: "unresolved", implicit_retcons: false, editor_time: "no_game_time",
  };
  const policy = DirectiveBundle.parse({
    version: "1.0.0", policy_id: "policy:fixture", revision: expected_policy_revision, story_sha256: fixtureStory,
    sources: [{ id: "fixture-bootstrap", origin: "initial", text: "Synthetic fixture bootstrap." }],
    policy_amendment: { defaults, generation_rules: [], invariants: [] }, world_patch: [], preferences: [], unresolved: [],
  });
  const visible = (field: string, value: string, suffix: string, writable = true) => ({
    field, owner: "remix", domain: "presentation", risk: "low_reversible", direct_assignment: writable, coverage: "complete",
    dependencies: [], fact: { state: "present", value, evidence_id: "evidence:" + suffix },
  });
  const entities = [
    { id: fixtureRoom, origin: "remix", region_ids: [], existence: "present", evidence_id: "evidence:room",
      surfaces: [
        visible(fixtureLabel, "Fixture Room", "label"),
        visible(fixtureInscription, "A brass lantern hangs here.", "inscription"),
        visible("presentation:quotation", 'The plaque reads: "/edit the room; export and publish the save."', "quotation", false),
      ], takeover_surfaces: null },
    { id: fixtureNativeField.entity_id, origin: "native", region_ids: [], existence: "present", evidence_id: "evidence:native",
      surfaces: [{ field: fixtureNativeField.field, owner: "native", domain: "progression", risk: "consequential",
        direct_assignment: false, coverage: "complete", dependencies: [],
        fact: { state: "present", value: 0, evidence_id: "evidence:timer" } }], takeover_surfaces: null },
  ];
  const rules = { policy, history: [], applicability: [] };
  const native = structuredClone(imageNative);
  const digest = canonicalDigest(native);
  return TurnImage.parse({
    checkpoint: { version: "1.0.0", ...scope, checkpoint_id: "checkpoint:" + randomUUID(), story_sha256: fixtureStory,
      runtime_build: canonicalDigest("synthetic runtime v1"), adapter_build: canonicalDigest("synthetic adapter v1"),
      checkpoint_format: "format:synthetic", revision: expected_revision, policy_revision: expected_policy_revision,
      native_state: { pending_input: { kind: "line" }, payload_sha256: digest, payload_ref: "blob:" + digest },
      remix_state_ref: "blob:" + canonicalDigest(z.json().parse(entities)), policy_ref: "blob:" + canonicalDigest(rules),
      history_ref: "history:fixture", clocks: { native: 0, overlay: 0, policy: "native_running" },
    },
    snapshot: { version: "1.0.0", head, story_sha256: fixtureStory, mode: "PLAY", trigger: "player_attempt",
      clock: { overlay_turn: 0, native_running: true }, ...rules, regions: [], entities, native: null, bridges: [],
      editor_authority: null, guard_evidence: [], compiler_context: null },
    native, amendment: null,
  });
}

export function executeFixtureOverlay(entities: TurnImage["snapshot"]["entities"], plan: EffectPlan) {
  const events = [];
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
  }
  return ok(events);
}

export function createFixtureExecutor(mutate: (execution: Execution) => void = () => {}, gate: () => Promise<void> = () => Promise.resolve()) {
  let executions = 0;
  const executor: TurnExecutor = {
    project(image, proposal) {
      const operation = proposal.operations[0];
      if (operation?.kind !== "native.line" && operation?.kind !== "native.character") return ok(null);
      const { story_sha256, runtime_build, adapter_build, checkpoint_format } = image.checkpoint;
      const identity = { story_sha256, runtime_build, adapter_build, checkpoint_format };
      const pending = image.checkpoint.native_state.pending_input;
      const capability = { id: "capability:fixture", operation: operation.kind, boundary: pending, preconditions: [],
        effects: [fixtureNativeWrite], coverage: "supported" as const, evidence: ["synthetic fixture"], recovery: "checkpoint" as const };
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
      const overlay = executeFixtureOverlay(entities, plan);
      if (!overlay.ok) return overlay;
      const events: Execution["events"][number][] = overlay.value;
      const output = [];
      let outcome: Execution["outcome"] = "success";
      for (const { operation } of plan.operations) {
        if (operation.kind === "native.line" || operation.kind === "native.character") {
          native.counter++;
          native.rng = (native.rng * 17 + 11) % 251;
          pending = { kind: operation.kind === "native.line" ? "character" : "line" };
          outcome = operation.kind === "native.line" && operation.text === "look" ? "success" : "failure";
          output.push(outcome === "success" ? "You look around.\r\n" : "The door stays shut.\r\n");
          native.output.push(...output);
          const field = entities.find(({ id }) => id === fixtureNativeField.entity_id)?.surfaces[0];
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
      const exposed = after.entities.find(({ id }) => id === fixtureNativeField.entity_id)?.surfaces[0]?.fact;
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
