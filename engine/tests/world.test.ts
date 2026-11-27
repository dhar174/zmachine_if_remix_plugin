
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { canonicalDigest, canonicalJson } from "../src/contracts.ts";
import type { ResolverOperation } from "../src/policy/resolver-contracts.ts";
import { compileDirective } from "../src/policy/directive-compiler.ts";
import { decodePortable, encodePortable, relocatePortable } from "../src/fixture/portable-session.ts";
import type { PortableEntry } from "../src/fixture/portable-session.ts";
import { publicHead, target as recoveryTarget } from "../src/fixture/session-contracts.ts";
import { buildImage, executeWorld, validateImage } from "../src/turn/execution.ts";
import { resolvePolicy } from "../src/policy/policy-resolver.ts";
import { fixtureTools, scopes } from "../src/mcp/tools.ts";
import { SQLiteTurns, branchKey } from "../src/turn/sqlite-turns.ts";
import { TurnService } from "../src/turn/service.ts";
import { limits, TurnImage } from "../src/turn/contracts.ts";
import { turnBudget } from "../src/turn/limits.ts";
import type { DurableReceipt, FaultPoint } from "../src/turn/contracts.ts";
import { activeFact, remixStateRef } from "../src/world/model.ts";
import { fixtureImage } from "../src/fixture/synthetic-world.ts";
import { openNativeFixture } from "../src/native/executor.ts";
import { storyBytes } from "../src/native/checkpoint.ts";
import { makeFixture, play, take } from "./turn-fixture.ts";

function setup(fault?: (point: FaultPoint) => void, clock = Date.now,
  native?: { state: TurnImage; story: Buffer; key: Buffer }, configure?: (image: TurnImage) => void, monotonicClock?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "zirp-world-"));
  const file = join(dir, "state.db");
  let store = new SQLiteTurns(file);
  function open() {
    return new TurnService(store, makeFixture(), clock, fault, native ? "native-z5" : "synthetic", native, monotonicClock);
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
  configure?.(image);
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
  function request(id: string, operations: ResolverOperation[], mode: "PLAY" | "EDITOR" = "PLAY",
    input: string | { kind: "offer.accept"; offer_id: string } = id) {
    const current = head().snapshot.head;
    return {
      envelope: { ...current, version: "1.0.0", request_id: "request:" + id,
        intent: operations.every(({ kind }) => kind === "inspect.entity") ? "inspect" : mode === "PLAY" ? "play" : "editor",
        input: typeof input === "string" ? { kind: "line", text: input } : input },
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

const marketGossip = {
  giver: "remix:guard", recipient: "remix:player", item: "remix:market-token",
  topic: "topic:old-friends", text: "We are old friends.",
};

function marketRule() {
  const { giver, item, topic, text } = marketGossip;
  return {
    version: "1.0.0" as const, id: "behavior:market-gossip", owner: giver,
    when: { kind: "speech" as const },
    conditions: [
      { kind: "speech.equals" as const, text },
      { kind: "topic.unknown" as const, topic },
      { kind: "item.held" as const, item },
    ],
    effects: [{ kind: "belief.record" as const, topic }, { kind: "offer.create" as const, item }],
  };
}

type WorldFixture = ReturnType<typeof setup>;

async function seedMarketGossip(fx: WorldFixture) {
  const { giver, recipient, item } = marketGossip;
  fx.mode("edit");
  await fx.commit(fx.request("token", [{ kind: "overlay.create", entity_kind: "item", entity: item,
    region: "region:market", label: "Market token", holder: giver }], "EDITOR"));
  await fx.commit(fx.request("acquaintance", [{ kind: "remix.assign", entity_id: giver,
    field: "relationship:" + recipient, value: "acquaintance" }], "EDITOR"));
}

function gossipRequest(fx: WorldFixture, id: string, text = marketGossip.text) {
  return fx.request(id, [{ kind: "speech.record", text }], "PLAY", text);
}

function offerRequest(fx: WorldFixture, id: string, offerId: string) {
  const input = { kind: "offer.accept", offer_id: offerId } as const;
  return fx.request(id, [input], "PLAY", input);
}

async function rejectPlay(fx: WorldFixture, req: ReturnType<WorldFixture["request"]>) {
  const before = fx.head();
  const prepared = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
  const result = prepared.ok && prepared.value.kind === "prepared"
    ? await fx.service.commitTurn(fx.access, req.envelope, prepared.value.handle.candidate_id)
    : prepared;
  assert.ok(!result.ok);
  assert.deepEqual(fx.head(), before);
  return result.error;
}

void test("A36 approved gossip rule records witnessed knowledge and makes one offer for later acceptance", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, recipient, item, topic } = marketGossip;
  await seedMarketGossip(fx);
  const rule = marketRule();
  await fx.commit(fx.request("install-gossip", [{ kind: "rule.install", rule }], "EDITOR"));
  fx.mode("play");
  const before = fx.head().snapshot.world!;
  await fx.commit(gossipRequest(fx, "paraphrase", "We used to be friends."));
  assert.deepEqual(fx.head().snapshot.world!.beliefs, before.beliefs);

  const req = gossipRequest(fx, "gossip");
  const stage = fx.prepare(req);
  const clock = fx.head().snapshot.clock.overlay_turn;
  const outcome = take(await fx.service.commitTurn(fx.access, req.envelope, stage.handle.candidate_id));
  const spoken = fx.head();
  assert.equal(spoken.snapshot.clock.overlay_turn, clock + 1);
  const world = spoken.snapshot.world!;
  const speech = world.events.find((event) => event.kind === "speech" && event.request === req.envelope.request_id);
  assert.equal(speech?.kind, "speech");
  assert.deepEqual(speech.listeners, [giver]);
  assert.deepEqual(world.beliefs.map((belief) => ({ character: belief.character, evidence: belief.evidence,
    topic: "topic" in belief ? belief.topic : undefined })), [{ character: giver, evidence: speech.id, topic }]);
  assert.deepEqual(world.facts, before.facts);
  assert.equal(activeFact(world, item, "inventory:holder")?.value, giver);
  assert.ok("offers" in world);
  assert.equal(world.offers.length, 1);
  const offer = world.offers[0]!;
  assert.deepEqual({ item: offer.item, giver: offer.giver, recipient: offer.recipient, consumed_by: offer.consumed_by },
    { item, giver, recipient, consumed_by: null });
  const narration = outcome.receipt.narration_facts.join("\n");
  assert.ok(narration.includes(offer.id));
  assert.ok(!narration.includes(topic) && !narration.includes(rule.id));

  assert.deepEqual(take(await fx.service.commitTurn(fx.access, req.envelope, stage.handle.candidate_id)), outcome);
  assert.deepEqual(fx.head(), spoken);
  const repeated = await fx.commit(gossipRequest(fx, "fresh-gossip"));
  const afterRepeat = fx.head().snapshot.world!;
  assert.ok("offers" in afterRepeat);
  assert.deepEqual(afterRepeat.offers, world.offers);
  assert.deepEqual(afterRepeat.beliefs, world.beliefs);
  assert.equal(repeated.receipt.event_ids.length, 1);

  await rejectPlay(fx, fx.request("take-without-offer", [{ kind: "inventory.transfer", item, from: giver, to: recipient }]));
  const acceptClock = fx.head().snapshot.clock.overlay_turn;
  await fx.commit(offerRequest(fx, "accept-token", offer.id));
  const accepted = fx.head().snapshot;
  assert.equal(accepted.clock.overlay_turn, acceptClock + 1);
  const after = accepted.world!;
  assert.ok("offers" in after);
  assert.equal(after.offers.length, 1);
  assert.equal(after.offers[0]?.id, offer.id);
  assert.ok(after.offers[0]?.consumed_by);
  assert.equal(activeFact(after, item, "inventory:holder")?.value, recipient);
  assert.deepEqual(after.facts.filter(({ subject }) => subject !== item), before.facts.filter(({ subject }) => subject !== item));
  await rejectPlay(fx, offerRequest(fx, "accept-token-again", offer.id));
});

void test("an observation keeps its producing fact when a rule changes that fact in the same turn", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, recipient } = marketGossip;
  const field = "relationship:" + recipient;
  await seedMarketGossip(fx);
  await fx.commit(fx.request("install-observed-relationship", [{ kind: "rule.install", rule: {
    version: "1.0.0", id: "behavior:observed-relationship", owner: giver,
    when: { kind: "observation", subject: giver, field }, conditions: [],
    effects: [{ kind: "relationship.adjust", target: recipient, step: 1 }],
  } }], "EDITOR"));
  fx.mode("play");

  const prior = activeFact(fx.head().snapshot.world!, giver, field);
  assert.ok(prior);
  const receipt = await fx.commit(fx.request("observe-before-adjust", [{
    kind: "observation.record", observer: giver, subject: giver, field,
  }]));
  const image = fx.head();
  const world = image.snapshot.world!;
  const observed = world.events.at(-2);
  const adjusted = world.events.at(-1);
  assert.equal(observed?.kind, "observation");
  assert.equal(observed.fact_source, prior.source);
  assert.equal(adjusted?.kind, "rule.effect");
  assert.equal(adjusted.step.event_id, observed.id);
  assert.equal(observed.revision, adjusted.revision);
  assert.equal(activeFact(world, giver, field)?.value, "friend");
  assert.equal(receipt.receipt.event_ids.length, 2);
  assert.ok(validateImage(image, makeFixture()).ok);
  assert.ok(fx.store.checkpointHistoryValid(image));
  const history = fx.store.portableHistory(image);
  const key = Buffer.alloc(32, 20);
  assert.ok(history && decodePortable(encodePortable(history, key)!, fx.access.owner_id, key));

  observed.fact_source = adjusted.id;
  image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, world);
  assert.equal(validateImage(image, makeFixture()).ok, false);
});

