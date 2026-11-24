
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { canonicalDigest, canonicalJson } from "../src/contracts.ts";
import type { ResolverOperation } from "../src/policy/resolver-contracts.ts";
import { compileDirective } from "../src/policy/directive-compiler.ts";
import { decodePortable, encodePortable, relocatePortable } from "../src/fixture/portable-session.ts";
import { target as recoveryTarget } from "../src/fixture/session-contracts.ts";
import { buildImage, executeWorld, validateImage } from "../src/turn/execution.ts";
import { resolvePolicy } from "../src/policy/policy-resolver.ts";
import { SQLiteTurns, branchKey } from "../src/turn/sqlite-turns.ts";
import { TurnService } from "../src/turn/service.ts";
import { TurnImage } from "../src/turn/contracts.ts";
import type { FaultPoint } from "../src/turn/contracts.ts";
import { remixStateRef } from "../src/world/model.ts";
import { fixtureImage } from "../src/fixture/synthetic-world.ts";
import { makeFixture, play, take } from "./turn-fixture.ts";

function setup(fault?: (point: FaultPoint) => void) {
  const dir = mkdtempSync(join(tmpdir(), "zirp-world-"));
  const file = join(dir, "state.db");
  let store = new SQLiteTurns(file);
  let service = new TurnService(store, makeFixture(), Date.now, fault);
  const state = fixtureImage(play().access.owner_id);
  const { owner_id, session_id, branch_id } = state.snapshot.head;
  const access = { owner_id, session_id, branch_id };
  const seed: unknown = JSON.parse(readFileSync(new URL("./fixtures/generated-world.v1.json", import.meta.url), "utf8"));
  const image = TurnImage.parse({ ...state, snapshot: { ...state.snapshot, regions: ["region:market", "region:vault"], world: seed } });
  const { policy, history, applicability } = image.snapshot;
  const source = { source_id: policy.sources[0]!.id, start: 0, end: 1 };
  policy.policy_amendment.generation_rules = (["location", "item", "character", "connection"] as const).map((kind) => ({
    id: "rule:" + kind, action: `generate.${kind}`, decision: "allow", triggers: ["player_attempt"], source, supersedes: [],
    scope: { origins: ["remix"], entity_ids: [], region_ids: ["region:market"], domains: ["identity", "topology", "inventory"] },
  }));
  image.checkpoint.policy_ref = "blob:" + canonicalDigest({ policy, history, applicability });
  image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, image.snapshot.world);
  take(service.initialize(image));
  store.transaction(() => store.saveFixtureRecord("session", branchKey(access), true));
  function head() {
    return store.head(access)!;
  }
  function request(id: string, operations: ResolverOperation[], mode: "PLAY" | "EDITOR" = "PLAY", input = id) {
    const current = head().snapshot.head;
    return {
      envelope: { ...current, version: "1.0.0", request_id: "request:" + id,
        intent: operations.every(({ kind }) => kind === "inspect.entity") ? "inspect" : mode === "PLAY" ? "play" : "editor",
        input: { kind: "line", text: input } },
      proposal: { ...current, version: "1.0.0", request_id: "request:" + id, mode, operations, declared_effects: [], amendment: null },
    };
  }
  function prepare(req: { envelope: unknown; proposal: unknown }, compiler?: unknown) {
    const result = take(service.prepareTurn(access, req.envelope, req.proposal, compiler));
    assert.equal(result.kind, "prepared");
    return result;
  }
  async function commit(req: ReturnType<typeof request>) {
    const stage = prepare(req);
    if (req.proposal.mode === "PLAY") return take(await service.commitTurn(access, req.envelope, stage.handle.candidate_id));
    const { handle } = stage;
    const grant = take(service.browser.confirm(access.owner_id, handle.candidate_id, stage.diff_digest));
    return take(await service.commitTurn(access, req.envelope, handle.candidate_id, {
      candidate_id: handle.candidate_id, source: "approval", reference: grant.grant_id, diff_digest: stage.diff_digest,
    }));
  }
  function mode(value: "play" | "edit") {
    take(service.browser.control(access.owner_id, head().snapshot.head, "request:mode", "/" + value));
  }
  return { get service() { return service; }, get store() { return store; }, access, head, request, prepare, commit, mode, image,
    reopen() {
      service.close();
      store = new SQLiteTurns(file);
      service = new TurnService(store, makeFixture(), Date.now, fault);
    },
    file,
    close() {
      service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

void test("A01/A36 speech and belief require real participation and preserve objective history", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const text = "We are old friends";
  const initial = structuredClone(fx.head().snapshot.world!.facts);
  const forged = fx.request("forged", [{ kind: "speech.record", text }], "PLAY", "different speech");
  assert.equal(fx.service.prepareTurn(fx.access, forged.envelope, forged.proposal).ok, false);
  await fx.commit(fx.request("speech", [{ kind: "speech.record", text }], "PLAY", text));
  const speech = fx.head().snapshot.world!.events.find(({ kind }) => kind === "speech");
  assert.equal(speech?.kind, "speech");
  assert.deepEqual(speech.listeners, ["remix:guard"]);
  const absent = fx.request("absent", [{ kind: "belief.update", character: "remix:distant-guard", evidence: speech.id }]);
  assert.equal(fx.service.prepareTurn(fx.access, absent.envelope, absent.proposal).ok, false);
  await fx.commit(fx.request("belief", [{ kind: "belief.update", character: "remix:guard", evidence: speech.id }]));
  const world = fx.head().snapshot.world!;
  assert.deepEqual(world.facts, initial);
  assert.deepEqual(world.beliefs.map(({ character, evidence }) => ({ character, evidence })),
    [{ character: "remix:guard", evidence: speech.id }]);
  assert.equal(canonicalJson(TurnImage.parse(JSON.parse(canonicalJson(fx.head())))), canonicalJson(fx.head()));
});

void test("A19/A30 generated identities and topology remain atomic through faults and concurrent retries", async (t) => {
  let fail = true;
  const fx = setup((point) => { if (fail && point === "before_commit") throw new Error("injected publication fault"); });
  t.after(() => fx.close());
  const room: ResolverOperation = { kind: "overlay.create", entity_kind: "location", entity: "remix:stall", region: "region:market", label: "Market" };
  const before = fx.head();
  const blocked = fx.request("blocked", [room, { kind: "overlay.connect", connection: "remix:shortcut", from: "remix:market", to: "remix:vault" }]);
  const rejected = fx.service.prepareTurn(fx.access, blocked.envelope, blocked.proposal);
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.status, "POLICY_CONFLICT");
  const req = fx.request("create", [room]);
  const stage = fx.prepare(req);
  assert.equal((await fx.service.commitTurn(fx.access, req.envelope, stage.handle.candidate_id)).ok, false);
  assert.deepEqual(fx.head(), before);
  fail = false;
  const result = (await Promise.all([1, 2].map(() => fx.service.commitTurn(fx.access, req.envelope, stage.handle.candidate_id)))).map(take);
  assert.deepEqual(result[0], result[1]);
  assert.deepEqual(fx.head().snapshot.world?.entities.filter(({ label }) => label === "Market").map(({ id }) => id),
    ["remix:market", "remix:stall"]);
  const changed = fx.service.prepareTurn(fx.access, req.envelope, { ...req.proposal, operations: [{ ...room, label: "Different" }] });
  assert.ok(!changed.ok);
  assert.equal(changed.error.subtype, "IDEMPOTENCY_CONFLICT");
  const connection = { kind: "overlay.connect", connection: "remix:market-exit", from: "remix:market", to: "remix:stall" } as const;
  await fx.commit(fx.request("connect", [connection]));
  assert.deepEqual(fx.head().snapshot.world?.exits.map(({ from, to }) => [from, to]), [[connection.from, connection.to]]);
});

