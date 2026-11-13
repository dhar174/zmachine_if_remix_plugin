import assert from "node:assert/strict";
import { test } from "node:test";
import { DirectiveBundle, HeadExpectation, canonicalDigest } from "../src/contracts.ts";
import { compileDirective } from "../src/policy/directive-compiler.ts";
import { CompilationInput } from "../src/policy/directive-contracts.ts";
import { resolvePolicy } from "../src/policy/policy-resolver.ts";
import type { EffectRef, EntityProjection, ResolverOperation, ResolverSnapshot } from "../src/policy/resolver-contracts.ts";
import { base, manifest } from "./fixture.ts";

const story = "a".repeat(64);
const head = HeadExpectation.parse({
  owner_id: base.owner_id, session_id: base.session_id, branch_id: base.branch_id, generation_id: base.generation_id,
  expected_revision: base.expected_revision, expected_policy_revision: base.expected_policy_revision,
});
const source = { id: "initial", origin: "initial" as const, text: "Protect the fixture." };
const span = { source_id: source.id, start: 0, end: 7 };
const defaults = {
  fidelity: "preserve_authored_behavior", play_semantics: "attempt", unlisted_generation: "deny",
  unknown_facts: "unresolved", implicit_retcons: false, editor_time: "no_game_time",
} as const;
const scope = { origins: ["remix"], entity_ids: [], region_ids: [], domains: ["inventory"] } as const;
const possession = {
  id: "rule:key", source: span, scope, supersedes: [], protected: true,
  guard: { id: "inventory.possession", enforcement: "structural", parameters: { item: "remix:key", holder: "remix:player" } },
} as const;
const effect = (entity_id: string, field: string, change: EffectRef["change"] = "write"): EffectRef =>
  ({ entity_id, field, change });
function field(field: string, domain: EntityProjection["surfaces"][number]["domain"],
  value: import("../src/contracts.ts").Json, options: Partial<EntityProjection["surfaces"][number]> = {}):
  EntityProjection["surfaces"][number] {
  return { field, domain, owner: "remix", risk: "consequential", coverage: "complete", direct_assignment: true,
    fact: { state: "present", value, evidence_id: "evidence:fixture" }, dependencies: [], ...options };
}
function entity(id: string, surfaces: EntityProjection["surfaces"], region: string | null = "region:outside"): EntityProjection {
  return { id, surfaces, origin: id.startsWith("native:") ? "native" : "remix", region_ids: region ? [region] : null,
    existence: "present", evidence_id: "evidence:entity", takeover_surfaces: null };
}
function policy(generation_rules: unknown[] = [], invariants: unknown[] = [], sources: unknown[] = [source]) {
  return DirectiveBundle.parse({ version: "1.0.0", policy_id: "policy:fixture", revision: 1, story_sha256: story,
    sources, policy_amendment: { defaults, generation_rules, invariants }, world_patch: [],
    preferences: [], unresolved: [] });
}
function snapshot(overrides: Partial<ResolverSnapshot> = {}): ResolverSnapshot {
  return { version: "1.0.0", head, story_sha256: story, mode: "PLAY", trigger: "player_attempt",
    clock: { overlay_turn: 2, native_running: true }, policy: policy(), history: [], applicability: [],
    regions: ["region:outside", "region:vault"], entities: [], native: null, bridges: [], editor_authority: null,
    guard_evidence: [], compiler_context: null, ...overrides };
}
function proposal(operations: ResolverOperation[], declared_effects: EffectRef[]) {
  return { ...head, version: "1.0.0", request_id: "request:resolver", mode: "PLAY", operations, declared_effects, amendment: null };
}
function reject(result: ReturnType<typeof resolvePolicy>, status: string, reason: string) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected rejection");
  assert.equal(result.error.status, status);
  assert.equal(result.error.reason, reason);
  assert.equal("plan" in result, false);
  return result.trace;
}
function approve(context: ResolverSnapshot, request: Parameters<typeof canonicalDigest>[0]): ResolverSnapshot {
  return { ...context, mode: "EDITOR", editor_authority: { proposal_digest: canonicalDigest(request), evidence_id: "grant:fixture" } };
}
function capability(op: ResolverOperation, effects: EffectRef[], suppressed_surfaces: EffectRef[] = []): ResolverSnapshot["native"] {
  return {
    identity: { story_sha256: story, runtime_build: story, adapter_build: story, checkpoint_format: "format:synthetic" },
    pending: { kind: "line" },
    manifest: { ...manifest, version: "1.0.0", capabilities: [{ id: "capability:fixture", operation: op.kind === "overlay.create" ? "remix.assign" : op.kind,
      boundary: { kind: "line" }, effects, coverage: "supported", preconditions: [],
      evidence: ["evidence:adapter"], recovery: "checkpoint" }] },
    bindings: [{ capability_id: "capability:fixture", operation_digest: canonicalDigest(op), preconditions: [], suppressed_surfaces }],
  };
}

