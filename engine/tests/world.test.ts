
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
import { fixtureTools, scopes } from "../src/mcp/tools.ts";
import { SQLiteTurns, branchKey } from "../src/turn/sqlite-turns.ts";
import { TurnService } from "../src/turn/service.ts";
import { TurnImage } from "../src/turn/contracts.ts";
import type { FaultPoint } from "../src/turn/contracts.ts";
import { remixStateRef } from "../src/world/model.ts";
import { fixtureImage } from "../src/fixture/synthetic-world.ts";
import { openNativeFixture } from "../src/native/executor.ts";
import { storyBytes } from "../src/native/checkpoint.ts";
import { makeFixture, play, take } from "./turn-fixture.ts";

function setup(fault?: (point: FaultPoint) => void, clock = Date.now,
  native?: { state: TurnImage; story: Buffer; key: Buffer }) {
  const dir = mkdtempSync(join(tmpdir(), "zirp-world-"));
  const file = join(dir, "state.db");
  let store = new SQLiteTurns(file);
  function open() {
    return new TurnService(store, makeFixture(), clock, fault, native ? "native-z5" : "synthetic", native);
  }
  let service = open();
  const state = native?.state ?? fixtureImage(play().access.owner_id);
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
  store.transaction(() => {
    store.saveFixtureRecord("session", branchKey(access), true);
    if (native) store.retainStory(access, native.story);
  });
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
      service = open();
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
  fx.mode("edit");
  await fx.commit(fx.request("history", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "relationship:remix:player", value: "acquaintance" }], "EDITOR"));
  fx.mode("play");
  const initial = structuredClone(fx.head().snapshot.world!.facts);
  const forged = fx.request("forged", [{ kind: "speech.record", text }], "PLAY", "different speech");
  assert.equal(fx.service.prepareTurn(fx.access, forged.envelope, forged.proposal).ok, false);
  const said = await fx.commit(fx.request("speech", [{ kind: "speech.record", text }], "PLAY", text));
  assert.equal(said.receipt.visibility, "player");
  assert.deepEqual(said.receipt.narration_facts, [canonicalJson({ kind: "speech", speaker: "remix:player", text })]);
  const speech = fx.head().snapshot.world!.events.find(({ kind }) => kind === "speech");
  assert.equal(speech?.kind, "speech");
  assert.deepEqual(speech.listeners, ["remix:guard"]);
  const absent = fx.request("absent", [{ kind: "belief.update", character: "remix:distant-guard", evidence: speech.id }]);
  assert.equal(fx.service.prepareTurn(fx.access, absent.envelope, absent.proposal).ok, false);
  const believed = await fx.commit(fx.request("belief", [{ kind: "belief.update", character: "remix:guard", evidence: speech.id }]));
  assert.deepEqual(believed.receipt.narration_facts, []);
  const world = fx.head().snapshot.world!;
  assert.deepEqual(world.facts, initial);
  assert.deepEqual(world.beliefs.map(({ character, evidence }) => ({ character, evidence })),
    [{ character: "remix:guard", evidence: speech.id }]);
  assert.equal(canonicalJson(TurnImage.parse(JSON.parse(canonicalJson(fx.head())))), canonicalJson(fx.head()));
});