void test("A02 overlay item grant is a one-time Editor operation with reversible containment", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  fx.mode("edit");
  await fx.commit(fx.request("grant", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:key", region: "region:market",
    label: "Key", holder: "remix:player" }], "EDITOR"));
  assert.deepEqual(fx.head().snapshot.policy.world_patch, []);
  fx.mode("play");
  const unchanged = fx.head();
  const wrong = fx.request("wrong-transfer", [{ kind: "inventory.transfer", item: "remix:key", from: "remix:guard", to: "remix:market" }]);
  assert.equal(fx.service.prepareTurn(fx.access, wrong.envelope, wrong.proposal).ok, false);
  assert.deepEqual(fx.head(), unchanged);
  const drop = fx.request("drop", [{ kind: "inventory.transfer", item: "remix:key", from: "remix:player", to: "remix:market" }]);
  await fx.commit(drop);
  const placements = fx.head().snapshot.world!.facts.filter(({ subject, field }) =>
    subject === "remix:key" && field === "inventory:holder");
  assert.deepEqual(placements.map(({ value }) => value), ["remix:player", "remix:market"]);
  assert.ok(placements[0]?.until);
  assert.equal(placements[0].until, placements[1]?.from);
  assert.equal(placements[1]?.until, null);
  const pickUp = fx.request("take", [{ kind: "inventory.transfer", item: "remix:key", from: "remix:market", to: "remix:player" }]);
  await fx.commit(pickUp);
  assert.equal(fx.head().snapshot.world!.facts.find(({ subject, until }) => subject === "remix:key" && until === null)?.value,
    "remix:player");
});