void test("an offer transfer requires an exact acceptance input and its own turn", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  await fx.commit(fx.request("install-offer-input-rule", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fx.mode("play");
  await fx.commit(gossipRequest(fx, "make-offer-for-input-check"));
  const before = fx.head();
  const world = before.snapshot.world!;
  assert.equal(world.version, "2.0.0");
  const offer = world.offers[0]!;
  const accept = { kind: "offer.accept", offer_id: offer.id } as const;
  const another = { kind: "offer.accept", offer_id: "world-event:other" } as const;
  const text = marketGossip.text;
  for (const req of [
    fx.request("unrelated-offer-input", [accept], "PLAY", "Look around."),
    fx.request("hidden-in-speech", [{ kind: "speech.record", text }, accept], "PLAY", text),
    fx.request("wrong-offer", [accept], "PLAY", another),
    fx.request("ignore-offer-input", [{ kind: "observation.record", observer: marketGossip.giver,
      subject: marketGossip.giver, field: "world:description" }], "PLAY", accept),
    fx.request("compound-acceptance", [{ kind: "observation.record", observer: marketGossip.giver,
      subject: marketGossip.giver, field: "world:description" }, accept], "PLAY", accept),
  ]) {
    const result = fx.service.prepareTurn(fx.access, req.envelope, req.proposal);
    assert.ok(!result.ok);
    assert.equal(result.error.status, "VALIDATION_FAILED");
    assert.deepEqual(fx.head(), before);
  }
  const request = offerRequest(fx, "accept-exact-offer", offer.id);
  const stage = fx.prepare(request);
  const received = take(await fx.service.commitTurn(fx.access, request.envelope, stage.handle.candidate_id));
  assert.equal(received.receipt.in_fiction_result, "success");
  assert.deepEqual(take(await fx.service.commitTurn(fx.access, request.envelope, stage.handle.candidate_id)), received);
});

void test("bounded relationship adjustments preserve each ordered effect within a turn", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, recipient } = marketGossip;
  const field = "relationship:" + recipient;
  await seedMarketGossip(fx);
  await fx.commit(fx.request("install-two-adjustments", [{ kind: "rule.install", rule: {
    ...marketRule(), conditions: [], effects: [
      { kind: "relationship.adjust", target: recipient, step: 1 },
      { kind: "relationship.adjust", target: recipient, step: -1 },
    ],
  } }], "EDITOR"));
  fx.mode("play");
  const receipt = await fx.commit(gossipRequest(fx, "trigger-two-adjustments"));
  const image = fx.head();
  const world = image.snapshot.world!;
  const revision = image.checkpoint.revision;
  const facts = world.facts.filter((fact) => fact.subject === giver && fact.field === field && fact.from === revision);
  assert.deepEqual(facts.map(({ value, until }) => [value, until]), [["friend", revision], ["acquaintance", null]]);
  assert.deepEqual(facts.map(({ source }) => source), world.events.slice(-2).map(({ id }) => id));
  assert.equal(receipt.receipt.event_ids.length, 3);
  assert.ok(fx.store.checkpointHistoryValid(image));
  const history = fx.store.portableHistory(image);
  const key = Buffer.alloc(32, 21);
  assert.ok(history && decodePortable(encodePortable(history, key)!, fx.access.owner_id, key));
});