void test("arrival and speech require separate turns, and the newcomer hears the later speech", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const newcomer = { kind: "overlay.create", entity_kind: "character", entity: "remix:newcomer",
    room: "remix:market", region: "region:market", label: "Newcomer" } as const;
  const speech = { kind: "speech.record", text: "Welcome" } as const;
  const before = fx.head();
  const combined = fx.request("arrive-and-hear", [newcomer, speech], "PLAY", speech.text);
  const rejected = fx.service.prepareTurn(fx.access, combined.envelope, combined.proposal);
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.status, "NEEDS_CLARIFICATION");
  assert.deepEqual(fx.head(), before);

  const arrival = await fx.commit(fx.request("arrive", [newcomer]));
  const welcome = await fx.commit(fx.request("welcome", [speech], "PLAY", speech.text));
  assert.equal(welcome.receipt.revision, arrival.receipt.revision + 1);
  const event = fx.head().snapshot.world!.events.at(-1);
  assert.equal(event?.kind, "speech");
  assert.equal(event.revision, welcome.receipt.revision);
  assert.equal(event.text, speech.text);
  assert.deepEqual(event.listeners, ["remix:guard", newcomer.entity]);
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
  const observed = await fx.commit(fx.request("observe", [observe]));
  assert.deepEqual(observed.receipt.narration_facts, []);
  const observation = fx.head().snapshot.world!.events.find(({ kind }) => kind === "observation")!;
  fx.mode("edit");
  await fx.commit(fx.request("assign", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "world:description", value: "The guard is wearing a scarf." }], "EDITOR"));
  await fx.commit(fx.request("relationship", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "relationship:remix:player", value: "acquaintance" }], "EDITOR"));
  await fx.commit(fx.request("remote-relationship", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "relationship:remix:distant-guard", value: "friend" }], "EDITOR"));
  const invalidRelationship = fx.request("wrong-social-type", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "relationship:remix:vault", value: "friend" }], "EDITOR");
  assert.equal(fx.service.prepareTurn(fx.access, invalidRelationship.envelope, invalidRelationship.proposal).ok, false);
  fx.mode("play");
  await fx.commit(fx.request("observed-belief", [{ kind: "belief.update", character: "remix:guard", evidence: observation.id }]));
  const after = fx.head();
  assert.equal(inspect("remix:guard", "EDITOR").ok, false);
  const playerView = take(inspect("remix:guard", "PLAY"));
  assert.equal(playerView.kind, "inspection");
  assert.match(playerView.facts.join(), /scarf|acquaintance/);
  assert.doesNotMatch(playerView.facts.join(), /private_note|characterization:beliefs|distant-guard/);
  assert.deepEqual(fx.head(), after);
  const remote = fx.request("observe-remote", [{ ...observe, field: "relationship:remix:distant-guard" }]);
  assert.equal(fx.service.prepareTurn(fx.access, remote.envelope, remote.proposal).ok, false);
  fx.mode("edit");
  const editorView = take(inspect("remix:guard", "EDITOR"));
  assert.equal(editorView.kind, "inspection");
  assert.match(editorView.facts.join(), /world:private_note/);
  assert.match(editorView.facts.join(), /acquaintance/);
  assert.match(editorView.facts.join(), /characterization:beliefs/);
  assert.match(editorView.facts.join(), /distant-guard/);
  assert.deepEqual(fx.head(), after);
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
  fx.mode("edit");
  const displaced = fx.request("displaced-edit", [{ kind: "remix.assign", entity_id: "remix:guard",
    field: "world:description", value: "Discarded candidate" }], "EDITOR");
  const staged = fx.prepare(displaced);
  const grant = take(fx.service.browser.confirm(owner_id, staged.handle.candidate_id, staged.diff_digest));
  const restore = target("request:restore");
  const pending = take(await fx.service.recovery.restore(owner_id, restore, saved.save_id, true));
  assert.equal(pending.status, "NEEDS_BROWSER_CONTROL");
  const review = take(fx.service.recovery.review(owner_id, pending.id));
  take(fx.service.recovery.review(owner_id, pending.id, review.digest));
  assert.equal(take(await fx.service.recovery.restore(owner_id, restore, saved.save_id, true)).status, "RESTORED");
  assert.notEqual(fx.head().checkpoint.generation_id, snapshot.checkpoint.generation_id);
  assert.deepEqual(fx.head().snapshot.world, snapshot.snapshot.world);
  const stale = await fx.service.commitTurn(fx.access, displaced.envelope, staged.handle.candidate_id, {
    candidate_id: staged.handle.candidate_id, diff_digest: staged.diff_digest, source: "approval", reference: grant.grant_id,
  });
  assert.ok(!stale.ok);
  assert.equal(stale.error.status, "STALE_REVISION");
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

  for (const index of [history.length - 1, history.length - 2]) {
    const badHistory = structuredClone(history);
    const image = badHistory[index]!.image;
    image.snapshot.world!.facts[0]!.value = "Rewritten evidence";
    image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, image.snapshot.world);
    const signed = encodePortable(badHistory, key);
    assert.ok(signed);
    assert.equal(decodePortable(signed, owner_id, key), undefined);
  }
  const extra = structuredClone(history);
  const typed = extra.find(({ receipt }) => receipt?.receipt.request_id === "request:said")!;
  typed.receipt!.receipt.event_ids.push("event:unrelated");
  typed.events.push({ kind: "native_timer", event: "chime", turn: 1 });
  assert.equal(decodePortable(encodePortable(extra, key)!, owner_id, key), undefined);
  const repeated = await fx.commit(fx.request("said", [{ kind: "speech.record", text }], "PLAY", text));
  assert.notEqual(repeated.receipt.generation_id, snapshot.checkpoint.generation_id);
  const speeches = fx.head().snapshot.world!.events.filter(({ kind }) => kind === "speech");
  assert.equal(speeches.length, 2);
  assert.notEqual(speeches[0]?.id, speeches[1]?.id);
  take(fx.service.recovery.save(owner_id, target("request:save-after-world")));
  assert.ok(fx.store.portableHistory(fx.head()));

  // Both the body digest and remix reference are valid in this corrupted restore row.
  const restoredImage = history.at(-1)!.image;
  const badRestore = structuredClone(restoredImage);
  badRestore.snapshot.world!.facts[0]!.value = "Rewritten during SQLite restore";
  badRestore.checkpoint.remix_state_ref = remixStateRef(badRestore.snapshot.entities, badRestore.snapshot.world);
  const restoreDb = new DatabaseSync(fx.file);
  try {
    const overwrite = restoreDb.prepare("UPDATE checkpoints SET body=?,digest=? WHERE id=?");
    assert.equal(overwrite.run(canonicalJson(badRestore), canonicalDigest(badRestore), badRestore.checkpoint.checkpoint_id).changes, 1);
    assert.equal(fx.store.checkpointHistoryValid(badRestore), false);
    assert.equal(overwrite.run(canonicalJson(restoredImage), canonicalDigest(restoredImage), restoredImage.checkpoint.checkpoint_id).changes, 1);
    assert.equal(fx.store.checkpointHistoryValid(fx.head()), true);
  } finally { restoreDb.close(); }

  const beforeNative = fx.head();
  const command = play("request:native", beforeNative, "look");
  const prepared = fx.prepare(command);
  take(await fx.service.commitTurn(fx.access, command.envelope, prepared.handle.candidate_id));
  assert.deepEqual(fx.head().snapshot.world, beforeNative.snapshot.world);
  assert.equal(fx.head().checkpoint.clocks.native, beforeNative.checkpoint.clocks.native + 1);
  const nativeHistory = fx.store.portableHistory(fx.head())!;
  const mutatedNative = nativeHistory.at(-1)!.image;
  mutatedNative.snapshot.world!.facts[0]!.value = "Invalid after native turn";
  mutatedNative.checkpoint.remix_state_ref = remixStateRef(mutatedNative.snapshot.entities, mutatedNative.snapshot.world);
  assert.equal(decodePortable(encodePortable(nativeHistory, key)!, owner_id, key), undefined);

  const db = new DatabaseSync(fx.file);
  try {
    const changed = db.prepare("UPDATE events SET body=json_set(body,'$.text',?) WHERE json_extract(body,'$.kind')='speech'")
      .run("corrupted ledger text");
    assert.equal(changed.changes, 2);
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


void test("Play history and exact lookups redact private Editor receipts and off-scene Play changes", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  fx.mode("edit");
  const secret = fx.request("secret", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:secret-key",
    region: "region:vault", holder: "remix:distant-guard", label: "Secret Key" }], "EDITOR");
  const editorReceipt = (await fx.commit(secret)).receipt;
  assert.equal(editorReceipt.visibility, "owner");
  const exact = { kind: "receipt", generation_id: editorReceipt.generation_id, request_id: editorReceipt.request_id } as const;
  assert.match(canonicalJson(take(fx.service.inspectFixture(fx.access, exact))), /Secret Key/);
  fx.mode("play");
  const history = take(fx.service.inspectFixture(fx.access, { kind: "history" }));
  const inspected = take(fx.service.inspectFixture(fx.access, exact));
  assert.equal(inspected.receipts[0]?.request_id, editorReceipt.request_id);
  assert.doesNotMatch(canonicalJson([history, inspected]), /Secret Key|secret-key|distant-guard/);
  const stored = fx.store.request(canonicalJson({ ...fx.access, generation_id: editorReceipt.generation_id, request_id: editorReceipt.request_id }));
  assert.ok(stored?.committed_candidate && stored.committed_digest);
  const recovered = take(await fx.service.commitTurn(fx.access, secret.envelope, stored.committed_candidate, undefined,
    { diff: stored.committed_digest, browserAvailable: true }));
  assert.deepEqual(fx.service.viewFixtureReceipt(recovered), inspected.receipts[0]);
  const preparedReplay = take(fx.service.prepareTurn(fx.access, secret.envelope, secret.proposal));
  assert.equal(preparedReplay.kind, "committed");
  assert.deepEqual(fx.service.viewFixtureReceipt(preparedReplay.record), inspected.receipts[0]);
  const room = (await fx.commit(fx.request("stall", [{ kind: "overlay.create", entity_kind: "location", entity: "remix:stall",
    region: "region:market", label: "Secret Stall" }]))).receipt;
  assert.deepEqual(room.narration_facts, []);
  const offsite = (await fx.commit(fx.request("offsite", [{ kind: "overlay.create", entity_kind: "character", entity: "remix:offsite",
    room: "remix:stall", region: "region:market", label: "Off Scene" }]))).receipt;
  assert.deepEqual(offsite.narration_facts, []);
  const oldNote = canonicalJson({ kind: "overlay.create", entity: "remix:offsite", entity_kind: "character",
    label: "Off Scene", room: "remix:stall" });
  const db = new DatabaseSync(fx.file);
  try {
    const row = db.prepare("UPDATE requests SET receipt=json_set(receipt, '$.receipt.narration_facts', json(?)) " +
      "WHERE json_extract(receipt, '$.receipt.request_id')=?").run(JSON.stringify([oldNote]), offsite.request_id);
    assert.equal(row.changes, 1);
  } finally { db.close(); }
  const older = take(fx.service.inspectFixture(fx.access, { kind: "receipt", request_id: offsite.request_id, generation_id: offsite.generation_id }));
  assert.deepEqual(older.receipts[0]?.narration_facts, []);
  const local = await fx.commit(fx.request("local", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:local",
    holder: "remix:market", region: "region:market", label: "Visible Item" }]));
  assert.match(local.receipt.narration_facts.join(), /Visible Item/);
  assert.match(fx.service.viewFixtureReceipt(local).narration_facts.join(), /Visible Item/);
});