function editBundle(fx: ReturnType<typeof setup>, label: string, entries: unknown[]) {
  const { head, story_sha256, policy, history } = fx.head().snapshot;
  const source = { id: "source:" + label, origin: "editor", message_id: "message:" + label, provenance: "caller_recorded", text: label };
  const context = { version: "1.0.0", head, story_sha256, policy_id: policy.policy_id, history, sources: [source],
    guards: [{ id: "inventory.possession", enforcement: "structural", parameters: { item: "string", holder: "string" },
      protected_fields: ["inventory:holder"] }],
    active_rules: [
      ...policy.policy_amendment.generation_rules.map((rule) => ({ ...rule, kind: "permission" })),
      ...policy.policy_amendment.invariants.map((rule) => ({ ...rule, kind: "invariant" })),
    ],
  };
  const span = { source_id: source.id, start: 0, end: label.length };
  const interpretation = { version: "1.0.0", context_digest: canonicalDigest(context),
    clauses: [{ id: "clause", source: span, quote: label, entries }] };
  const compiled = take(compileDirective(context, interpretation));
  const req = fx.request(label, [], "EDITOR");
  req.envelope.intent = "editor";
  const proposal = { ...req.proposal, amendment: { compiled, interpretation, selection: null } };
  const stage = fx.prepare({ ...req, proposal }, context);
  const candidate_id = stage.handle.candidate_id;
  const diff_digest = stage.diff_digest;
  const confirmation = take(fx.service.browser.confirm(fx.access.owner_id, candidate_id, diff_digest));
  return () => fx.service.commitTurn(fx.access, req.envelope, candidate_id, {
    candidate_id, diff_digest, source: "approval", reference: confirmation.grant_id,
  });
}

const protectedScope = (domains: string[]) => ({
  origins: ["remix"], entity_ids: [], region_ids: ["region:market"], domains,
});