void test("rule installation rejects unsupported versions, executable parameters, unregistered effects, and a self-cycle", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  const definition = marketRule();
  const { giver, item } = marketGossip;
  const before = fx.head();
  for (const [id, rule] of [
    ["version", { ...definition, version: "2.0.0" }],
    ["expression", { ...definition, conditions: [{ kind: "speech.equals", text: marketGossip.text,
      expression: "return true" }] }],
    ["exit", { ...definition, effects: [{ kind: "overlay.connect", connection: "remix:shortcut",
      from: "remix:market", to: "remix:vault" }] }],
    ["cycle", { ...definition, when: { kind: "offer.created", item }, conditions: [],
      effects: [{ kind: "offer.create", item }] }],
  ] as const) {
    const { envelope, proposal } = fx.request(id, [{ kind: "rule.install", rule: definition }], "EDITOR");
    const invalid = { ...proposal, operations: [{ kind: "rule.install", rule }] };
    assert.equal(fx.service.prepareTurn(fx.access, envelope, invalid).ok, false, id);
    assert.deepEqual(fx.head(), before);
  }
  await fx.commit(fx.request("valid-rule", [{ kind: "rule.install", rule: definition }], "EDITOR"));
  assert.equal(activeFact(fx.head().snapshot.world!, item, "inventory:holder")?.value, giver);
});

void test("a later rule failure rolls back witnessed speech, belief, and the staged offer", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, recipient, item } = marketGossip;
  const field = "relationship:" + recipient;
  await seedMarketGossip(fx);
  await fx.commit(fx.request("producer", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  await fx.commit(fx.request("consumer", [{ kind: "rule.install", rule: {
    version: "1.0.0", id: "behavior:offer-friendship", owner: giver,
    when: { kind: "offer.created", item }, conditions: [],
    effects: [{ kind: "relationship.adjust", target: recipient, step: 1 }],
  } }], "EDITOR"));
  await fx.commit(fx.request("at-limit", [{ kind: "remix.assign", entity_id: giver, field, value: "friend" }], "EDITOR"));
  fx.mode("play");
  await rejectPlay(fx, gossipRequest(fx, "overflow"));

  fx.mode("edit");
  await fx.commit(fx.request("within-range", [{ kind: "remix.assign", entity_id: giver, field, value: "acquaintance" }], "EDITOR"));
  fx.mode("play");
  await fx.commit(gossipRequest(fx, "within-range-gossip"));
  const world = fx.head().snapshot.world!;
  assert.ok("offers" in world);
  assert.equal(world.offers.length, 1);
  assert.equal(world.beliefs.length, 1);
  assert.equal(activeFact(world, giver, field)?.value, "friend");
});

function protectVault(image: TurnImage, sources: readonly (readonly [string, string])[]) {
  const native = image.snapshot.entities.find(({ id }) => id === "native:room")!;
  native.region_ids = ["region:vault"];
  const gate = native.surfaces.find(({ field }) => field === "progression:counter")!;
  const dependency = { entity_id: native.id, field: gate.field, change: "write" as const };
  image.snapshot.world_dependencies = sources.map(([entity_id, field]) => ({
    source: { entity_id, field, change: "write" }, dependency,
  }));
  const { policy } = image.snapshot;
  const source = { source_id: policy.sources[0]!.id, start: 0, end: 1 };
  policy.policy_amendment.invariants.push({
    id: "rule:vault", source, protected: true, supersedes: [],
    scope: { origins: ["native"], entity_ids: [native.id], region_ids: ["region:vault"], domains: ["progression"] },
    guard: { id: "field.unchanged", enforcement: "structural", parameters: { field: gate.field } },
  });
}