void test("a bundle cannot fill and then move an empty container in one candidate", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await fx.commit(fx.request("bag", [{ kind: "overlay.create", entity_kind: "item", entity: "remix:bag", region: "region:market",
    label: "Bag", holder: "remix:player", container: true }]));
  const before = fx.head();
  const req = fx.request("fill-and-move", [
    { kind: "overlay.create", entity_kind: "item", entity: "remix:box", region: "region:market", label: "Box", holder: "remix:bag" },
    { kind: "inventory.transfer", item: "remix:bag", from: "remix:player", to: "remix:market" },
  ]);
  const result = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
  assert.ok(!result.ok);
  assert.equal(result.error.status, "NEEDS_CLARIFICATION");
  assert.deepEqual(fx.head(), before);
});


void test("independent world operations commit together, with visible exits and scoped containment", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const room = (name: string): ResolverOperation => ({ kind: "overlay.create", entity_kind: "location",
    entity: "remix:" + name, region: "region:market", label: name });
  const batch = await fx.commit(fx.request("two-rooms", [room("alley"), room("tower")]));
  assert.equal(batch.receipt.event_ids.length, 2);
  const exit = (name: string, from: string, to: string): ResolverOperation => ({
    kind: "overlay.connect", connection: "remix:" + name, from: "remix:" + from, to: "remix:" + to,
  });
  await fx.commit(fx.request("outgoing", [exit("out", "market", "alley")]));
  const incoming = await fx.commit(fx.request("incoming", [exit("in", "alley", "market")]));
  assert.deepEqual(incoming.receipt.narration_facts, []);
  const inspect = (id: string) => {
    const req = fx.request("inspect-" + id, [{ kind: "inspect.entity", entity_id: id }]);
    return fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
  };
  assert.equal(inspect("remix:market").ok, true);
  assert.equal(inspect("remix:vault").ok, false);
  assert.equal(inspect("remix:out").ok, true);
  assert.equal(inspect("remix:in").ok, false);
  assert.equal(inspect("Guard").ok, false);

  const item = (name: string, holder: string, container = false): ResolverOperation => ({
    kind: "overlay.create", entity_kind: "item", entity: "remix:" + name, region: "region:market", label: name, holder, container,
  });
  await fx.commit(fx.request("basket", [item("basket", "remix:market", true)]));
  await fx.commit(fx.request("coin", [item("coin", "remix:basket")]));
  const move = (from: string, to: string): ResolverOperation => ({ kind: "inventory.transfer", item: "remix:coin", from, to });
  await fx.commit(fx.request("take", [move("remix:basket", "remix:player")]));
  await fx.commit(fx.request("handoff", [move("remix:player", "remix:guard")]));
  const theft = fx.request("theft", [move("remix:guard", "remix:player")]);
  assert.equal(fx.service.prepareTurn(fx.access, theft.envelope, theft.proposal).ok, false);

  let holder = "remix:basket";
  for (let depth = 2; depth <= 16; depth++) {
    const id = "nested-" + depth;
    await fx.commit(fx.request(id, [item(id, holder, true)]));
    holder = "remix:" + id;
  }
  const before = fx.head();
  const overflow = fx.request("nested-17", [item("nested-17", holder)]);
  assert.equal(fx.service.prepareTurn(fx.access, overflow.envelope, overflow.proposal).ok, false);
  assert.deepEqual(fx.head(), before);
});