void test("A03/A06/A30 approved policy changes preserve existing entities and roll back with a failing typed fact assignment", async (t) => {
  let fail = false;
  const fx = setup((point) => { if (fail && point === "before_commit") throw new Error("injected publication fault"); });
  t.after(() => fx.close());
  await fx.commit(fx.request("existing", [{ kind: "overlay.create", entity_kind: "character", entity: "remix:new-guard",
    room: "remix:market", region: "region:market", label: "Guard" }]));
  fx.mode("edit");
  await fx.commit(fx.request("grant", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:key", region: "region:market",
    label: "Key", holder: "remix:player" }], "EDITOR"));
  const before = fx.head();
  const entries = [
    { kind: "assignment", entity_id: "remix:new-guard", field: "relationship:remix:player", value: "acquaintance" },
    { kind: "permission", id: "rule:stop-characters", decision: "deny", triggers: ["player_attempt"], action: "generate.character",
      scope: protectedScope(["identity"]) },
    { kind: "invariant", id: "rule:keep-key", protected: true, scope: protectedScope(["inventory"]),
      guard: { id: "inventory.possession", enforcement: "structural", parameters: { item: "remix:key", holder: "remix:player" } } },
  ];
  const commit = editBundle(fx, "protect", entries);
  fail = true;
  assert.equal((await commit()).ok, false);
  assert.deepEqual(fx.head(), before);
  fail = false;
  take(await commit());
  assert.equal(fx.head().snapshot.policy.world_patch.length, 0);
  assert.equal(fx.head().snapshot.world!.entities.find(({ id }) => id === "remix:new-guard")?.kind, "character");
  assert.equal(fx.head().snapshot.world!.facts.find(({ subject }) => subject === "remix:new-guard")?.evidence, "editor_committed");
  fx.mode("play");
  for (const operation of [
    { kind: "overlay.create", entity_kind: "character", entity: "remix:later-guard", room: "remix:market", region: "region:market", label: "Guard" },
    { kind: "inventory.transfer", item: "remix:key", from: "remix:player", to: "remix:market" },
  ] as const) {
    const req = fx.request(operation.kind, [operation]);
    const result = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
    assert.ok(!result.ok);
    assert.equal(result.error.status, "POLICY_CONFLICT");
  }
});

void test("explicit inspection filters visibility and observations preserve the specific fact revision", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const inspect = (id: string, mode: "PLAY" | "EDITOR") => {
    const req = fx.request("inspect", [{ kind: "inspect.entity", entity_id: id }], mode);
    return fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
  };
  const before = fx.head();
  const visible = take(inspect("remix:guard", "PLAY"));
  assert.equal(visible.kind, "inspection");
  assert.doesNotMatch(visible.facts.join(), /private_note|has not met/);
  assert.equal(inspect("remix:distant-guard", "PLAY").ok, false);
  assert.deepEqual(fx.head(), before);
  const observe = { kind: "observation.record", observer: "remix:guard", subject: "remix:guard", field: "world:description" } as const;
  const hidden = fx.request("hidden", [{ ...observe, field: "world:private_note" }]);
  assert.equal(fx.service.prepareTurn(fx.access, hidden.envelope, hidden.proposal).ok, false);
  await fx.commit(fx.request("observe", [observe]));
  const observation = fx.head().snapshot.world!.events.find(({ kind }) => kind === "observation")!;
  fx.mode("edit");
  await fx.commit(fx.request("assign", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "world:description", value: "The guard is wearing a scarf." }], "EDITOR"));
  await fx.commit(fx.request("relationship", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "relationship:remix:player", value: "acquaintance" }], "EDITOR"));
  fx.mode("play");
  await fx.commit(fx.request("observed-belief", [{ kind: "belief.update", character: "remix:guard", evidence: observation.id }]));
  fx.mode("edit");
  const editorView = take(inspect("remix:guard", "EDITOR"));
  assert.equal(editorView.kind, "inspection");
  assert.match(editorView.facts.join(), /world:private_note/);
  assert.match(editorView.facts.join(), /acquaintance/);
  assert.match(editorView.facts.join(), /characterization:beliefs/);
  assert.equal(observation.kind, "observation");
  const historical = fx.head().snapshot.world!.facts.find(({ source, field, subject }) =>
    source === observation.fact_source && field === observation.field && subject === observation.subject);
  assert.equal(historical?.value, "A guard staffs the market.");
  assert.ok(historical?.until);
});