void test("A07 nested offered inventory checks trusted transitive vault progression before publication", async (t) => {
  const fixture = setup(undefined, Date.now, undefined, (image) => {
    const intermediate = { entity_id: "remix:room", field: "presentation:label", change: "write" as const };
    protectVault(image, [[intermediate.entity_id, intermediate.field]]);
    image.snapshot.world_dependencies!.push({
      source: { entity_id: marketGossip.giver, field: "inventory:contents", change: "write" },
      dependency: intermediate,
    });
    // Start the fixture with the item held, so seeding is outside the protected transition being tested.
    const world = image.snapshot.world!;
    const source = world.events[0]!.id;
    world.entities.push({ kind: "item", id: marketGossip.item, label: "Market token", container: false, source });
    world.facts.push({ subject: marketGossip.item, field: "inventory:holder", value: marketGossip.giver, from: 0,
      until: null, source, owner: "remix", visibility: "player", evidence: "fixture" });
  });
  t.after(() => fixture.close());
  fixture.mode("edit");
  await fixture.commit(fixture.request("handoff-item", [{ kind: "overlay.create", entity_kind: "item",
    entity: "remix:handoff-item", region: "region:market", label: "Handoff item", holder: marketGossip.recipient }], "EDITOR"));
  await fixture.commit(fixture.request("a07-install", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fixture.mode("play");
  await fixture.commit(gossipRequest(fixture, "a07-offer"));
  const image = fixture.head();
  const world = image.snapshot.world!;
  assert.ok(world.version === "2.0.0");
  const offer = world.offers[0]!;
  const attempt = offerRequest(fixture, "a07-accept", offer.id);
  const resolved = resolvePolicy(image.snapshot, attempt.proposal);
  assert.ok(!resolved.ok);
  assert.equal(resolved.error.status, "POLICY_CONFLICT");
  assert.ok(resolved.trace.rule_ids.includes("rule:vault"));
  assert.equal((await rejectPlay(fixture, attempt)).status, "POLICY_CONFLICT");
  assert.equal(activeFact(fixture.head().snapshot.world!, offer.item, "inventory:holder")?.value, offer.giver);
  const handoff = fixture.request("ordinary-handoff", [{ kind: "inventory.transfer", item: "remix:handoff-item",
    from: marketGossip.recipient, to: marketGossip.giver }]);
  assert.equal((await rejectPlay(fixture, handoff)).status, "POLICY_CONFLICT");
});

void test("A07 initial speech and rule installation resolve protected dependencies before any write", async (t) => {
  const speech = setup(undefined, Date.now, undefined, (image) => {
    protectVault(image, [[marketGossip.giver, "dialogue:speech"]]);
  });
  const install = setup(undefined, Date.now, undefined, (image) => {
    protectVault(image, [[marketGossip.giver, "behavior:rules"]]);
  });
  t.after(() => { speech.close(); install.close(); });
  await seedMarketGossip(speech);
  await speech.commit(speech.request("protected-speech-rule", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  speech.mode("play");
  const attempt = gossipRequest(speech, "protected-speech");
  const result = resolvePolicy(speech.head().snapshot, attempt.proposal);
  assert.ok(!result.ok);
  assert.equal(result.error.status, "POLICY_CONFLICT");
  assert.ok(result.trace.rule_ids.includes("rule:vault"));
  assert.equal((await rejectPlay(speech, attempt)).status, "POLICY_CONFLICT");
  assert.equal(speech.head().snapshot.world!.beliefs.length, 0);
  assert.equal(speech.store.fixtureReceipts(speech.head().checkpoint.checkpoint_id, 10)
    .some(({ receipt }) => receipt.request_id === attempt.envelope.request_id), false);

  await seedMarketGossip(install);
  const req = install.request("protected-install", [{ kind: "rule.install", rule: marketRule() }], "EDITOR");
  const before = install.head();
  const opened = install.service.prepareTurn(install.access, req.envelope, req.proposal);
  assert.ok(!opened.ok);
  assert.equal(opened.error.status, "POLICY_CONFLICT");
  assert.deepEqual(install.head(), before);
});

void test("rule eligibility reports the container and actor reads and a turn accepts at most one offer", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, recipient, item } = marketGossip;
  await seedMarketGossip(fx);
  const spare = "remix:spare-container";
  await fx.commit(fx.request("spare-container", [{ kind: "overlay.create", entity_kind: "item", entity: spare,
    region: "region:market", label: "Spare container", holder: giver, container: true }], "EDITOR"));
  await fx.commit(fx.request("eligibility-rule", [{ kind: "rule.install", rule: {
    ...marketRule(), id: "behavior:eligibility-read", conditions: [{ kind: "offer.eligible", item: spare }],
    effects: [{ kind: "belief.record", topic: "topic:eligibility" }],
  } }], "EDITOR"));
  await fx.commit(fx.request("two-rewards-rule", [{ kind: "rule.install", rule: {
    ...marketRule(), effects: [{ kind: "offer.create", item }, { kind: "offer.create", item: spare }],
  } }], "EDITOR"));
  fx.mode("play");
  const action = gossipRequest(fx, "rewards");
  const resolved = resolvePolicy(fx.head().snapshot, action.proposal);
  assert.ok(resolved.ok);
  const footprint = resolved.plan.rule_steps?.find(({ effect }) => effect.kind === "belief.record")?.effects;
  assert.ok(footprint);
  for (const [entity_id, field] of [[spare, "inventory:contents"], [spare, "inventory:holder"],
    [giver, "inventory:offers"], [giver, "entity:record"], [recipient, "entity:record"], [giver, "dialogue:speech"]]) {
    assert.ok(footprint.some((effect) => effect.entity_id === entity_id && effect.field === field && effect.change === "read"), field);
  }
  await fx.commit(action);
  const world = fx.head().snapshot.world;
  assert.ok(world?.version === "2.0.0");
  assert.equal(world.offers.length, 2);
  const requests = world.offers.map(({ id }) => ({ kind: "offer.accept" as const, offer_id: id }));
  const multiple = fx.request("accept-two", requests, "PLAY", requests[0]!);
  assert.equal((await rejectPlay(fx, multiple)).status, "VALIDATION_FAILED");
  assert.equal(resolvePolicy(fx.head().snapshot, multiple.proposal).ok, false);
  await fx.commit(offerRequest(fx, "accept-one", requests[0]!.offer_id));
  const after = fx.head().snapshot.world;
  assert.ok(after?.version === "2.0.0");
  assert.deepEqual(after.offers.map(({ consumed_by }) => consumed_by !== null), [true, false]);
});

void test("policy planning stops before evaluating the next root once its turn deadline expires", (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const req = fx.request("planning-deadline", [
    { kind: "overlay.create", entity_kind: "location", entity: "remix:timed", region: "region:market", label: "Timed" },
    { kind: "overlay.connect", connection: "remix:bad", from: "remix:missing-room", to: "remix:market" },
  ]);
  const before = fx.head();
  let reads = 0;
  const budget = turnBudget(() => ++reads < 3 ? 0 : limits.turn_ms);
  const result = resolvePolicy(before.snapshot, req.proposal, budget);
  assert.ok(!result.ok);
  assert.equal(result.error.status, "ABORTED");
  assert.match(result.error.message, /policy planning/u);
  assert.deepEqual(fx.head(), before);
});

void test("one monotonic turn deadline rolls back a cascade that expires during publication", async (t) => {
  let elapsed = 0;
  let clockReads = 0;
  let expire = false;
  const fx = setup((point) => {
    if (!expire) return;
    if (point === "after_checkpoint") elapsed = limits.turn_ms - 1;
    if (point === "before_commit") elapsed += 2;
  }, Date.now, undefined, undefined, () => {
    // Spend part of the budget before execution starts.
    if (expire && ++clockReads === 2) elapsed = 1000;
    return elapsed;
  });
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  await fx.commit(fx.request("deadline-rule", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fx.mode("play");
  const action = gossipRequest(fx, "deadline-gossip");
  const stage = fx.prepare(action);
  const before = fx.head();
  const attempt = () => fx.service.commitTurn(fx.access, action.envelope, stage.handle.candidate_id);
  expire = true;
  const rejected = await attempt();
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.status, "ABORTED");
  assert.equal(rejected.error.retry, "same_request");
  assert.deepEqual(fx.head(), before);
  assert.equal(fx.store.fixtureReceipts(before.checkpoint.checkpoint_id, 10)
    .some(({ receipt }) => receipt.request_id === action.envelope.request_id), false);
  expire = false;
  assert.equal(take(await attempt()).receipt.event_ids.length, 3);
});

void test("A21 offer cascades fail atomically beyond depth, operations, or evaluation limits", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  const { giver } = marketGossip;
  const items = Array.from({ length: 9 }, (_, i) => "remix:chain-token-" + i);
  for (const item of items) {
    await fx.commit(fx.request("create-" + item, [{ kind: "overlay.create", entity_kind: "item",
      entity: item, region: "region:market", label: item, holder: giver }], "EDITOR"));
  }
  await fx.commit(fx.request("install-chain-root", [{ kind: "rule.install", rule: {
    ...marketRule(), conditions: [{ kind: "speech.equals", text: marketGossip.text }],
    effects: [{ kind: "offer.create", item: items[0]! }],
  } }], "EDITOR"));
  for (let i = 1; i < items.length; i++) {
    await fx.commit(fx.request("install-chain-" + i, [{ kind: "rule.install", rule: {
      version: "1.0.0", id: "behavior:chain-" + i, owner: giver,
      when: { kind: "offer.created", item: items[i - 1]! }, conditions: [],
      effects: [{ kind: "offer.create", item: items[i]! }],
    } }], "EDITOR"));
  }
  const cycle = fx.request("install-cycle", [{ kind: "rule.install", rule: {
    version: "1.0.0", id: "behavior:chain-cycle", owner: giver,
    when: { kind: "offer.created", item: items.at(-1)! }, conditions: [], effects: [{ kind: "offer.create", item: items[0]! }],
  } }], "EDITOR");
  assert.equal(fx.service.prepareTurn(fx.access, cycle.envelope, cycle.proposal).ok, false);
  fx.mode("play");
  assert.equal((await rejectPlay(fx, gossipRequest(fx, "overflow-depth"))).status, "ABORTED");

  for (const [size, status] of [[31, "COMMITTED"], [32, "ABORTED"]] as const) {
    const next = setup();
    try {
      await seedMarketGossip(next);
      const effects = Array.from({ length: 8 }, (_, i) => ({ kind: "belief.record" as const, topic: "topic:slot-" + i }));
      for (let i = 0; i < 4; i++) {
        await next.commit(next.request("limit-" + i, [{ kind: "rule.install", rule: {
          ...marketRule(), id: "behavior:limit-" + i, conditions: [],
          effects: effects.slice(0, i === 3 ? size - 24 : 8).map((effect) => ({ ...effect, topic: effect.topic + "-" + i })),
        } }], "EDITOR"));
      }
      next.mode("play");
      const req = gossipRequest(next, "operation-limit");
      if (status === "COMMITTED") assert.equal((await next.commit(req)).receipt.event_ids.length, 32);
      else assert.equal((await rejectPlay(next, req)).status, status);
    } finally {
      next.close();
    }
  }

  const metered = setup();
  t.after(() => metered.close());
  await seedMarketGossip(metered);
  for (let i = 0; i < 15; i++) {
    await metered.commit(metered.request("metered-" + i, [{ kind: "rule.install", rule: {
      ...marketRule(), id: "behavior:metered-" + i,
      conditions: [...Array.from({ length: 7 }, () => ({ kind: "item.held" as const, item: marketGossip.item })),
        { kind: "speech.equals", text: "Unmatched literal" }],
    } }], "EDITOR"));
  }
  metered.mode("play");
  assert.equal((await rejectPlay(metered, gossipRequest(metered, "budgeted-misses"))).status, "ABORTED");
});

void test("behavior outcomes survive reopen, validate signed history, and recover after publication", async (t) => {
  let fault: FaultPoint | undefined;
  const fx = setup((point) => { if (point === fault) throw new Error("behavior fault " + point); });
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  await fx.commit(fx.request("persistent-rule", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fx.mode("play");
  const play = gossipRequest(fx, "durable-cascade");
  const stage = fx.prepare(play);
  const attempt = () => fx.service.commitTurn(fx.access, play.envelope, stage.handle.candidate_id);
  const before = fx.head();
  fault = "before_commit";
  assert.equal((await attempt()).ok, false);
  assert.deepEqual(fx.head(), before);
  fault = "after_commit";
  assert.equal((await attempt()).ok, false);
  const committed = fx.head();
  assert.notDeepEqual(committed, before);
  fault = undefined;
  fx.reopen();
  const recovered = take(await attempt());
  assert.equal(recovered.receipt.event_ids.length, 3);
  assert.deepEqual(fx.head(), committed);
  assert.ok(recovered.world_proposal);
  const { generation_id, request_id } = recovered.receipt;
  const requestKey = canonicalJson({ ...fx.access, generation_id, request_id });
  const db = new DatabaseSync(fx.file);
  try {
    assert.ok(fx.store.receiptTransition(requestKey, recovered));
    const update = db.prepare("UPDATE requests SET proposal=? WHERE id=?");
    assert.equal(update.run("0".repeat(64), requestKey).changes, 1);
    assert.equal(fx.store.receiptTransition(requestKey, recovered), undefined);
    assert.equal(fx.store.checkpointHistoryValid(committed), false);
    assert.equal(update.run(canonicalDigest(recovered.world_proposal), requestKey).changes, 1);
    assert.ok(fx.store.receiptTransition(requestKey, recovered));
  } finally {
    db.close();
  }
  const { owner_id } = fx.access;
  const history = fx.store.portableHistory(committed);
  assert.ok(history);
  const key = Buffer.alloc(32, 1);
  const original = decodePortable(encodePortable(history, key)!, owner_id, key);
  assert.ok(original);
  assert.deepEqual(relocatePortable(original).imported.snapshot.world, committed.snapshot.world);

  const corrupt = structuredClone(history);
  const entry = corrupt.at(-1)!;
  const world = entry.image.snapshot.world;
  assert.ok(world?.version === "2.0.0");
  const forged = world.events.at(-1)!;
  assert.equal(forged.kind, "rule.effect");
  forged.step.event_id = forged.id;
  entry.events[entry.events.length - 1] = forged;
  entry.image.checkpoint.remix_state_ref = remixStateRef(entry.image.snapshot.entities, world);
  assert.equal(decodePortable(encodePortable(corrupt, key)!, owner_id, key), undefined);
  const reordered = structuredClone(history);
  const last = reordered.at(-1)!;
  last.events.reverse();
  assert.equal(decodePortable(encodePortable(reordered, key)!, owner_id, key), undefined);

  for (const field of [undefined, "inventory:unexpected"] as const) {
    const wrongFootprint: PortableEntry[] = structuredClone(history);
    const last = wrongFootprint.at(-1)!;
    const world = last.image.snapshot.world;
    assert.ok(world?.version === "2.0.0");
    const effect = world.events.at(-1)!;
    assert.equal(effect.kind, "rule.effect");
    effect.step.effects = field ? [{ entity_id: marketGossip.giver, field, change: "write" }] : [];
    last.events[last.events.length - 1] = effect;
    last.image.checkpoint.remix_state_ref = remixStateRef(last.image.snapshot.entities, world);
    assert.equal(decodePortable(encodePortable(wrongFootprint, key)!, owner_id, key), undefined);
  }

  const falseCondition = structuredClone(history);
  const neverMatched = marketRule();
  const definition = { ...neverMatched, conditions: neverMatched.conditions.map((condition) =>
    condition.kind === "topic.unknown" ? { ...condition, kind: "topic.known" as const } : condition) };
  const installDigest = canonicalDigest(definition);
  const originalInstallation = falseCondition.find(({ receipt }) => receipt?.receipt.request_id === "request:persistent-rule");
  assert.ok(originalInstallation?.receipt?.world_proposal);
  const changedProposal = originalInstallation.receipt.world_proposal;
  changedProposal.operations = [{ kind: "rule.install", rule: definition }];
  const proposalDigest = canonicalDigest(changedProposal);
  for (const { image, events, receipt } of falseCondition) {
    const world = image.snapshot.world;
    if (world?.version !== "2.0.0") continue;
    world.rules[0]!.definition = definition;
    const installation = world.events.find((event) => event.kind === "rule.installed");
    assert.ok(installation);
    installation.definition_digest = installDigest;
    installation.proposal = proposalDigest;
    if (receipt?.receipt.request_id === "request:persistent-rule") events[0] = installation;
    image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, world);
  }
  assert.equal(decodePortable(encodePortable(falseCondition, key)!, owner_id, key), undefined);

  const missingRuleEffects = structuredClone(history);
  const speechOnly = missingRuleEffects.at(-1)!;
  const priorWorld = missingRuleEffects.at(-2)?.image.snapshot.world;
  assert.ok(priorWorld?.version === "2.0.0");
  const speech = speechOnly.image.snapshot.world?.events.at(-(speechOnly.events.length));
  assert.equal(speech?.kind, "speech");
  speechOnly.events = [speech];
  assert.ok(speechOnly.receipt);
  speechOnly.receipt.receipt.event_ids = speechOnly.receipt.receipt.event_ids.slice(0, 1);
  speechOnly.image.snapshot.world = { ...priorWorld, events: [...priorWorld.events, speech] };
  speechOnly.image.checkpoint.remix_state_ref = remixStateRef(speechOnly.image.snapshot.entities, speechOnly.image.snapshot.world);
  assert.equal(decodePortable(encodePortable(missingRuleEffects, key)!, owner_id, key), undefined);

  // The edited action and resulting state agree, while the producing digest still binds the original speech.
  const nonTrigger = "The lantern is still lit.";
  assert.ok(speechOnly.receipt.world_proposal);
  speechOnly.receipt.world_proposal.operations = [{ kind: "speech.record", text: nonTrigger }];
  speech.text = nonTrigger;
  speechOnly.image.checkpoint.remix_state_ref = remixStateRef(speechOnly.image.snapshot.entities, speechOnly.image.snapshot.world);
  assert.equal(decodePortable(encodePortable(missingRuleEffects, key)!, owner_id, key), undefined);

  const pending = fx.head().snapshot.world;
  assert.ok(pending?.version === "2.0.0");
  await fx.commit(offerRequest(fx, "persistent-accept", pending.offers[0]!.id));
  const consumed = fx.head();
  const portable = fx.store.portableHistory(consumed);
  assert.ok(portable);
  const checked = decodePortable(encodePortable(portable, key)!, owner_id, key);
  assert.ok(checked);
  const relocated = relocatePortable(checked);
  assert.deepEqual(relocated.imported.snapshot.world, consumed.snapshot.world);
  assert.ok(decodePortable(encodePortable(relocated.entries, key)!, owner_id, key));
});

void test("Play generation reuses the registry for a different observer, fact, topic, and item", async (t) => {
  const fx = setup(undefined, Date.now, undefined, (image) => {
    const source = { source_id: image.snapshot.policy.sources[0]!.id, start: 0, end: 1 };
    image.snapshot.policy.policy_amendment.generation_rules.push({
      id: "rule:allow-market-behavior", action: "generate.rule", triggers: ["player_attempt"], decision: "allow",
      source, supersedes: [], scope: {
        origins: ["remix"], entity_ids: [], region_ids: ["region:market"], domains: ["characterization", "inventory"],
      },
    });
  });
  t.after(() => fx.close());
  const observer = "remix:trader";
  const item = "remix:trader-ribbon";
  const topic = "topic:market-lantern";
  fx.mode("edit");
  for (const operation of [
    { kind: "overlay.create", entity_kind: "character", entity: observer, region: "region:market", label: "Trader", room: "remix:market" },
    { kind: "overlay.create", entity_kind: "item", entity: item, region: "region:market", label: "Ribbon", holder: observer },
  ] as const) await fx.commit(fx.request(operation.entity, [operation], "EDITOR"));
  fx.mode("play");
  const install = await fx.commit(fx.request("play-observer-rule", [{ kind: "rule.install", rule: {
    version: "1.0.0", id: "behavior:observation-reward", owner: observer,
    when: { kind: "observation", subject: marketGossip.giver, field: "world:description" },
    conditions: [{ kind: "topic.unknown", topic }, { kind: "offer.eligible", item }],
    effects: [{ kind: "belief.record", topic }, { kind: "offer.create", item }],
  } }]));
  assert.equal(install.receipt.time_cost, 0);
  assert.deepEqual(install.rule_ids, ["rule:allow-market-behavior"]);
  const observed = await fx.commit(fx.request("trader-observes", [{ kind: "observation.record",
    observer, subject: marketGossip.giver, field: "world:description" }]));
  assert.ok(observed.rule_ids.includes("rule:allow-market-behavior"));
  const world = fx.head().snapshot.world;
  assert.ok(world?.version === "2.0.0");
  assert.deepEqual(world.beliefs.map(({ character, topic }) => [character, topic]), [[observer, topic]]);
  assert.equal(world.offers[0]?.giver, observer);
  assert.equal(world.offers[0]?.item, item);
  assert.equal(activeFact(world, item, "inventory:holder")?.value, observer);

  const playHistory = fx.store.portableHistory(fx.head());
  assert.ok(playHistory);
  const key = Buffer.alloc(32, 19);
  assert.ok(decodePortable(encodePortable(playHistory, key)!, fx.access.owner_id, key));
  for (const { image, events, receipt } of playHistory) {
    const world = image.snapshot.world;
    if (world?.version !== "2.0.0") continue;
    const installation = world.events.find((e) => e.kind === "rule.installed");
    assert.ok(installation);
    installation.mode = "EDITOR";
    if (receipt?.receipt.request_id === "request:play-observer-rule") {
      assert.ok(receipt.world_proposal);
      receipt.receipt.visibility = "owner";
      receipt.world_proposal.mode = "EDITOR";
      events[0] = installation;
    }
    image.checkpoint.remix_state_ref = remixStateRef(image.snapshot.entities, image.snapshot.world);
  }
  assert.equal(decodePortable(encodePortable(playHistory, key)!, fx.access.owner_id, key), undefined);

  fx.mode("edit");
  await fx.commit(fx.request("move-eligible-item", [{ kind: "inventory.transfer", item, from: observer, to: "remix:market" }], "EDITOR"));
  fx.mode("play");
  assert.equal((await rejectPlay(fx, offerRequest(fx, "accept-moved-item", world.offers[0].id))).status,
    "NEEDS_CLARIFICATION");
});

void test("acceptance of a pending offer enforces the current inventory policy", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  const { giver, item } = marketGossip;
  await seedMarketGossip(fx);
  await fx.commit(fx.request("install", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fx.mode("play");
  await fx.commit(gossipRequest(fx, "offer"));
  const world = fx.head().snapshot.world!;
  assert.ok("offers" in world);
  const offer = world.offers[0];
  assert.ok(offer);
  fx.mode("edit");
  take(await editBundle(fx, "keep-token", [{ kind: "invariant", id: "rule:keep-token", protected: true,
    scope: protectedScope(["inventory"]), guard: { id: "inventory.possession", enforcement: "structural",
      parameters: { item, holder: giver } } }])());
  fx.mode("play");
  const rejected = await rejectPlay(fx, offerRequest(fx, "protected-accept", offer.id));
  assert.equal(rejected.status, "POLICY_CONFLICT");
});

void test("a Play-generated rule cannot run after its generation allowance is superseded", async (t) => {
  const scope = {
    origins: ["remix"], entity_ids: [], region_ids: ["region:market"], domains: ["characterization", "inventory"],
  } satisfies TurnImage["snapshot"]["policy"]["policy_amendment"]["generation_rules"][number]["scope"];
  const allowance = "rule:allow-gossip-behavior";
  const fx = setup(undefined, Date.now, undefined, ({ snapshot }) => {
    snapshot.policy.policy_amendment.generation_rules.push({
      id: allowance, action: "generate.rule", triggers: ["player_attempt"], decision: "allow", scope,
      source: { source_id: snapshot.policy.sources[0]!.id, start: 0, end: 1 }, supersedes: [],
    });
  });
  t.after(() => fx.close());
  await seedMarketGossip(fx);
  fx.mode("play");
  const installation = await fx.commit(fx.request("install-under-allowance", [{ kind: "rule.install", rule: marketRule() }]));
  assert.deepEqual(installation.rule_ids, [allowance]);
  fx.mode("edit");
  take(await editBundle(fx, "deny-behavior", [{
    kind: "supersession", old_rule_id: allowance, retained: [],
    replacement: { kind: "permission", id: "rule:deny-gossip-behavior", action: "generate.rule",
      triggers: ["player_attempt"], decision: "deny", scope },
  }])());
  fx.mode("play");
  const request = gossipRequest(fx, "trigger-after-denial");
  assert.equal((await rejectPlay(fx, request)).status, "POLICY_CONFLICT");
  assert.deepEqual(take(fx.service.inspectFixture(fx.access, { kind: "receipt",
    generation_id: request.envelope.generation_id,
    request_id: recoveryTarget.shape.request_id.parse(request.envelope.request_id) })).receipts, []);
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
  const original = (await fx.commit(fx.request("said", [{ kind: "speech.record", text }], "PLAY", text))).receipt;
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
  const receipts = take(fx.service.inspectFixture(fx.access, { kind: "history" })).receipts;
  for (const { generation_id, request_id, narration_facts } of [original, repeated.receipt]) {
    const exact = take(fx.service.inspectFixture(fx.access, { kind: "receipt", generation_id, request_id }));
    assert.equal(narration_facts.length, 1);
    assert.deepEqual(exact.receipts[0]?.narration_facts, narration_facts);
    assert.deepEqual(receipts.find((receipt) => receipt.generation_id === generation_id &&
      receipt.request_id === request_id)?.narration_facts, narration_facts);
  }
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
  const original = (await source.commit(source.request("said", [{ kind: "speech.record", text: "said" }]))).receipt;
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
  const importedReceipts = take(service.inspectFixture(access, { kind: "history" })).receipts;
  const relocated = importedReceipts.find(({ request_id }) => request_id === original.request_id);
  assert.ok(relocated);
  assert.notEqual(relocated.generation_id, original.generation_id);
  assert.notDeepEqual(relocated.event_ids, original.event_ids);
  assert.equal(original.narration_facts.length, 1);
  assert.deepEqual(relocated.narration_facts, original.narration_facts);
  const exact = take(service.inspectFixture(access, { kind: "receipt", generation_id: relocated.generation_id,
    request_id: relocated.request_id }));
  assert.deepEqual(exact.receipts, [relocated]);
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
  const record = take(await service.commitTurn(access, { ...head, input: { kind: "line", text }, intent: "play" },
    overlay.handle.candidate_id));
  assert.equal(record.receipt.narration_facts.length, 1);
  assert.deepEqual(service.viewFixtureReceipt(record).narration_facts, record.receipt.narration_facts);
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


async function checkObservationProvenance(t: TestContext, worldVersion: "1.0.0" | "2.0.0") {
  const fx = setup();
  t.after(() => fx.close());
  const remote = "remix:distant-guard";
  const local = "remix:guard";
  const field = "world:description";
  fx.mode("edit");
  await fx.commit(fx.request("vault-fact", [
    { kind: "remix.assign", entity_id: remote, field, value: "A guard staffs the vault." },
  ], "EDITOR"));
  if (worldVersion === "2.0.0") {
    await seedMarketGossip(fx);
    await fx.commit(fx.request("install-observation-fixture", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  }
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
  assert.equal(world.version, worldVersion);
  const observed = world.events.at(-1);
  assert.equal(observed?.kind, "observation");
  const key = Buffer.alloc(32, 7);
  assert.ok(validateImage(entry.image, makeFixture()).ok);
  assert.ok(fx.store.checkpointHistoryValid(entry.image));
  assert.ok(decodePortable(encodePortable(history, key)!, fx.access.owner_id, key));
  await fx.commit(fx.request("learn-market", [{ kind: "belief.update", character: local, evidence: observed.id }]));
  assert.deepEqual(fx.head().snapshot.world?.beliefs.map(({ character, evidence }) => ({ character, evidence })),
    [{ character: local, evidence: observed.id }]);

  const fact = world.facts.find((candidate) => candidate.subject === remote && candidate.field === field);
  assert.ok(fact);
  Object.assign(observed, { observer: remote, subject: remote, room: "remix:vault", fact_source: fact.source });
  const player = world.entities.find(({ id }) => id === world.player);
  assert.equal(player?.kind, "character");
  assert.notEqual(player.room, observed.room);
  entry.events[0] = observed;
  entry.image.checkpoint.remix_state_ref = remixStateRef(entry.image.snapshot.entities, world);
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
}

void test("#87 observations require historical player co-location in both world versions", async (t) => {
  await t.test("version 1", (subtest) => checkObservationProvenance(subtest, "1.0.0"));
  await t.test("version 2", (subtest) => checkObservationProvenance(subtest, "2.0.0"));
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
  const overwrite = db.prepare("UPDATE requests SET receipt=json_set(receipt, '$.receipt.narration_facts', json(?)) " +
    "WHERE json_extract(receipt, '$.receipt.request_id')=?");

  async function assertNarration(envelope: unknown, stage: ReturnType<typeof fx.prepare>, receipt: DurableReceipt["receipt"],
    text: string, expected: string[]) {
    const { generation_id, request_id } = receipt;
    const history = take(await tools.inspect_session.run(owner, { ...ref, query: { kind: "history" } }));
    const exact = take(await tools.inspect_session.run(owner, { ...ref, query: { kind: "receipt", generation_id, request_id } }));
    const request = { version: "1.0.0", target: recoveryTarget.strip().parse(envelope),
      action: { kind: "play", input: { kind: "line", text } } };
    const again = take(await tools.prepare_turn.run(owner, request));
    const replay = take(await tools.commit_turn.run(owner, { ...request, candidate_id: stage.handle.candidate_id,
      diff_digest: stage.diff_digest }));
    assert.equal(again.status, "COMMITTED");
    const found = history.receipts.find((view) => view.request_id === request_id);
    for (const view of [found, exact.receipts[0], again.receipt, replay.receipt]) {
      assert.equal(view?.request_id, request_id);
      assert.equal(view.revision, receipt.revision);
      assert.deepEqual(view.event_ids, receipt.event_ids);
      assert.deepEqual(view.narration_facts, expected, request_id);
    }
  }

  for (const variant of ["plain", "mixed", "missing-event", "wrong-parent", "restore-origin"] as const) {
    const text = "Hello " + variant;
    const req = fx.request(variant, [{ kind: "speech.record", text }], "PLAY", text);
    const prepared = fx.prepare(req);
    const { receipt } = take(await fx.service.commitTurn(fx.access, req.envelope, prepared.handle.candidate_id));
    const { request_id, narration_facts, post_checkpoint } = receipt;
    assert.equal(narration_facts.length, 1);
    assert.equal(overwrite.run(JSON.stringify(variant === "plain" ? [hidden] : [hidden, ...narration_facts]), request_id).changes, 1);
    if (variant === "missing-event") {
      const eventId = receipt.event_ids[0];
      assert.ok(eventId);
      assert.equal(db.prepare("DELETE FROM events WHERE id=?").run(eventId).changes, 1);
    }
    if (variant === "wrong-parent") {
      assert.equal(db.prepare("UPDATE checkpoint_links SET parent=? WHERE id=?")
        .run(fx.image.checkpoint.checkpoint_id, post_checkpoint).changes, 1);
    }
    if (variant === "restore-origin") {
      const origin = publicHead.strip().parse(req.envelope);
      assert.equal(db.prepare("UPDATE checkpoint_links SET origin=? WHERE id=?")
        .run(canonicalJson(origin), post_checkpoint).changes, 1);
    }
    await assertNarration(req.envelope, prepared, receipt, text, variant === "mixed" ? narration_facts : []);
  }

  const native = play("request:verified-native-prose", fx.head(), "look");
  const stage = fx.prepare(native);
  const { receipt } = take(await fx.service.commitTurn(fx.access, native.envelope, stage.handle.candidate_id));
  const expected = ["The room was observed."];
  assert.ok(fx.head().snapshot.world);
  assert.deepEqual(receipt.narration_facts, expected);
  const injected = canonicalJson({ kind: "overlay.create", entity: "remix:distant-guard", entity_kind: "character",
    label: "Unseen guard", room: "remix:vault" });
  assert.equal(overwrite.run(JSON.stringify([...expected, injected]), receipt.request_id).changes, 1);
  await assertNarration(native.envelope, stage, receipt, "look", expected);
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

void test("#89 signed history rejects a receipt ID shared by version 1 and version 2 turns", async (t) => {
  const fx = setup();
  t.after(() => fx.close());
  await fx.commit(gossipRequest(fx, "before-upgrade", "Before the rule."));
  await seedMarketGossip(fx);
  await fx.commit(fx.request("install-portable-rule", [{ kind: "rule.install", rule: marketRule() }], "EDITOR"));
  fx.mode("play");
  await fx.commit(gossipRequest(fx, "after-upgrade", "After the rule."));
  const history = fx.store.portableHistory(fx.head());
  assert.ok(history);
  const before = history.find(({ receipt }) => receipt?.receipt.request_id === "request:before-upgrade");
  const after = history.find(({ receipt }) => receipt?.receipt.request_id === "request:after-upgrade");
  assert.equal(before?.image.snapshot.world?.version, "1.0.0");
  assert.equal(after?.image.snapshot.world?.version, "2.0.0");
  assert.ok(before?.receipt && after?.receipt);
  assert.notEqual(before.image.snapshot.world.events.at(-1)?.id, after.image.snapshot.world.events.at(-1)?.id);
  assert.equal(after.events.length, 1);

  const key = Buffer.alloc(32, 8);
  const verified = decodePortable(encodePortable(history, key)!, fx.access.owner_id, key);
  assert.ok(verified);
  const relocated = relocatePortable(verified);
  assert.deepEqual(relocated.entries.map(({ image }) => image.snapshot.world),
    history.map(({ image }) => image.snapshot.world));
  assert.deepEqual(relocated.entries.map(({ events }) => events), history.map(({ events }) => events));
  const receiptIds = (entries: PortableEntry[]) => entries.flatMap(({ receipt }) => receipt?.receipt.event_ids ?? []);
  const originalIds = new Set(receiptIds(history));
  const relocatedIds = receiptIds(relocated.entries);
  assert.equal(relocatedIds.length, originalIds.size);
  assert.equal(new Set(relocatedIds).size, relocatedIds.length);
  assert.ok(relocatedIds.every((id) => !originalIds.has(id)));

  const reused = before.receipt.receipt.event_ids[0];
  assert.ok(reused);
  after.receipt.receipt.event_ids = [reused];
  const duplicate = encodePortable(history, key);
  assert.ok(duplicate);
  assert.equal(decodePortable(duplicate, fx.access.owner_id, key), undefined);
});