void test("A03 allows an ordinary drop, enforces a possession rule, and emits a deterministic immutable plan", () => {
  const entities = [
    entity("remix:key", [field("inventory:holder", "inventory", "remix:player")]),
    entity("remix:player", [field("inventory:contents", "inventory", ["remix:key"])]),
    entity("remix:floor", [field("inventory:contents", "inventory", [])]),
  ];
  const op = { kind: "inventory.transfer", item: "remix:key", from: "remix:player", to: "remix:floor" } as const;
  const effects = [effect(op.item, "inventory:holder"), effect(op.from, "inventory:contents"), effect(op.to, "inventory:contents")];
  const input = proposal([op], effects);
  const state = snapshot({ entities });
  const before = structuredClone({ state, input });
  const allowed = resolvePolicy(state, input);
  assert.ok(allowed.ok);
  assert.equal(allowed.plan.route, "remix");
  assert.equal(allowed.plan.time, "overlay");
  assert.deepEqual(allowed.plan.trace.evidence_ids, ["evidence:entity", "evidence:fixture"]);
  assert.deepEqual(resolvePolicy(state, input), allowed);
  assert.deepEqual({ state, input }, before);
  const trace = reject(resolvePolicy(snapshot({ entities, policy: policy([], [possession]) }), input),
    "POLICY_CONFLICT", "invariant_violation");
  assert.deepEqual(trace.rule_ids, [possession.id]);
  reject(resolvePolicy(state, proposal([op], effects.slice(0, 2))), "VALIDATION_FAILED", "declared_footprint");
});