void test("world candidates compete, expire, cancel and respect restarted Editor authority", async (t) => {
  let now = 1_000;
  const fx = setup(undefined, () => now);
  t.after(() => fx.close());
  const speech = (id: string) => fx.request(id, [{ kind: "speech.record", text: id }]);
  await fx.commit(speech("spoken"));
  const spoken = fx.head().snapshot.world!.events.at(-1)!;
  const belief = { kind: "belief.update", character: "remix:guard", evidence: spoken.id } as const;
  const a = fx.request("a", [belief]);
  const b = fx.request("b", [belief]);
  const ca = fx.prepare(a);
  const cb = fx.prepare(b);
  const results = await Promise.all([
    fx.service.commitTurn(fx.access, a.envelope, ca.handle.candidate_id),
    fx.service.commitTurn(fx.access, b.envelope, cb.handle.candidate_id),
  ]);
  assert.equal(results.filter(({ ok }) => ok).length, 1);
  assert.equal(results.find((result) => !result.ok)?.error.status, "STALE_REVISION");
  const before = fx.head();
  assert.equal(before.snapshot.world!.beliefs.length, 1);
  assert.equal(before.snapshot.world!.events.filter(({ kind }) => kind === "change").length, 1);
  const abandoned = speech("expired");
  const prior = fx.prepare(abandoned);
  now += 300_001;
  const expired = await fx.service.commitTurn(fx.access, abandoned.envelope, prior.handle.candidate_id);
  assert.ok(!expired.ok);
  assert.equal(expired.error.retry, "refresh");
  assert.match(expired.error.message, /Prepare the identical request/);
  take(fx.service.collectAbandoned());
  const collected = await fx.service.commitTurn(fx.access, abandoned.envelope, prior.handle.candidate_id);
  assert.deepEqual(collected, expired);
  const renewed = fx.prepare(abandoned);
  assert.notEqual(renewed.handle.candidate_id, prior.handle.candidate_id);
  take(fx.service.cancelTurn(fx.access, abandoned.envelope, renewed.handle.candidate_id));
  assert.equal((await fx.service.commitTurn(fx.access, abandoned.envelope, renewed.handle.candidate_id)).ok, false);
  assert.deepEqual(fx.head(), before);

  for (const method of ["revoke", "play", "expire", "restart"]) {
    fx.mode("edit");
    const req = fx.request(method, [{ kind: "remix.assign", entity_id: "remix:guard",
      field: "world:description", value: method }], "EDITOR");
    const stage = fx.prepare(req);
    const candidate_id = stage.handle.candidate_id;
    const grant = take(fx.service.browser.confirm(fx.access.owner_id, candidate_id, stage.diff_digest));
    if (method === "revoke") take(fx.service.browser.revokeCandidate(fx.access.owner_id, candidate_id));
    if (method === "play") fx.mode("play");
    if (method === "expire") now += 300_001;
    if (method === "restart") fx.reopen();
    const permit = { candidate_id, diff_digest: stage.diff_digest, source: "approval" as const, reference: grant.grant_id };
    const result = await fx.service.commitTurn(fx.access, req.envelope, candidate_id, permit);
    assert.ok(!result.ok);
    assert.equal(result.error.status, "NEEDS_APPROVAL");
    assert.deepEqual(fx.head(), before);
    if (method === "restart" || method === "expire") {
      fx.mode("edit");
      const retry = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
      assert.ok(!retry.ok);
      assert.match(retry.error.message, /Prepare a fresh request/);
    }
  }
});