void test("native boundaries, dangling references, and containment loops leave the committed image untouched", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await fx.commit(fx.request("bag", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:bag", region: "region:market",
    label: "Bag", holder: "remix:player", container: true }]));
  await fx.commit(fx.request("box", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:box", region: "region:market",
    label: "Box", holder: "remix:bag", container: true }]));
  const before = fx.head();
  for (const [id, operation, status] of [
    ["cycle", { kind: "inventory.transfer", item: "remix:bag", from: "remix:player", to: "remix:box" }, "CAPABILITY_MISSING"],
    ["dangling", { kind: "overlay.connect", connection: "remix:exit", from: "remix:market", to: "remix:unknown" }, "NEEDS_CLARIFICATION"],
    ["bridge", { kind: "inventory.transfer", item: "remix:box", from: "remix:bag", to: "native:room" }, "CAPABILITY_MISSING"],
  ] as const) {
    const req = fx.request(id, [operation]);
    const result = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
    assert.ok(!result.ok);
    assert.equal(result.error.status, status);
    assert.deepEqual(fx.head(), before);
  }
  const invalid = structuredClone(before);
  const world = invalid.snapshot.world!;
  world.facts.find(({ subject, field }) => subject === "remix:bag" && field === "inventory:holder")!.value = "remix:box";
  invalid.checkpoint.remix_state_ref = remixStateRef(invalid.snapshot.entities, world);
  assert.equal(validateImage(invalid, makeFixture()).ok, false);
});

void test("existing combined restore, SQLite reopen, and signed portable history preserve world identity and provenance", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await fx.commit(fx.request("created-room", [{ kind: "overlay.create", entity_kind: "location", entity: "remix:stall",
    region: "region:market", label: "Stall" }]));
  const text = "Hello";
  await fx.commit(fx.request("said", [{ kind: "speech.record", text }], "PLAY", text));
  const snapshot = fx.head();
  const { owner_id } = fx.access;
  const target = (request_id: string) => recoveryTarget.strip().parse({ ...fx.head().snapshot.head, request_id });
  const saved = take(fx.service.recovery.save(owner_id, target("request:save")));
  await fx.commit(fx.request("another-room", [{ kind: "overlay.create", entity_kind: "location", entity: "remix:future",
    region: "region:market", label: "Future" }]));
  const restore = target("request:restore");
  const pending = take(await fx.service.recovery.restore(owner_id, restore, saved.save_id, true));
  assert.equal(pending.status, "NEEDS_BROWSER_CONTROL");
  const review = take(fx.service.recovery.review(owner_id, pending.id));
  take(fx.service.recovery.review(owner_id, pending.id, review.digest));
  assert.equal(take(await fx.service.recovery.restore(owner_id, restore, saved.save_id, true)).status, "RESTORED");
  assert.notEqual(fx.head().checkpoint.generation_id, snapshot.checkpoint.generation_id);
  assert.deepEqual(fx.head().snapshot.world, snapshot.snapshot.world);
  fx.reopen();
  assert.deepEqual(fx.head().snapshot.world, snapshot.snapshot.world);
  const history = fx.store.portableHistory(fx.head());
  assert.ok(history);
  const key = Buffer.alloc(32, 1);
  const bytes = encodePortable(history, key);
  assert.ok(bytes);
  const decoded = decodePortable(bytes, owner_id, key);
  assert.ok(decoded);
  const relocated = relocatePortable(decoded);
  assert.deepEqual(relocated.imported.snapshot.world, snapshot.snapshot.world);
  assert.equal(relocated.imported.checkpoint.remix_state_ref, snapshot.checkpoint.remix_state_ref);
  take(validateImage(relocated.imported, makeFixture()));
  assert.notDeepEqual(relocated.entries.flatMap(({ receipt }) => receipt?.receipt.event_ids ?? []),
    history.flatMap(({ receipt }) => receipt?.receipt.event_ids ?? []));

  const corrupted = structuredClone(history);
  const changed = corrupted.find(({ events }) => events.some((event) => typeof event === "object" && event !== null &&
    "kind" in event && event.kind === "speech"));
  assert.ok(changed);
  changed.events[0] = { kind: "speech", text: "different attributed speech" };
  const signedCorruption = encodePortable(corrupted, key);
  assert.ok(signedCorruption);
  assert.equal(decodePortable(signedCorruption, owner_id, key), undefined);

  const beforeNative = fx.head();
  const command = play("request:native", beforeNative, "look");
  const prepared = fx.prepare(command);
  take(await fx.service.commitTurn(fx.access, command.envelope, prepared.handle.candidate_id));
  assert.deepEqual(fx.head().snapshot.world, snapshot.snapshot.world);
  assert.equal(fx.head().checkpoint.clocks.native, beforeNative.checkpoint.clocks.native + 1);

  const db = new DatabaseSync(fx.file);
  try {
    const changed = db.prepare("UPDATE events SET body=json_set(body,'$.text',?) WHERE json_extract(body,'$.kind')='speech'")
      .run("corrupted ledger text");
    assert.equal(changed.changes, 1);
  } finally { db.close(); }
  const noSave = fx.service.recovery.save(owner_id, target("request:with-corruption"));
  assert.ok(!noSave.ok);
  assert.equal(noSave.error.status, "VALIDATION_FAILED");
});