void test("A04–A05 evaluates a real #15 partition only with fresh exact Editor authority", () => {
  const old = { id: "rule:persona", source: span, scope: { ...scope, entity_ids: ["remix:guard", "remix:keeper"],
    domains: ["characterization"] }, supersedes: [], protected: true,
    guard: { id: "field.unchanged", enforcement: "structural", parameters: { field: "character:mood" } } };
  const context = snapshot({
    mode: "EDITOR", policy: policy([], [old]),
    entities: ["remix:guard", "remix:keeper"].map((id) => entity(id, [field("character:mood", "characterization", "stern")])),
  });
  const assign = (entity_id: string) => ({ kind: "remix.assign", entity_id, field: "character:mood", value: "friendly" } as const);
  const broad = { ...proposal([assign("remix:guard"), assign("remix:keeper")],
    [effect("remix:guard", "character:mood"), effect("remix:keeper", "character:mood")]), mode: "EDITOR" };
  reject(resolvePolicy(approve(context, broad), broad), "POLICY_CONFLICT", "invariant_violation");
  const text = "Replace only the guard protection.";
  const compileContext = CompilationInput.parse({
    version: "1.0.0", head, story_sha256: story, policy_id: "policy:fixture",
    sources: [{ id: "edit", message_id: "message:1", origin: "editor", provenance: "caller_recorded", text }],
    active_rules: [{ ...old, kind: "invariant" }], history: [],
    guards: [{ id: "field.unchanged", enforcement: "structural", parameters: { field: "string" }, protected_fields: ["character:mood"] }],
  });
  const piece = (id: string, target: string) => ({ kind: "invariant", id, protected: true,
    scope: { ...old.scope, origins: [...old.scope.origins], region_ids: [...old.scope.region_ids], entity_ids: [target] },
    guard: old.guard });
  const interpretation = { version: "1.0.0", context_digest: canonicalDigest(compileContext), clauses: [{
    id: "clause:replace", source: { source_id: "edit", start: 0, end: text.length }, quote: text,
    entries: [{ kind: "supersession", old_rule_id: old.id,
      replacement: { ...piece("rule:guard", "remix:guard"),
        guard: { ...old.guard, parameters: { field: "character:identity" } } }, retained: [piece("rule:keeper", "remix:keeper")] }],
  }] };
  const compiled = compileDirective(compileContext, interpretation);
  assert.ok(compiled.ok);
  const request = { ...proposal([], []), mode: "EDITOR", amendment: { compiled: compiled.value, interpretation, selection: null } };
  const parsedContext = { ...context, compiler_context: compileContext };
  reject(resolvePolicy(parsedContext, request), "NEEDS_APPROVAL", "exact_authority");
  const allowed = resolvePolicy(approve(parsedContext, request), request);
  assert.ok(allowed.ok);
  assert.equal(allowed.plan.time, "none");
  assert.deepEqual(allowed.plan.amendment?.active_rules.map(({ id, scope }) => [id, scope.entity_ids]),
    [["rule:guard", ["remix:guard"]], ["rule:keeper", ["remix:keeper"]]]);
  assert.deepEqual(allowed.plan.amendment?.compiled, compiled.value);
  const next = policy([], allowed.plan.amendment?.active_rules.map(({ kind, ...rule }) => {
    assert.equal(kind, "invariant");
    return rule;
  }), [source, { id: "edit", origin: "editor", text }]);
  const subsequent = { ...parsedContext, policy: next,
    history: [{ id: old.id, supersedes: [] }] };
  const guardOnly = { ...broad, operations: [assign("remix:guard")], declared_effects: [effect("remix:guard", "character:mood")] };
  assert.ok(resolvePolicy(approve(subsequent, guardOnly), guardOnly).ok);
  reject(resolvePolicy(approve(subsequent, broad), broad), "POLICY_CONFLICT", "invariant_violation");
  assert.equal(context.policy.policy_amendment.invariants[0]?.id, old.id);
  reject(resolvePolicy(parsedContext, { ...request, expected_revision: 0 }), "STALE_REVISION", "proposal_revision");
  const tampered = { ...request, amendment: { ...request.amendment, compiled: { ...compiled.value, digest: "b".repeat(64) } } };
  reject(resolvePolicy(approve(parsedContext, tampered), tampered), "VALIDATION_FAILED", "amendment_integrity");
});

const allow = (id: string, action: string, domain: string, decision = "allow", options = {}) => ({
  id, action, source: span, scope: { ...scope, domains: [domain], region_ids: ["region:outside"] }, supersedes: [],
  decision, triggers: ["player_attempt"], ...options,
});
const shop = { kind: "overlay.create", entity: "remix:new-shop", region: "region:outside", entity_kind: "location", label: "Shop" } as const;
const shopEffect = effect(shop.entity, "entity:record");

void test("A06 generated scope/trigger cases enforce deny precedence without deleting an existing shop", () => {
  const shopRule = allow("rule:shops", "generate.location", "identity");
  const deny = allow("rule:stop", "generate.location", "identity", "deny");
  for (const trigger of ["player_attempt", "autonomous_event"] as const) {
    for (const denied of [false, true]) {
      for (const activeWindow of [false, true]) {
        const state = snapshot({ trigger, entities: [entity("remix:old-shop", [field("entity:record", "identity", "Old shop")])],
          policy: policy(denied ? [shopRule, deny] : [shopRule]),
          applicability: denied ? [{ rule_id: deny.id, from_turn: activeWindow ? 2 : 3, until_turn: null }] : [] });
        const result = resolvePolicy(state, proposal([shop], [shopEffect]));
        assert.equal(result.ok, trigger === "player_attempt" && !(denied && activeWindow));
        const inspect = resolvePolicy(state, proposal([{ kind: "inspect.entity", entity_id: "remix:old-shop" }],
          [effect("remix:old-shop", "entity:record", "read")]));
        assert.ok(inspect.ok);
        assert.equal(inspect.plan.time, "none");
        assert.equal(state.entities.length, 1);
      }
    }
  }
});