void test("world publication faults preserve one outcome and collectible pre-publication state", async (t) => {
  let target: FaultPoint | undefined;
  const fx = setup((point) => { if (target === point) throw new Error("injected"); });
  t.after(() => fx.close());
  for (const point of ["before_checkpoint", "after_checkpoint", "after_commit"] as const) {
    const request = fx.request(point, [{ kind: "speech.record", text: point }]);
    const before = fx.head();
    const stage = fx.prepare(request);
    target = point;
    const result = await fx.service.commitTurn(fx.access, request.envelope, stage.handle.candidate_id);
    assert.ok(!result.ok);
    assert.equal(result.error.retry, "same_request");
    target = undefined;
    if (point === "after_commit") {
      assert.equal(fx.head().checkpoint.revision, before.checkpoint.revision + 1);
    } else {
      assert.deepEqual(fx.head(), before);
    }
    assert.equal(take(fx.service.collectAbandoned()), point === "after_checkpoint" ? 1 : 0);
    const receipt = take(await fx.service.commitTurn(fx.access, request.envelope, stage.handle.candidate_id));
    assert.equal(receipt.receipt.revision, before.checkpoint.revision + 1);
    assert.deepEqual(take(await fx.service.commitTurn(fx.access, request.envelope, stage.handle.candidate_id)), receipt);
    assert.equal(fx.head().snapshot.world!.events.filter((event) => event.kind === "speech" && event.text === point).length, 1);
  }
});