void test("world checkpoint validation preserves legacy hashes and rejects unknown versions, tampering and bad evidence", (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const legacy = fixtureImage(fx.access.owner_id);
  assert.equal(legacy.snapshot.world, undefined);
  assert.equal(legacy.checkpoint.remix_state_ref, "blob:" + canonicalDigest(legacy.snapshot.entities));
  take(validateImage(legacy, makeFixture()));
  const base = fx.head();
  const world = base.snapshot.world!;
  assert.equal(TurnImage.safeParse({ ...base, snapshot: { ...base.snapshot, world: { ...world, version: "2.0.0" } } }).success, false);
  world.facts[0]!.value = "Changed result";
  assert.equal(validateImage(base, makeFixture()).ok, false);
  world.facts[0]!.source = "world-event:missing";
  base.checkpoint.remix_state_ref = remixStateRef(base.snapshot.entities, world);
  assert.equal(validateImage(base, makeFixture()).ok, false);
});


void test("complete policy footprint and verified event bodies fence candidate writes", (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const req = fx.request("join", [{ kind: "overlay.connect", connection: "remix:route", from: "remix:market", to: "remix:vault" }]);
  const image = fx.head();
  // Authorize the second room here to exercise footprint checks independently of region denial.
  image.snapshot.policy.policy_amendment.generation_rules.find(({ action }) => action === "generate.connection")!
    .scope.region_ids.push("region:vault");
  const plan = resolvePolicy(image.snapshot, req.proposal);
  assert.ok(plan.ok);
  const all = plan.plan.operations[0]!.effects;
  assert.deepEqual(all.filter(({ field }) => field === "topology:exits").map(({ entity_id }) => entity_id).sort(),
    ["remix:market", "remix:vault"]);
  const partial = resolvePolicy(image.snapshot, { ...req.proposal,
    declared_effects: all.filter(({ entity_id }) => entity_id !== "remix:vault") });
  assert.ok(!partial.ok);
  assert.equal(partial.error.reason, "declared_footprint");
  const result = take(executeWorld(image, plan.plan));
  const mistyped = { ...result, events: [{ kind: "change", subject: "remix:unrelated" }] };
  assert.equal(buildImage(image, mistyped, plan.plan, makeFixture()).ok, false);
  const unchanged = fx.head();
  assert.equal(unchanged.snapshot.world?.exits.length, 0);
});