void test("A07 a mixed shop and shortcut proposal cannot omit endpoints or protected progression dependencies", () => {
  const connect = { kind: "overlay.connect", connection: "remix:shortcut", from: shop.entity, to: "native:vault" } as const;
  const vault = effect("native:vault", "topology:exits");
  const gate = effect("native:vault", "progression:gate");
  const scheduled = effect("remix:rule", "rule:scheduled");
  const contents = effect("remix:rule", "inventory:contents");
  const complete = [shopEffect, effect(connect.connection, "topology:connection"),
    effect(connect.from, "topology:exits"), vault, gate, scheduled, contents];
  const entities = [
    entity("native:vault", [
      field(vault.field, "topology", [], { owner: "native", dependencies: [gate, scheduled] }),
      field(gate.field, "progression", "locked", { owner: "native" }),
    ], "region:vault"),
    entity("remix:rule", [field(scheduled.field, "topology", [], { dependencies: [contents] }), field(contents.field, "inventory", [])]),
  ];
  const bridge = { id: "bridge:fixture", operation_digest: canonicalDigest(connect), native_capability_id: "capability:fixture",
    effects: complete.slice(1), evidence_id: "evidence:bridge" };
  const broadConnection = allow("rule:connection", "generate.connection", "topology", "allow", {
    scope: { origins: ["native", "remix"], entity_ids: [], region_ids: [], domains: ["topology", "progression", "inventory"] },
  });
  const protect = { ...possession, id: "rule:vault", scope: { origins: ["native"], entity_ids: ["native:vault"],
    region_ids: ["region:vault"], domains: ["progression"] },
    guard: { id: "field.unchanged", enforcement: "structural", parameters: { field: gate.field } } };
  const common = { entities, native: capability(connect, [vault, gate]), bridges: [bridge] };
  const shopRule = allow("rule:shop", "generate.location", "identity");
  const denied = snapshot({ ...common, policy: policy([shopRule, broadConnection], [protect]) });
  for (const declared of [complete, complete.filter((e) => e.entity_id !== "native:vault")]) {
    const trace = reject(resolvePolicy(denied, proposal([shop, connect], declared)), "POLICY_CONFLICT", "invariant_violation");
    assert.ok(trace.rule_ids.includes(protect.id));
  }
  const open = snapshot({ ...common, policy: policy([shopRule, broadConnection]) });
  for (const omitted of complete) {
    reject(resolvePolicy(open, proposal([shop, connect], complete.filter((e) => e !== omitted))),
      "VALIDATION_FAILED", "declared_footprint");
  }
  const allowed = resolvePolicy(open, proposal([shop, connect], complete));
  assert.ok(allowed.ok);
  assert.equal(allowed.plan.route, "bridged");
  assert.deepEqual(allowed.plan.trace.capability_ids, ["bridge:fixture", "capability:fixture"]);
});

void test("A08 absence, lack of observation, unmapped state and conflicting observations stay distinct", () => {
  for (const existence of ["absent", "unobserved", "unmapped", "contradictory"] as const) {
    const state = snapshot({ entities: [{ ...entity("native:windowsill", []), existence, evidence_id: "evidence:parser-rejection" }] });
    const trace = reject(resolvePolicy(state, proposal([{ kind: "inspect.entity", entity_id: "native:windowsill" }], [])),
      "NEEDS_CLARIFICATION", `entity_${existence}`);
    assert.deepEqual(trace.evidence_ids, ["evidence:parser-rejection"]);
  }
  const invention = { ...shop, entity_kind: "item", label: "Windowsill", entity: "remix:windowsill" } as const;
  reject(resolvePolicy(snapshot(), proposal([invention], [effect(invention.entity, "entity:record")])),
    "POLICY_CONFLICT", "no_allowance");
});