void test("world-bearing seeded Z5 imports into fresh SQLite and continues native and remix turns", async (t) => {
  const owner = play().access.owner_id;
  const story = storyBytes();
  const key = Buffer.alloc(32, 2);
  const source = setup(undefined, Date.now, { state: take(await openNativeFixture(owner, story)), story, key });
  t.after(() => source.close());
  await source.commit(source.request("said", [{ kind: "speech.record", text: "said" }]));
  const speech = source.head().snapshot.world!.events.find(({ kind }) => kind === "speech")!;
  await source.commit(source.request("believed", [{ kind: "belief.update", character: "remix:guard", evidence: speech.id }]));
  const image = source.head();
  const saved = take(source.service.recovery.save(owner, recoveryTarget.strip().parse({
    ...image.snapshot.head, request_id: "request:save",
  })));
  const download = take(source.service.authorizePrivateDownload(source.access, saved.save_id));
  const bytes = take(source.service.exportPrivateSession(source.access, saved.save_id, download));
  const directory = mkdtempSync(join(tmpdir(), "zirp-world-import-"));
  const store = new SQLiteTurns(join(directory, "destination.db"));
  const service = new TurnService(store, makeFixture(), Date.now, undefined, "native-z5", { key });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  const upload = take(service.uploadPrivateStory(owner, "combined", story));
  const received = take(await service.importPrivateSession(owner, upload, "request:import", bytes));
  const access = { ...received.head, owner_id: owner };
  const imported = store.head(access)!;
  assert.deepEqual(imported.snapshot.world, image.snapshot.world);
  assert.notEqual(imported.checkpoint.generation_id, image.checkpoint.generation_id);
  assert.equal(store.checkpointHistoryValid(imported), true);
  const target = { ...received.head, request_id: recoveryTarget.shape.request_id.parse("request:native-after-import") };
  const action = { kind: "play", input: { kind: "line", text: "look" } } as const;
  const prepared = take(service.prepareFixture(access, target, action, false));
  assert.equal(prepared.kind, "prepared");
  const committed = take(await service.commitFixture(access, target, action, prepared.handle.candidate_id, prepared.diff_digest, false));
  assert.ok(committed.receipt.native_output.length > 0);
  const after = store.head(access)!;
  assert.deepEqual(after.snapshot.world, image.snapshot.world);
  assert.equal(store.checkpointHistoryValid(after), true);
  const text = "Still here.";
  const head = { ...after.snapshot.head, request_id: "request:said", version: "1.0.0" };
  const overlay = take(service.prepareTurn(access, { ...head, input: { kind: "line", text }, intent: "play" },
    { ...head, mode: "PLAY", operations: [{ kind: "speech.record", text }], declared_effects: [], amendment: null }));
  assert.equal(overlay.kind, "prepared");
  take(await service.commitTurn(access, { ...head, input: { kind: "line", text }, intent: "play" }, overlay.handle.candidate_id));
  const continued = store.head(access)!;
  assert.equal(continued.snapshot.world!.events.at(-1)?.kind, "speech");
  assert.equal(store.checkpointHistoryValid(continued), true);
});


void test("stored observation and belief evidence must be the specific eligible version", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const field = "world:description";
  const observer = "remix:guard";
  const operation = { kind: "observation.record", observer, subject: observer, field } as const;
  await fx.commit(fx.request("earlier", [operation]));
  fx.mode("edit");
  await fx.commit(fx.request("change", [{ kind: "remix.assign", entity_id: observer, field, value: "Red scarf" }], "EDITOR"));
  fx.mode("play");
  await fx.commit(fx.request("later", [operation]));
  const state = fx.head();
  const observations = state.snapshot.world!.events.filter(({ kind }) => kind === "observation");
  assert.equal(observations.length, 2);
  for (const [selected, swapped] of [[0, 1], [1, 0]] as const) {
    const forged = structuredClone(state);
    const event = forged.snapshot.world!.events.find(({ id }) => id === observations[selected]?.id);
    assert.equal(event?.kind, "observation");
    const source = observations[swapped];
    assert.equal(source?.kind, "observation");
    event.fact_source = source.fact_source;
    forged.checkpoint.remix_state_ref = remixStateRef(forged.snapshot.entities, forged.snapshot.world);
    assert.equal(validateImage(forged, makeFixture()).ok, false);
  }
  for (const evidence of state.snapshot.world!.events.filter(({ kind }) => kind === "seed" || kind === "change")) {
    const req = fx.request("invalid-evidence", [{ kind: "belief.update", character: observer, evidence: evidence.id }]);
    assert.equal(fx.service.prepareTurn(fx.access, req.envelope, req.proposal).ok, false);
  }
  const request_id = "request:same-revision";
  const head = state.snapshot.head;
  const freshEvent = "world-event:" + canonicalDigest([head.generation_id, request_id, head.expected_revision + 1, 0]);
  const sameTurn = fx.request("same-revision", [
    { kind: "speech.record", text: "Same turn" },
    { kind: "belief.update", character: observer, evidence: freshEvent },
  ], "PLAY", "Same turn");
  assert.equal(fx.service.prepareTurn(fx.access, sameTurn.envelope, sameTurn.proposal).ok, false);
  assert.deepEqual(fx.head(), state);
});


void test("#87 stored observations require the player and observer in the same historical room", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const remote = "remix:distant-guard";
  const local = "remix:guard";
  const field = "world:description";
  fx.mode("edit");
  await fx.commit(fx.request("vault-fact", [
    { kind: "remix.assign", entity_id: remote, field, value: "A guard staffs the vault." },
  ], "EDITOR"));
  fx.mode("play");
  const observe = (character: string): ResolverOperation =>
    ({ kind: "observation.record", observer: character, subject: character, field });
  const tooFar = fx.request("observe-vault", [observe(remote)]);
  const rejected = fx.service.prepareTurn(fx.access, tooFar.envelope, tooFar.proposal);
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.status, "NEEDS_CLARIFICATION");

  const result = await fx.commit(fx.request("observe-market", [observe(local)]));
  const history = fx.store.portableHistory(fx.head());
  assert.ok(history);
  const entry = history.at(-1)!;
  const world = entry.image.snapshot.world!;
  const observed = world.events.at(-1);
  assert.equal(observed?.kind, "observation");
  await fx.commit(fx.request("learn-market", [{ kind: "belief.update", character: local, evidence: observed.id }]));
  assert.deepEqual(fx.head().snapshot.world?.beliefs.map(({ character, evidence }) => ({ character, evidence })),
    [{ character: local, evidence: observed.id }]);

  const fact = world.facts.find((candidate) => candidate.subject === remote && candidate.field === field);
  assert.ok(fact);
  Object.assign(observed, { observer: remote, subject: remote, room: "remix:vault", fact_source: fact.source });
  entry.events[0] = observed;
  entry.image.checkpoint.remix_state_ref = remixStateRef(entry.image.snapshot.entities, world);
  const key = Buffer.alloc(32, 7);
  const bytes = encodePortable(history, key);
  assert.ok(bytes);

  const externalId = result.receipt.event_ids[0];
  assert.ok(externalId);
  const db = new DatabaseSync(fx.file);
  try {
    assert.equal(db.prepare("UPDATE checkpoints SET body=?,digest=? WHERE id=?")
      .run(canonicalJson(entry.image), canonicalDigest(entry.image), result.receipt.post_checkpoint).changes, 1);
    assert.equal(db.prepare("UPDATE events SET body=? WHERE id=?").run(canonicalJson(observed), externalId).changes, 1);
    assert.deepEqual({
      image: validateImage(entry.image, makeFixture()).ok,
      sqlite: fx.store.checkpointHistoryValid(entry.image),
      portable: decodePortable(bytes, fx.access.owner_id, key) !== undefined,
    }, { image: false, sqlite: false, portable: false });
  } finally { db.close(); }
});