void test("A17 and A20 require exact native operations and coverage of conflicting routines", () => {
  const op = { kind: "dialogue.change", character: "native:guard", takeover: true, text: "New greeting" } as const;
  const script = effect(op.character, "dialogue:script");
  const routine = effect(op.character, "progression:scene");
  const guard = { ...entity(op.character, [field(script.field, "dialogue", "Old greeting"),
    field(routine.field, "progression", "active", { owner: "native" })]), takeover_surfaces: [routine] };
  const request = { ...proposal([op], [script, routine]), mode: "EDITOR" };
  const state = approve(snapshot({ entities: [guard] }), request);
  reject(resolvePolicy(state, request), "CAPABILITY_MISSING", "native_identity");
  reject(resolvePolicy({ ...state, native: capability(op, [routine]) }, request), "CAPABILITY_MISSING", "takeover_coverage");
  const bridge = { id: "bridge:dialogue", operation_digest: canonicalDigest(op), native_capability_id: "capability:fixture",
    effects: [script, routine], evidence_id: "evidence:bridge" };
  const supported = { ...state, native: capability(op, [routine], [routine]), bridges: [bridge] };
  const result = resolvePolicy(supported, request);
  assert.ok(result.ok);
  assert.equal(result.plan.route, "bridged");
  assert.equal(result.plan.time, "none");
  const changed = { ...request, operations: [{ ...op, text: "Different greeting" }] };
  reject(resolvePolicy(approve(supported, changed), changed), "CAPABILITY_MISSING", "operation_binding");
});

void test("authored native input binds to pending input and exact builds, with no generated fallback", () => {
  const op = { kind: "native.line", text: "look" } as const;
  const native = capability(op, []);
  assert.ok(native);
  const state = snapshot({ native });
  const result = resolvePolicy(state, proposal([op], []));
  assert.ok(result.ok);
  assert.equal(result.plan.route, "native");
  assert.equal(result.plan.time, "native");
  reject(resolvePolicy({ ...state, native: { ...native, pending: { kind: "character" } } }, proposal([op], [])),
    "CAPABILITY_MISSING", "native_input");
  reject(resolvePolicy({ ...state, native: { ...native, identity: { ...native.identity, adapter_build: "b".repeat(64) } } },
    proposal([op], [])), "CAPABILITY_MISSING", "native_identity");
});

void test("uncertain region membership and consequential semantic uncertainty block proposed writes", () => {
  const op = { kind: "dialogue.change", character: "remix:guard", text: "Hi", takeover: false } as const;
  const change = effect(op.character, "dialogue:overlay");
  const request = proposal([op], [change]);
  const permission = allow("rule:dialogue", "dialogue.adapt", "dialogue");
  const semantic = { ...possession, id: "rule:tone", protected: false,
    scope: { ...scope, domains: ["dialogue"] }, guard: { id: "semantic:tone", enforcement: "semantic", parameters: {} } };
  const makeState = (region: string | null, risk: "low_reversible" | "consequential") => snapshot({
    entities: [entity(op.character, [field(change.field, "dialogue", "Hello", { risk })], region)],
    policy: policy([permission], [semantic]),
  });
  reject(resolvePolicy(makeState(null, "low_reversible"), request), "NEEDS_CLARIFICATION", "unknown_scope");
  const trace = reject(resolvePolicy(makeState("region:outside", "consequential"), request), "NEEDS_CLARIFICATION", "guard_unresolved");
  assert.equal(trace.semantic[0]?.outcome, "uncertain");
  const result = resolvePolicy(makeState("region:outside", "low_reversible"), request);
  assert.ok(result.ok);
  assert.equal(result.plan.trace.semantic[0]?.outcome, "best_effort");
});