void test("#88 Play narration uses the committed turn for history, exact lookup, and MCP replay", async (t) => {
  const fx = setup();
  const db = new DatabaseSync(fx.file);
  t.after(() => { db.close(); fx.close(); });
  const tools = fixtureTools(fx.service, "http://localhost", false);
  const owner = { owner: fx.access.owner_id, scopes: new Set(Object.values(scopes)) };
  const { session_id, branch_id } = fx.access;
  const ref = { version: "1.0.0", session_id, branch_id };
  const hidden = "An unseen guard is guarding the vault.";
  const observedNotes: { expected: string[]; history: string[] | undefined; exact: string[] | undefined; prepare: string[]; commit: string[] }[] = [];
  const overwrite = db.prepare("UPDATE requests SET receipt=json_set(receipt, '$.receipt.narration_facts', json(?)) " +
    "WHERE json_extract(receipt, '$.receipt.request_id')=?");
  for (const variant of ["plain", "mixed", "missing-event"] as const) {
    const text = "Hello " + variant;
    const req = fx.request(variant, [{ kind: "speech.record", text }], "PLAY", text);
    const prepared = fx.prepare(req);
    const { candidate_id } = prepared.handle;
    const { diff_digest } = prepared;
    const committed = take(await fx.service.commitTurn(fx.access, req.envelope, candidate_id));
    const { request_id, generation_id, narration_facts } = committed.receipt;
    assert.equal(narration_facts.length, 1);
    assert.equal(overwrite.run(JSON.stringify(variant === "plain" ? [hidden] : [hidden, ...narration_facts]), request_id).changes, 1);
    if (variant === "missing-event") {
      const eventId = committed.receipt.event_ids[0];
      assert.ok(eventId);
      assert.equal(db.prepare("DELETE FROM events WHERE id=?").run(eventId).changes, 1);
    }

    const history = take(await tools.inspect_session.run(owner, { ...ref, query: { kind: "history" } }));
    const exact = take(await tools.inspect_session.run(owner, { ...ref, query: { kind: "receipt", generation_id, request_id } }));
    const request = { version: "1.0.0", target: recoveryTarget.strip().parse(req.envelope),
      action: { kind: "play", input: { kind: "line", text } } };
    const again = take(await tools.prepare_turn.run(owner, request));
    const replay = take(await tools.commit_turn.run(owner, { ...request, candidate_id, diff_digest }));
    assert.equal(again.status, "COMMITTED");
    assert.deepEqual(replay.receipt.request_id, request_id);
    assert.deepEqual(exact.receipts.map((receipt) => receipt.request_id), [request_id]);
    observedNotes.push({ expected: variant === "mixed" ? narration_facts : [],
      history: history.receipts.find((receipt) => receipt.request_id === request_id)?.narration_facts,
      exact: exact.receipts[0]?.narration_facts, prepare: again.receipt.narration_facts, commit: replay.receipt.narration_facts });
  }

  const native = play("request:verified-native-prose", fx.head(), "look");
  const stage = fx.prepare(native);
  const result = take(await fx.service.commitTurn(fx.access, native.envelope, stage.handle.candidate_id));
  assert.ok(fx.head().snapshot.world);
  assert.deepEqual(result.receipt.narration_facts, ["The room was observed."]);
  assert.deepEqual(fx.service.viewFixtureReceipt(result).narration_facts, ["The room was observed."]);
  for (const { expected, history, exact, prepare, commit } of observedNotes) {
    assert.deepEqual({ history, exact, prepare, commit }, { history: expected, exact: expected, prepare: expected, commit: expected });
  }
});

void test("#89 portable decode rejects one external receipt event ID reused by separate turns", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  for (const text of ["First", "Second"]) await fx.commit(fx.request(text, [{ kind: "speech.record", text }]));
  const history = fx.store.portableHistory(fx.head());
  assert.ok(history);
  const turns = history.filter(({ receipt }) => receipt !== null);
  assert.equal(turns.length, 2);
  const first = turns[0]!;
  const second = turns[1]!;
  assert.notEqual(first.image.snapshot.world?.events.at(-1)?.id, second.image.snapshot.world?.events.at(-1)?.id);
  const key = Buffer.alloc(32, 8);
  assert.ok(decodePortable(encodePortable(history, key)!, fx.access.owner_id, key));
  const reused = first.receipt?.receipt.event_ids[0];
  assert.ok(reused && second.receipt);
  second.receipt.receipt.event_ids = [reused];
  assert.ok(!decodePortable(encodePortable(history, key)!, fx.access.owner_id, key), "reused external ID must invalidate the signed history");
});
