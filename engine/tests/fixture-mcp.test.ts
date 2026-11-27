import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { z } from "zod";
import { Authority } from "../src/auth/authority.ts";
import { OwnerId, canonicalDigest, canonicalJson } from "../src/contracts.ts";
import { decodePortable, encodePortable, importedSession } from "../src/fixture/portable-session.ts";
import { compilerView, fixtureContext, receiptView } from "../src/fixture/session-contracts.ts";
import { createFixtureExecutor } from "../src/fixture/synthetic-world.ts";
import { fixtureServer } from "../src/mcp/server.ts";
import { scopes } from "../src/mcp/tools.ts";
import { capture, checkpointView, fingerprint, heidiStory, nativePayload, nativeStory, openStory, priorFixtureAdapter, restore, send, storyBytes } from "../src/native/checkpoint.ts";
import { createNativeFixtureExecutor } from "../src/native/executor.ts";
import { previewPolicy } from "../src/policy/policy-resolver.ts";
import { TurnImage, failure } from "../src/turn/contracts.ts";
import type { FaultPoint, TurnExecutor } from "../src/turn/contracts.ts";
import { TurnService } from "../src/turn/service.ts";
import { atPedestal, bridgeContext } from "../src/turn/extension-bridge.ts";
import { edit, endpoint, makeFixture, play, take } from "./turn-fixture.ts";

const origin = "https://fixture.test";
const version = "1.0.0";
const owner = OwnerId.parse("owner:fixture");
const other = OwnerId.parse("owner:other");
const outcome = z.object({ status: z.string() });
const context = z.object({ context: fixtureContext });
const prepared = z.object({ candidate_id: z.string(), diff_digest: z.string() });
const receipt = z.object({ receipt: receiptView });
const inspection = z.object({ receipts: z.array(receiptView), context: fixtureContext });
type Context = z.infer<typeof fixtureContext>;

function clause(text: string, source_id: string, id: string, quote: string, entries: unknown[]) {
  const index = text.indexOf(quote);
  assert.ok(index >= 0);
  const start = [...text.slice(0, index)].length;
  return { id, quote, source: { source_id, start, end: start + [...quote].length }, entries };
}
const assignment = (field: string, value: string) => ({ kind: "assignment", entity_id: "remix:room", field, value });
const protection = (id: string, field: string) => ({
  kind: "invariant", id, protected: true,
  scope: { origins: ["remix"], domains: ["presentation"], entity_ids: ["remix:room"], region_ids: [] },
  guard: { id: "field.unchanged", enforcement: "structural", parameters: { field } },
});

async function harness(directory: string, browserEnabled = true, fault?: (point: FaultPoint) => void,
  profile: "synthetic" | "synthetic-rules" | "native-z5" = "synthetic", clock = Date.now, transfers = false, heidiTrial = true) {
  const executor = profile === "native-z5" ? createNativeFixtureExecutor() : createFixtureExecutor();
  const service = new TurnService(join(directory, "fixture.sqlite"), executor, clock, fault, profile,
    transfers ? { key: Buffer.alloc(32, 42), heidiTrial } : undefined);
  const auth = {
    authenticate: (req: IncomingMessage) => {
      const token = req.headers.authorization;
      return Promise.resolve(token ? { owner: token === "Bearer other" ? other : owner,
        scopes: new Set(token === "Bearer reader" ? [scopes.read] : Object.values(scopes)) } : undefined);
    },
    browser: (req: IncomingMessage) => req.headers.cookie === "fixture=owner" ? { owner, csrf: "csrf-owner" } :
      req.headers.cookie === "fixture=other" ? { owner: other, csrf: "csrf-other" } : undefined,
    login: () => {},
    callback: () => Promise.resolve(),
    metadata: { resource: "https://fixture.test/resource", authorization_servers: ["https://idp.test/"], scopes_supported: Object.values(scopes) },
  };
  const server = fixtureServer(service, origin, auth, { browserEnabled });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port;
  let id = 0;
  let closed = false;
  async function rpc(method: string, params: unknown, token = "owner") {
    const response = await fetch(base + "/mcp", { method: "POST",
      headers: { authorization: "Bearer " + token, accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? body.split("\n").find((line) => line.startsWith("data:"))?.slice(5) : body;
    assert.ok(payload, body);
    return z.object({ result: z.unknown() }).parse(JSON.parse(payload)).result;
  }
  async function call(name: string, args: unknown, token?: string) {
    const raw = await rpc("tools/call", { name, arguments: args }, token);
    return z.object({ structuredContent: z.object({ version: z.literal(version), result: z.unknown() }) }).parse(raw).structuredContent.result;
  }
  function browserRequest(path: string, method: string, browser: string, requestOrigin: string, body?: string | Buffer,
    extra: Record<string, string> = {}) {
    return new Promise<Response>((resolve, reject) => {
      const call = request(base + path, { method,
        headers: { host: "fixture.test", origin: requestOrigin, cookie: "fixture=" + browser,
          ...(body ? { "content-type": "application/json" } : {}), ...extra },
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (typeof value === "string") headers.set(key, value);
          }
          resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500, headers }));
        });
      });
      call.on("error", reject);
      if (extra.expect === "100-continue") call.flushHeaders();
      else call.end(body);
    });
  }
  function post(path: string, payload: Record<string, unknown>, browser = "owner", requestOrigin = origin) {
    return browserRequest(path, "POST", browser, requestOrigin, JSON.stringify({ csrf: "csrf-" + browser, ...payload }));
  }
  function get(path: string, browser = "owner") {
    return browserRequest(path, "GET", browser, origin);
  }
  async function reference(path: string, payload: Record<string, unknown>, pattern: RegExp) {
    const response = await post(path, payload);
    const html = await response.text();
    assert.equal(response.status, 200, html);
    const ref = pattern.exec(html)?.[0];
    assert.ok(ref, html);
    return ref;
  }
  async function open(launch_handle: string) {
    return context.parse(await call("open_story_session", { version, launch_handle })).context;
  }
  async function record(head: Context["head"], request_id: string, purpose: string, text: string) {
    const source_ref = await reference("/fixture-source", { ...head, request_id, purpose, text }, /source:[0-9a-f-]{36}/u);
    const compiler = z.object({ compiler: compilerView }).parse(await call("get_turn_context", {
      version, session_id: head.session_id, branch_id: head.branch_id, request_id, source_ref })).compiler;
    assert.equal(compiler.text, text);
    return { target: { ...head, request_id }, compiler, action: { kind: "directive", source_ref } };
  }
  return { base, rpc, call, post, get, open, record, service,
    upload(path: string, bytes: Buffer, browser = "owner", headers: Record<string, string> = {}) {
      return browserRequest(path, "POST", browser, origin, bytes, { "content-type": "application/octet-stream",
        "x-csrf-token": "csrf-" + browser, "x-upload-consent": "yes", "content-length": String(bytes.length), ...headers });
    },
    launch: () => reference("/fixture-launch", {}, /launch:[0-9a-f-]{36}/u),
    async approve({ candidate_id, diff_digest }: z.infer<typeof prepared>) {
      const response = await post("/approve", { candidate: candidate_id, digest: diff_digest });
      assert.equal(response.status, 200, await response.text());
    },
    async close() {
      if (closed) return;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      service.close();
      closed = true;
    },
  };
}

async function initialDraft(fixture: Awaited<ReturnType<typeof harness>>, draft: Context) {
  const first = "Set the room label to Lantern Room.";
  const second = "Protect the inscription.";
  const unresolved = "Make the room remember my childhood.";
  const stored = await fixture.record(draft.head, "request:initial", "initial", [first, second, unresolved].join(" "));
  const { text, source_id, context_digest } = stored.compiler;
  const interpretation = { version, context_digest, clauses: [
    clause(text, source_id, "label", first, [assignment("presentation:label", "Lantern Room")]),
    clause(text, source_id, "protect", second, [protection("rule:inscription", "presentation:inscription")]),
    clause(text, source_id, "memory", unresolved, [{ kind: "unresolved", reason: "No memory capability." }]),
  ] };
  const prepare = { version, target: stored.target, action: { ...stored.action, interpretation } };
  const inactive = z.object({ status: z.literal("INACTIVE"), proposal_digest: z.string(), subset_url: z.url() })
    .parse(await fixture.call("prepare_turn", prepare));
  return { ...stored, prepare, inactive };
}

async function saveCombined(fixture: Awaited<ReturnType<typeof harness>>, head: Context["head"], request_id: string) {
  const args = { version, target: { ...head, request_id } };
  const raw = await fixture.call("save_session", args);
  assert.equal(outcome.parse(raw).status, "SAVED", JSON.stringify(raw));
  const { save_id } = z.object({ save_id: z.string() }).parse(raw);
  assert.deepEqual(await fixture.call("save_session", args), raw);
  return save_id;
}

async function reviewRestore(fixture: Awaited<ReturnType<typeof harness>>, args: unknown, confirm = true) {
  const requested = z.object({ status: z.literal("NEEDS_BROWSER_CONTROL"), control_url: z.url() }).parse(
    await fixture.call("restore_session", args));
  const path = new URL(requested.control_url);
  const id = path.searchParams.get("id");
  assert.ok(id);
  const wrongOwner = await fixture.get(path.pathname + path.search, "other");
  assert.equal(wrongOwner.status, 404);
  const page = await fixture.get(path.pathname + path.search);
  assert.equal(page.status, 200);
  const digest = /name="digest" value="([0-9a-f]{64})"/u.exec(await page.text())?.[1];
  assert.ok(digest);
  assert.equal((await fixture.post("/fixture-restore", { id, digest, csrf: "bad" })).status, 403);
  assert.equal((await fixture.post("/fixture-restore", { id, digest }, "other")).status, 404);
  if (confirm) assert.equal((await fixture.post("/fixture-restore", { id, digest })).status, 200);
  return { id, digest };
}

async function activateFixture(fixture: Awaited<ReturnType<typeof harness>>, existingDraft?: Context) {
  const draft = existingDraft ?? await fixture.open(await fixture.launch());
  const initial = await initialDraft(fixture, draft);
  assert.equal((await fixture.post("/fixture-subset", { source_ref: initial.action.source_ref,
    proposal_digest: initial.inactive.proposal_digest, clause_ids: ["label", "protect"] })).status, 303);
  const stage = prepared.parse(await fixture.call("prepare_turn", initial.prepare));
  await fixture.approve(stage);
  const published = await fixture.call("commit_turn", { version, target: initial.target, action: initial.action, ...stage });
  assert.equal(outcome.parse(published).status, "COMMITTED");
  const { session_id, branch_id } = draft.head;
  return { version, session_id, branch_id };
}

void test("bounded rules through authenticated MCP launch, approve, gossip, offer, accept, and restore", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-mcp-rules-"));
  const fixture = await harness(directory, true, undefined, "synthetic-rules");
  t.after(async () => {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const ref = await activateFixture(fixture);
  const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
  let head = (await read()).head;
  const mode = async (command: string) => {
    const response = await fixture.post("/fixture-mode", { ...head, request_id: "request:mode", command });
    assert.equal(response.status, 200, await response.text());
  };
  const prepareAction = (request_id: string, action: unknown) => ({ version, target: { ...head, request_id }, action });
  const stage = async (args: ReturnType<typeof prepareAction>) =>
    prepared.parse(await fixture.call("prepare_turn", args));
  const item = "remix:market-token";
  const npc = "remix:guard";
  const text = "We are old friends.";
  const topic = "topic:old-friends";
  const rule = {
    version, id: "behavior:gossip", owner: npc, when: { kind: "speech" },
    conditions: [{ kind: "speech.equals", text }, { kind: "topic.unknown", topic }, { kind: "item.held", item }],
    effects: [{ kind: "belief.record", topic }, { kind: "offer.create", item }],
  };
  const install = prepareAction("request:rule-install", { kind: "rule.install", mode: "EDITOR", rule });
  assert.equal(outcome.parse(await fixture.call("prepare_turn", install)).status, "NEEDS_APPROVAL");
  assert.equal(outcome.parse(await fixture.call("prepare_turn", install, "reader")).status, "INSUFFICIENT_SCOPE");
  await mode("/edit");
  const draft = await stage(install);
  const approval = await fixture.get("/candidate?id=" + draft.candidate_id);
  assert.equal(approval.status, 200);
  assert.match(await approval.text(), /behavior:gossip/u);
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...install, ...draft })).status, "NEEDS_APPROVAL");
  await fixture.approve(draft);
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...install, ...draft })).status, "COMMITTED");
  head = (await read()).head;
  assert.deepEqual((await read()).behavior_rules, [rule]);
  await mode("/play");

  const gossip = prepareAction("request:gossip", { kind: "overlay.speech", text });
  const preview = await fixture.call("prepare_turn", gossip);
  assert.doesNotMatch(JSON.stringify(preview), /topic:old-friends|behavior:gossip/u);
  const speechArgs = { ...gossip, ...prepared.parse(preview) };
  const nativeAction = { kind: "play", input: { kind: "line", text } };
  const spoofedSpeech = { ...speechArgs, action: nativeAction };
  const conflictResult = z.object({ status: z.literal("VALIDATION_FAILED"), subtype: z.literal("IDEMPOTENCY_CONFLICT") });
  conflictResult.parse(await fixture.call("commit_turn", spoofedSpeech));
  const speech = receipt.parse(await fixture.call("commit_turn", speechArgs)).receipt;
  conflictResult.parse(await fixture.call("commit_turn", spoofedSpeech));
  conflictResult.parse(await fixture.call("prepare_turn", { ...gossip, action: nativeAction }));
  assert.equal(speech.behavior_steps, undefined);
  assert.equal(speech.event_ids.length, 3);
  assert.equal(speech.time_cost, 1);
  const active = await read();
  assert.equal(active.behavior_rules, undefined);
  const offer = active.pending_offers?.[0];
  assert.ok(offer);
  assert.deepEqual(active.pending_offers, [{ ...offer, item, giver: npc, recipient: "remix:player" }]);
  assert.deepEqual(inspection.parse(await fixture.call("inspect_session", { ...ref,
    query: { kind: "offers" } })).context.pending_offers, [offer]);
  const id = { generation_id: speech.generation_id, request_id: speech.request_id };
  assert.deepEqual(inspection.parse(await fixture.call("inspect_session", { ...ref,
    query: { kind: "receipt", ...id } })).receipts, [speech]);
  assert.deepEqual(receipt.parse(await fixture.call("commit_turn", speechArgs)).receipt, speech);
  assert.equal(outcome.parse(await fixture.call("prepare_turn", { ...gossip, action: { ...gossip.action as object, text: "Changed" } })).status,
    "VALIDATION_FAILED");

  await t.test("#88 all receipt reads redact off-scene prose from a persisted version 2 offer", async () => {
    const legitimate = speech.narration_facts.find((note) => note.includes(offer.id));
    assert.ok(legitimate);
    const hidden = "The distant guard in the vault offers an unseen reward.";
    const db = new DatabaseSync(join(directory, "fixture.sqlite"));
    const overwrite = db.prepare("UPDATE requests SET receipt=json_set(receipt, '$.receipt.narration_facts', json(?)) " +
      "WHERE json_extract(receipt, '$.receipt.session_id')=? AND json_extract(receipt, '$.receipt.branch_id')=? " +
      "AND json_extract(receipt, '$.receipt.generation_id')=? AND json_extract(receipt, '$.receipt.request_id')=?");
    const writeNotes = (notes: string[]) => {
      assert.equal(overwrite.run(JSON.stringify(notes), ref.session_id, ref.branch_id, id.generation_id, id.request_id).changes, 1);
    };
    try {
      for (const localNotes of [[], [legitimate]]) {
        writeNotes([hidden, ...localNotes]);
        const history = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "history" } }));
        const historical = history.receipts.find(({ request_id }) => request_id === id.request_id);
        const exact = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "receipt", ...id } }));
        const preparedReplay = await fixture.call("prepare_turn", gossip);
        const committedReplay = await fixture.call("commit_turn", speechArgs);
        const expected = { ...speech, narration_facts: localNotes };
        assert.equal(outcome.parse(preparedReplay).status, "COMMITTED");
        assert.equal(outcome.parse(committedReplay).status, "COMMITTED");
        assert.deepEqual(historical, expected);
        assert.deepEqual(exact.receipts, [expected]);
        assert.deepEqual(receipt.parse(preparedReplay).receipt, expected);
        assert.deepEqual(receipt.parse(committedReplay).receipt, expected);
      }
      assert.deepEqual(await read(), active);
    } finally {
      try { writeNotes(speech.narration_facts); } finally { db.close(); }
    }
  });

  head = active.head;
  const pendingSave = await saveCombined(fixture, head, "request:save-pending");
  const accept = prepareAction("request:offer-accept", { kind: "offer.accept", offer_id: offer.id });
  const competing = prepareAction("request:competing-accept", { kind: "offer.accept", offer_id: offer.id });
  const acceptArgs = { ...accept, ...await stage(accept) };
  const competingArgs = { ...competing, ...await stage(competing) };
  const offerAlias = { kind: "play", input: { kind: "line",
    text: "offer.accept:" + canonicalDigest({ kind: "offer.accept", offer_id: offer.id }) } };
  conflictResult.parse(await fixture.call("commit_turn", { ...acceptArgs, action: offerAlias }));
  const [first, duplicate, competitor] = await Promise.all([fixture.call("commit_turn", acceptArgs),
    fixture.call("commit_turn", acceptArgs), fixture.call("commit_turn", competingArgs)]);
  assert.deepEqual(duplicate, first);
  const statuses = [outcome.parse(first).status, outcome.parse(competitor).status].sort();
  assert.deepEqual(statuses, ["COMMITTED", "STALE_REVISION"]);
  const firstWon = outcome.parse(first).status === "COMMITTED";
  const winner = firstWon ? first : competitor;
  assert.equal(receipt.parse(winner).receipt.event_ids.length, 2);
  assert.deepEqual(await fixture.call("commit_turn", firstWon ? acceptArgs : competingArgs), winner);
  assert.equal((await read()).pending_offers?.length, 0);
  head = (await read()).head;
  const consumedSave = await saveCombined(fixture, head, "request:save-consumed");

  for (const [save_id, expected] of [[pendingSave, 1], [consumedSave, 0]] as const) {
    const restore = { version, target: { ...head, request_id: "request:restore-" + expected }, save_id };
    await reviewRestore(fixture, restore);
    assert.equal(outcome.parse(await fixture.call("restore_session", restore)).status, "RESTORED");
    const restored = await read();
    head = restored.head;
    assert.equal(restored.pending_offers?.length, expected);
    assert.deepEqual(inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "receipt", ...id } }))
      .receipts[0]?.narration_facts, speech.narration_facts);
  }
  await mode("/edit");
  const inspected = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "receipt", ...id } }));
  assert.deepEqual(inspected.receipts[0]?.behavior_steps?.map(({ rule_id, effect }) => [rule_id, effect.kind]),
    [[rule.id, "belief.record"], [rule.id, "offer.create"]]);
});

function publishedImage(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = z.object({ body: z.string() }).parse(db.prepare(
      "SELECT body FROM checkpoints JOIN heads ON checkpoints.id=heads.checkpoint",
    ).get());
    return TurnImage.parse(JSON.parse(row.body));
  } finally { db.close(); }
}

async function commitFixtureInput(fixture: Awaited<ReturnType<typeof harness>>, head: Context["head"], request_id: string,
  input: { kind: "line"; text: string } | { kind: "character"; value: string }) {
  const args = { version, target: { ...head, request_id }, action: { kind: "play", input } };
  const preview = prepared.parse(await fixture.call("prepare_turn", args));
  const commit = { ...args, ...preview };
  return { commit, result: await fixture.call("commit_turn", commit) };
}

async function commitFixtureEdit(fixture: Awaited<ReturnType<typeof harness>>, head: Context["head"], id: string,
  purpose: "assignment" | "amendment", text: string, entry: unknown, publish = true) {
  const recorded = await fixture.record(head, id, purpose, text);
  const interpretation = { version, context_digest: recorded.compiler.context_digest,
    clauses: [clause(text, recorded.compiler.source_id, "edit", text, [entry])] };
  const request = { version, target: recorded.target, action: recorded.action };
  const preview = prepared.parse(await fixture.call("prepare_turn", { ...request, action: { ...request.action, interpretation } }));
  await fixture.approve(preview);
  const commit = { ...request, ...preview };
  if (publish) assert.equal(outcome.parse(await fixture.call("commit_turn", commit)).status, "COMMITTED");
  return commit;
}

void test("#25 crosses the pedestal with a frozen native checkpoint and an authored room", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-pedestal-"));
  const database = join(directory, "fixture.sqlite");
  let fault: FaultPoint | undefined;
  const injected = (point: FaultPoint) => {
    if (point === fault) {
      fault = undefined;
      throw new Error("Injected interruption at " + point);
    }
  };
  let fixture = await harness(directory, true, injected, "native-z5", Date.now, true);
  t.after(async () => {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const story = storyBytes();
  const launch = take(fixture.service.uploadPrivateStory(owner, "open", story));
  const ref = await activateFixture(fixture, await fixture.open(launch));
  const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
  const image = () => publishedImage(database);
  let sequence = 0;
  const args = async (action: unknown, head?: Context["head"]) => ({
    version, target: { ...(head ?? (await read()).head), request_id: "request:pedestal-" + ++sequence }, action,
  });
  const stage = async (request: Awaited<ReturnType<typeof args>>) => {
    const result = await fixture.call("prepare_turn", request);
    assert.equal(outcome.parse(result).status, "PREPARED", JSON.stringify(result));
    return prepared.parse(result);
  };
  const commit = async (request: Awaited<ReturnType<typeof args>>, candidate?: z.infer<typeof prepared>) =>
    receipt.parse(await fixture.call("commit_turn", { ...request, ...(candidate ?? await stage(request)) })).receipt;
  const reject = async (action: unknown, status = "CAPABILITY_MISSING") => {
    const original = image();
    assert.equal(outcome.parse(await fixture.call("prepare_turn", await args(action))).status, status);
    assert.deepEqual(image(), original);
  };
  const line = (text: string) => ({ kind: "play", input: { kind: "line", text } });
  const anchor_id = "anchor:fixture-pedestal";
  const authorAction = { kind: "bridge.author", anchor_id, label: "Listening Alcove", description: "Its walls carry echoes." };
  for (const command of ["take brass key", "north"]) {
    assert.equal((await commit(await args(line(command)))).in_fiction_result, "success", command);
  }
  await reject({ kind: "bridge.enter", anchor_id, room_id: "remix:unregistered" });
  assert.equal((await commit(await args(line("north")))).in_fiction_result, "failure");
  for (const command of ["unlock vault door with brass key", "open vault door", "north"]) {
    assert.equal((await commit(await args(line(command)))).in_fiction_result, "success", command);
  }
  const atAnchor = await read();
  assert.equal(atAnchor.native?.projection?.room.name, "Records Vault");
  assert.equal(atAnchor.extension_anchor, anchor_id);
  await reject({ kind: "bridge.enter", anchor_id, room_id: "remix:unregistered" });
  const unregistered = await saveCombined(fixture, atAnchor.head, "request:before-bridge");
  const author = await args(authorAction);
  const unplaced = image();
  for (const [entity, domain] of [["native:object-29", "topology"], ["native:object-34", "progression"]] as const) {
    const { policy } = unplaced.snapshot;
    const blocked = previewPolicy({ ...unplaced.snapshot, mode: "EDITOR", extension_anchor: bridgeContext(unplaced),
      policy: { ...policy, policy_amendment: { ...policy.policy_amendment,
        generation_rules: [...policy.policy_amendment.generation_rules, {
          id: "rule:keep-native-boundary", action: "generate.connection", triggers: ["player_attempt"], decision: "deny",
          source: { source_id: policy.sources[0]!.id, start: 0, end: 1 }, supersedes: [],
          scope: { entity_ids: [entity], origins: ["native"], domains: [domain], region_ids: [] },
        }],
      } },
    }, { ...unplaced.snapshot.head, version, request_id: author.target.request_id, mode: "EDITOR",
      operations: [authorAction], declared_effects: [], amendment: null });
    assert.ok(!blocked.ok, "Connection policy must cover " + entity);
    assert.equal(blocked.error.status, "POLICY_CONFLICT");
  }
  await reject(authorAction, "NEEDS_APPROVAL");
  const switched = await fixture.post("/fixture-mode", { ...author.target, command: "/edit" });
  assert.equal(switched.status, 200, await switched.text());
  const draft = await stage(author);
  const approvalPage = await fixture.get("/candidate?id=" + draft.candidate_id);
  const approvalText = await approvalPage.text();
  assert.equal(approvalPage.status, 200);
  assert.match(approvalText, /Listening Alcove/u);
  assert.match(approvalText, /Its walls carry echoes/u);
  assert.match(approvalText, /remix:pedestal-passage/u);
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...author, ...draft })).status, "NEEDS_APPROVAL");
  const conflictView = z.object({ status: z.literal("VALIDATION_FAILED"), subtype: z.literal("IDEMPOTENCY_CONFLICT") });
  conflictView.parse(await fixture.call("prepare_turn", { ...author, action: { ...authorAction, label: "Different room" } }));
  conflictView.parse(await fixture.call("commit_turn", { ...author, ...draft, action: { ...authorAction, label: "Different room" } }));
  await fixture.approve(draft);
  assert.equal((await commit(author, draft)).time_cost, 0);
  const world = image().snapshot.world;
  const room = world?.entities.find(({ label }) => label === "Listening Alcove");
  assert.ok(room);
  const enterAction = { kind: "bridge.enter", anchor_id, room_id: room.id };
  const playMode = await fixture.post("/fixture-mode", { ...(await args(enterAction)).target, command: "/play" });
  assert.equal(playMode.status, 200, await playMode.text());
  const replacement = await args({ ...authorAction, label: "Second room" });
  const secondEdit = await fixture.post("/fixture-mode", { ...replacement.target, command: "/edit" });
  assert.equal(secondEdit.status, 200, await secondEdit.text());
  assert.equal(outcome.parse(await fixture.call("prepare_turn", replacement)).status, "CAPABILITY_MISSING");
  const resumePlay = await fixture.post("/fixture-mode", { ...(await args(enterAction)).target, command: "/play" });
  assert.equal(resumePlay.status, 200, await resumePlay.text());
  await reject({ ...enterAction, anchor_id: "anchor:other" });
  await reject({ ...enterAction, room_id: "remix:unregistered" });
  await commit(await args(line("menu")));
  assert.equal((await read()).pending_input, "character");
  await reject(enterAction);
  await commit(await args({ kind: "play", input: { kind: "character", value: "q" } }));
  const before = image();
  assert.ok(atPedestal(before));
  for (const mismatch of [{ story_sha256: heidiStory }, { adapter_build: "0".repeat(64) },
    { native_state: { ...before.checkpoint.native_state, pending_input: { kind: "halted" as const } } }]) {
    assert.equal(atPedestal({ ...before, checkpoint: { ...before.checkpoint, ...mismatch } }), false);
  }
  const enter = await args(enterAction);
  const crossing = await stage(enter);
  const rival = await args(enterAction, enter.target);
  const rivalStage = await stage(rival);
  fault = "before_commit";
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...enter, ...crossing })).status, "ABORTED");
  assert.deepEqual(image(), before);
  const races = await Promise.all([fixture.call("commit_turn", { ...enter, ...crossing }),
    fixture.call("commit_turn", { ...rival, ...rivalStage })]);
  assert.deepEqual(races.map((result) => outcome.parse(result).status).sort(), ["COMMITTED", "STALE_REVISION"]);
  const winner = outcome.parse(races[0]).status === "COMMITTED" ? [enter, crossing] as const : [rival, rivalStage] as const;
  const entered = receipt.parse(races.find((result) => outcome.parse(result).status === "COMMITTED")).receipt;
  assert.equal(entered.time_cost, 0);
  assert.equal(entered.bridge?.transition, "bridge.enter");
  assert.equal(entered.bridge.scene.owner, "remix");
  assert.deepEqual(await commit(...winner), entered);
  const paused = await read();
  assert.deepEqual(paused.clocks, { native: before.checkpoint.clocks.native, overlay: 0 });
  assert.equal(paused.pending_input, null);
  assert.equal(paused.bridge?.native_pending, "line");
  assert.equal(paused.native?.projection, null);
  assert.ok(paused.operations.includes("overlay.speech"));
  assert.ok(!paused.operations.includes("play") && !paused.operations.includes("rule.install"));
  assert.deepEqual(image().native, before.native);
  await reject(line("look"));
  await reject(line("take Listening Alcove"));
  await reject({ kind: "mixed" }, "NEEDS_CLARIFICATION");
  const raw = await args(line("generate a shortcut"));
  const envelope = { ...raw.target, owner_id: owner, version, intent: "play", input: { kind: "line", text: "test operation" } };
  const access = { owner_id: owner, session_id: raw.target.session_id, branch_id: raw.target.branch_id };
  const beforeRejections = image();
  for (const operation of [
    { kind: "overlay.connect", connection: "remix:shortcut", from: room.id, to: "native:object-29" },
    { kind: "overlay.connect", connection: "remix:shortcut", from: "native:object-29", to: room.id },
    { kind: "inventory.transfer", item: "native:object-30", from: "native:object-21", to: "remix:player" },
    { kind: "inventory.transfer", item: "remix:unregistered-item", from: "remix:player", to: "native:object-21" },
  ]) {
    const result = fixture.service.prepareTurn(access, envelope,
      { ...raw.target, owner_id: owner, version, mode: "PLAY", operations: [operation], declared_effects: [], amendment: null });
    assert.ok(!result.ok);
    assert.equal(result.error.status, "CAPABILITY_MISSING");
  }
  assert.deepEqual(image(), beforeRejections);
  const inspectionBefore = image();
  await fixture.call("inspect_session", { ...ref, query: { kind: "facts" } });
  assert.deepEqual(image(), inspectionBefore);
  assert.equal((await commit(await args({ kind: "overlay.speech", text: "Is anyone here?" }))).time_cost, 1);
  const described = "A quiet bench rests against the wall.";
  const descriptionBefore = image().checkpoint.clocks;
  await commitFixtureEdit(fixture, (await read()).head, "request:pedestal-description", "assignment", described,
    { kind: "assignment", entity_id: room.id, field: "world:description", value: described });
  assert.deepEqual(image().checkpoint.clocks, descriptionBefore);
  const inside = await read();
  const insideSave = await saveCombined(fixture, inside.head, "request:inside-pedestal");
  const download = take(fixture.service.authorizePrivateDownload(access, insideSave));
  const bytes = take(fixture.service.exportPrivateSession(access, insideSave, download));
  const key = Buffer.alloc(32, 42);
  const archive = decodePortable(bytes, owner, key);
  assert.ok(archive?.length);
  const tampered = structuredClone(archive);
  const final = tampered.at(-1)?.image.checkpoint.bridge;
  assert.equal(final?.owner, "remix");
  final.capsule.native_tick++;
  const invalidPackage = encodePortable(tampered, key);
  assert.ok(invalidPackage);
  assert.equal(decodePortable(invalidPackage, owner, key), undefined);
  const forgedClock = structuredClone(archive);
  const edited = forgedClock.at(-1);
  assert.ok(edited?.receipt?.bridge);
  assert.equal(edited.receipt.receipt.visibility, "owner");
  edited.image.checkpoint.clocks.overlay++;
  edited.image.snapshot.clock.overlay_turn++;
  edited.receipt.bridge.clocks.overlay++;
  edited.receipt.bridge.clocks.overlay_delta++;
  edited.receipt.receipt.time_cost++;
  const forgedClockPackage = encodePortable(forgedClock, key);
  assert.ok(forgedClockPackage);
  assert.equal(decodePortable(forgedClockPackage, owner, key) === undefined, true, "An Editor assignment cannot spend overlay time.");
  const destinationPath = mkdtempSync(join(tmpdir(), "zirp-pedestal-import-"));
  const destination = await harness(destinationPath, true, undefined, "native-z5", Date.now, true);
  t.after(async () => {
    await destination.close();
    rmSync(destinationPath, { recursive: true, force: true });
  });
  const upload = take(destination.service.uploadPrivateStory(owner, "combined", story));
  assert.equal((await destination.service.importPrivateSession(owner, upload, "request:bad-pedestal", invalidPackage)).ok, false);
  const imported = take(await destination.service.importPrivateSession(owner, upload, "request:import-pedestal", bytes));
  const destinationRef = { version, session_id: imported.head.session_id, branch_id: imported.head.branch_id };
  const importedContext = context.parse(await destination.call("get_turn_context", destinationRef)).context;
  assert.deepEqual(importedContext.bridge, inside.bridge);
  assert.notEqual(importedContext.head.generation_id, inside.head.generation_id);
  const returnAction = { kind: "bridge.return", anchor_id };
  const importedReturn = { version, action: returnAction, target: { ...importedContext.head, request_id: "request:imported-return" } };
  const importedStage = prepared.parse(await destination.call("prepare_turn", importedReturn));
  assert.equal(receipt.parse(await destination.call("commit_turn", { ...importedReturn, ...importedStage })).receipt.time_cost, 0);
  assert.deepEqual(publishedImage(join(destinationPath, "fixture.sqlite")).native, before.native);

  const leave = await args(returnAction);
  const returnStage = await stage(leave);
  fault = "after_commit";
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...leave, ...returnStage })).status, "ABORTED");
  await fixture.close();
  fixture = await harness(directory, true, injected, "native-z5", Date.now, true);
  const replayed = await commit(leave, returnStage);
  assert.equal(replayed.time_cost, 0);
  assert.equal(replayed.bridge?.transition, "bridge.return");
  assert.equal(replayed.bridge.scene.capsule_id, entered.bridge.scene.capsule_id);
  const returned = image();
  assert.deepEqual(returned.native, before.native);
  assert.deepEqual(await read().then(({ clocks }) => clocks), { native: before.checkpoint.clocks.native, overlay: 1 });
  await reject(line("take listening alcove"));
  const outsideSave = await saveCombined(fixture, (await read()).head, "request:outside-pedestal");
  await commit(await args(enterAction));
  const revisited = await read();
  assert.equal(revisited.bridge?.room_id, room.id);
  assert.ok(revisited.facts.some((fact) => fact.entity_id === room.id && fact.value === described));
  await commit(await args(returnAction));
  const reference = restore(nativePayload.parse(before.native).checkpoint, storyBytes());
  const expected = send(reference, { kind: "line", text: "roll" });
  const rolled = await commit(await args(line("roll")));
  assert.equal(rolled.time_cost, 1);
  assert.deepEqual(rolled.native_output, [expected.delta]);
  assert.deepEqual(nativePayload.parse(image().native).checkpoint, capture(reference));
  const pending = await args(line("roll"));
  const staleCandidate = await stage(pending);
  for (const [save_id, ownership] of [[insideSave, "remix"], [outsideSave, "native"], [unregistered, undefined]] as const) {
    const starting = await read();
    const restoreArgs = { version, target: { ...starting.head, request_id: "request:pedestal-restore-" + (ownership ?? "before") }, save_id };
    const review = await reviewRestore(fixture, restoreArgs);
    if (ownership === "remix") {
      const preview = await fixture.get("/fixture-restore?id=" + review.id);
      assert.match(await preview.text(), /Native line input remains paused at the pedestal/u);
    }
    assert.equal(outcome.parse(await fixture.call("restore_session", restoreArgs)).status, "RESTORED");
    const after = await read();
    assert.notEqual(after.head.generation_id, starting.head.generation_id);
    assert.equal(after.mode, "PLAY");
    assert.equal(after.bridge?.owner, ownership);
    assert.equal(after.pending_input, ownership === "remix" ? null : "line");
    assert.equal(after.clocks?.overlay, ownership ? 1 : 0);
    assert.deepEqual(image().native, ownership ? before.native : unplaced.native);
    if (ownership === "remix") {
      assert.deepEqual(after.bridge, inside.bridge);
      assert.ok(after.facts.some((fact) => fact.entity_id === room.id && fact.value === described));
    }
  }
  assert.equal(outcome.parse(await fixture.call("commit_turn", { ...pending, ...staleCandidate })).status, "STALE_REVISION");
  assert.ok((await read()).operations.includes("bridge.author"));
});

void test("combined restore through MCP creates a fresh Play generation and retains exact historical receipts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-combined-"));
  const fixture = await harness(directory);
  try {
    const ref = await activateFixture(fixture);
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const saved = await read();
    const mode = (head: Context["head"], command: "/edit" | "/play") =>
      fixture.post("/fixture-mode", { ...head, request_id: "request:mode", command });
    assert.equal((await mode(saved.head, "/edit")).status, 200);
    const editor = await read();
    assert.equal(editor.mode, "EDITOR");
    const save_id = await saveCombined(fixture, editor.head, "request:save");
    assert.deepEqual(await read(), editor);
    assert.equal((await mode(saved.head, "/play")).status, 200);
    const playArgs = { version, target: { ...saved.head, request_id: "request:later" },
      action: { kind: "play", input: { kind: "line", text: "look" } } };
    const playStage = prepared.parse(await fixture.call("prepare_turn", playArgs));
    const historical = await fixture.call("commit_turn", { ...playArgs, ...playStage });
    assert.equal(outcome.parse(historical).status, "COMMITTED");
    const later = await read();
    assert.equal((await mode(later.head, "/edit")).status, 200);
    const oldLease = take(fixture.service.browser.issueLease(owner, { owner_id: owner, ...later.head }, [endpoint], 300_000, 1));
    const source = await fixture.record(later.head, "request:recorded", "assignment", "Rename the room to Old Name.");
    const args = { version, target: { ...later.head, request_id: "request:rollback" }, save_id };
    const { id, digest } = await reviewRestore(fixture, args);
    const results = await Promise.all([fixture.call("restore_session", args), fixture.call("restore_session", args)]);
    assert.equal(outcome.parse(results[0]).status, "RESTORED");
    assert.deepEqual(results[0], results[1]);
    const restored = await read();
    assert.notEqual(restored.head.generation_id, later.head.generation_id);
    assert.equal(restored.head.expected_revision, later.head.expected_revision + 1);
    assert.equal(restored.head.expected_policy_revision, saved.head.expected_policy_revision);
    assert.equal(restored.mode, "PLAY");
    assert.deepEqual(restored.clocks, saved.clocks);
    assert.deepEqual(restored.facts, saved.facts);
    assert.equal(outcome.parse(await fixture.call("get_turn_context", {
      ...ref, source_ref: source.action.source_ref, request_id: source.target.request_id,
    })).status, "STALE_REVISION");
    assert.equal(outcome.parse(await fixture.call("prepare_turn", {
      version, target: { ...restored.head, request_id: source.target.request_id },
      action: { ...source.action, interpretation: { version, context_digest: source.compiler.context_digest,
        clauses: [clause(source.compiler.text, source.compiler.source_id, "old", source.compiler.text,
          [assignment(endpoint.field, "Old Name")])] } },
    })).status, "STALE_REVISION");
    assert.equal((await fixture.post("/fixture-restore", { id, digest })).status, 404);
    const history = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "history" } }));
    assert.deepEqual(history.receipts.map((item) => item.request_id), ["request:initial"]);
    const exactHistory = await fixture.call("inspect_session", { ...ref, query: { kind: "receipt",
      generation_id: playArgs.target.generation_id, request_id: playArgs.target.request_id } });
    assert.equal(z.object({ receipt_on_active_lineage: z.boolean() }).parse(exactHistory).receipt_on_active_lineage, false);
    assert.deepEqual(inspection.parse(exactHistory).receipts, [receipt.parse(historical).receipt]);
    assert.deepEqual(await fixture.call("commit_turn", { ...playArgs, ...playStage }), historical);
    z.object({ subtype: z.literal("IDEMPOTENCY_CONFLICT") }).parse(await fixture.call("restore_session", {
      ...args, save_id: "save:00000000-0000-4000-8000-000000000000",
    }));
    assert.equal(outcome.parse(await fixture.call("prepare_turn", {
      ...playArgs, target: { ...playArgs.target, request_id: "request:stale" },
    })).status, "STALE_REVISION");
    assert.equal(outcome.parse(await fixture.call("prepare_turn", {
      ...playArgs, target: { ...restored.head, request_id: "request:later" },
    })).status, "PREPARED");
    assert.equal(outcome.parse(await fixture.call("save_session", {
      version, target: { ...restored.head, request_id: "request:reader" },
    }, "reader")).status, "INSUFFICIENT_SCOPE");

    // Leases are available to the internal coordinator API. Test the old lease against a fresh
    // candidate at the same policy revision, then prove that the candidate accepts a current lease.
    assert.equal((await mode(restored.head, "/edit")).status, 200);
    const head = { owner_id: owner, ...restored.head };
    assert.equal(head.expected_policy_revision, later.head.expected_policy_revision);
    const request = edit("request:fresh-editor");
    const envelope = { ...request.envelope, ...head };
    const proposal = { ...request.proposal, ...head };
    const candidate = take(fixture.service.prepareTurn(head, envelope, proposal));
    assert.equal(candidate.kind, "prepared");
    const candidate_id = candidate.handle.candidate_id;
    const permit = { candidate_id, diff_digest: candidate.diff_digest, source: "lease" as const, reference: oldLease };
    const failed = await fixture.service.commitTurn(head, envelope, candidate_id, permit);
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.error.status, "NEEDS_APPROVAL");
    assert.equal((await read()).head.expected_revision, restored.head.expected_revision);
    const renewed = take(fixture.service.browser.issueLease(owner, head, [endpoint], 300_000, 1));
    const committed = take(await fixture.service.commitTurn(head, envelope, candidate_id, { ...permit, reference: renewed }));
    assert.equal(committed.receipt.status, "COMMITTED");
    const laterHistory = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "history" } }));
    assert.deepEqual(laterHistory.receipts.map(({ request_id }) => request_id), ["request:fresh-editor", "request:initial"]);
    assert.deepEqual(laterHistory.receipts[0], fixture.service.viewFixtureReceipt(committed));
    assert.deepEqual(history.receipts[0]?.event_ids, []);
    assert.ok(laterHistory.receipts[1]?.event_ids.length);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("native combined line and character saves restore exact state and continue the pinned VM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-combined-native-"));
  const path = join(directory, "fixture.sqlite");
  let loseResponse = false;
  let fixture = await harness(directory, true, (point) => {
    if (loseResponse && point === "after_commit") throw new Error("Lost native turn response.");
  }, "native-z5");
  try {
    const ref = await activateFixture(fixture);
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const reference = openStory(storyBytes());
    reference.start();
    send(reference, { kind: "line", text: "seed 42" });

    const lineHead = await read();
    const lineImage = publishedImage(path);
    const lineSave = await saveCombined(fixture, lineHead.head, "request:line-save");
    for (const text of ["save", "RESTORE", "undo", " restart ", "/reset"]) {
      const denied = z.object({ status: z.literal("CAPABILITY_MISSING"), message: z.string() }).parse(
        await fixture.call("prepare_turn", { version, target: { ...lineHead.head, request_id: "request:bypass" },
          action: { kind: "play", input: { kind: "line", text } } }));
      assert.match(denied.message, /combined session tools/u);
      assert.deepEqual(publishedImage(path), lineImage);
    }

    const menu = { kind: "line", text: "menu" } as const;
    const opened = await commitFixtureInput(fixture, lineHead.head, "request:menu", menu);
    assert.deepEqual(receipt.parse(opened.result).receipt.native_output, [send(reference, menu).delta]);
    await commitFixtureEdit(fixture, (await read()).head, "request:saved-lineage", "amendment",
      "Update the inscription protection.", { kind: "supersession", old_rule_id: "rule:inscription",
        replacement: protection("rule:inscription-v2", "presentation:inscription"), retained: [] });
    const characterHead = await read();
    assert.equal(characterHead.pending_input, "character");
    const characterImage = publishedImage(path);
    assert.deepEqual(characterImage.snapshot.history.map(({ id }) => id), ["rule:inscription"]);
    const charSave = await saveCombined(fixture, characterHead.head, "request:char-save");

    const choice = { kind: "character", value: "b" } as const;
    loseResponse = true;
    const first = await commitFixtureInput(fixture, characterHead.head, "request:choice", choice);
    assert.equal(outcome.parse(first.result).status, "ABORTED");
    const committed = publishedImage(path);
    const expectedChoice = send(reference, choice);
    await fixture.close();
    fixture = await harness(directory, true, undefined, "native-z5");
    const replay = receipt.parse(await fixture.call("commit_turn", first.commit)).receipt;
    assert.deepEqual(replay.native_output, [expectedChoice.delta]);
    assert.deepEqual(publishedImage(path), committed);
    assert.deepEqual(nativePayload.parse(committed.native).checkpoint, capture(reference));

    await commitFixtureEdit(fixture, (await read()).head, "request:rename", "assignment",
      "Rename the room to After Save.", assignment("presentation:label", "After Save"));
    await commitFixtureEdit(fixture, (await read()).head, "request:amend", "amendment",
      "Replace inscription protection with label protection.", { kind: "supersession", old_rule_id: "rule:inscription-v2",
        replacement: protection("rule:label", "presentation:label"), retained: [] });
    assert.deepEqual(publishedImage(path).snapshot.history.map(({ id }) => id), ["rule:inscription", "rule:inscription-v2"]);
    const edited = await read();
    assert.equal(edited.head.expected_policy_revision, characterHead.head.expected_policy_revision + 1);
    assert.ok(edited.facts.some(({ value }) => value === "After Save"));
    const pending = await commitFixtureEdit(fixture, edited.head, "request:staged-editor", "assignment",
      "Replace the inscription.", assignment("presentation:inscription", "Different inscription"), false);
    assert.equal((await fixture.post("/fixture-mode", { ...edited.head, request_id: "request:editor-mode", command: "/edit" })).status, 200);
    assert.equal((await read()).mode, "EDITOR");

    const checkRestored = (expectedImage: TurnImage) => {
      const actual = publishedImage(path);
      const { generation_id, revision, checkpoint_id, history_ref } = actual.checkpoint;
      assert.deepEqual(actual.checkpoint, { ...expectedImage.checkpoint, generation_id, revision, checkpoint_id, history_ref });
      assert.deepEqual(actual.snapshot, { ...expectedImage.snapshot, head: actual.snapshot.head });
      assert.deepEqual(actual.amendment, expectedImage.amendment);
      assert.deepEqual(actual.native, expectedImage.native);
      assert.deepEqual(fingerprint(restore(nativePayload.parse(actual.native).checkpoint, storyBytes())),
        fingerprint(restore(nativePayload.parse(expectedImage.native).checkpoint, storyBytes())));
    };

    const charArgs = { version, target: { ...edited.head, request_id: "request:restore-char" }, save_id: charSave };
    await reviewRestore(fixture, charArgs);
    const restored = await fixture.call("restore_session", charArgs);
    assert.equal(outcome.parse(restored).status, "RESTORED", JSON.stringify(restored));
    checkRestored(characterImage);
    assert.equal((await read()).mode, "PLAY");
    assert.deepEqual((await read()).restored_from, characterHead.head);
    assert.equal((await fixture.post("/approve", { candidate: pending.candidate_id, digest: pending.diff_digest })).status, 409);
    assert.equal(outcome.parse(await fixture.call("commit_turn", pending)).status, "STALE_REVISION");
    for (const value of ["s", "r", "u"]) {
      assert.equal(outcome.parse(await fixture.call("prepare_turn", { version,
        target: { ...(await read()).head, request_id: "request:menu-bypass" },
        action: { kind: "play", input: { kind: "character", value } } })).status, "NEEDS_CLARIFICATION");
      checkRestored(characterImage);
    }
    const resumed = await commitFixtureInput(fixture, (await read()).head, "request:choice", choice);
    assert.deepEqual(receipt.parse(resumed.result).receipt.native_output, [expectedChoice.delta]);
    assert.deepEqual(publishedImage(path).native, committed.native);
    const roll = { kind: "line", text: "roll" } as const;
    const rolled = await commitFixtureInput(fixture, (await read()).head, "request:roll", roll);
    assert.deepEqual(receipt.parse(rolled.result).receipt.native_output, [send(reference, roll).delta]);
    assert.deepEqual(nativePayload.parse(publishedImage(path).native).checkpoint, capture(reference));

    const lineArgs = { version, target: { ...(await read()).head, request_id: "request:restore-line" }, save_id: lineSave };
    await reviewRestore(fixture, lineArgs);
    assert.equal(outcome.parse(await fixture.call("restore_session", lineArgs)).status, "RESTORED");
    checkRestored(lineImage);
    const lineReference = restore(nativePayload.parse(lineImage.native).checkpoint, storyBytes());
    const rolledFromLine = await commitFixtureInput(fixture, (await read()).head, "request:roll", roll);
    assert.equal(outcome.parse(rolledFromLine.result).status, "COMMITTED", JSON.stringify(rolledFromLine.result));
    assert.deepEqual(receipt.parse(rolledFromLine.result).receipt.native_output, [send(lineReference, roll).delta]);
    assert.deepEqual(nativePayload.parse(publishedImage(path).native).checkpoint, capture(lineReference));
    await commitFixtureInput(fixture, (await read()).head, "request:menu", menu);
    const quit = await commitFixtureInput(fixture, (await read()).head, "request:quit-menu", { kind: "character", value: "q" });
    assert.match(receipt.parse(quit.result).receipt.native_output.join(""), /menu-choice=quit/u);
    assert.equal((await read()).pending_input, "line");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("restore approvals expire and a competing turn fences an approved stale restore", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-restore-race-"));
  let now = 1000;
  const fixture = await harness(directory, true, undefined, "synthetic", () => now);
  try {
    const ref = await activateFixture(fixture);
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const before = await read();
    const save_id = await saveCombined(fixture, before.head, "request:save");
    const args = { version, target: { ...before.head, request_id: "request:restore" }, save_id };
    const expired = await reviewRestore(fixture, args, false);
    now += 300_001;
    assert.equal((await fixture.post("/fixture-restore", expired)).status, 409);
    const fresh = await reviewRestore(fixture, args);
    assert.notEqual(fresh.id, expired.id);
    const command = await commitFixtureInput(fixture, before.head, "request:racing-turn", { kind: "line", text: "look" });
    assert.equal(outcome.parse(command.result).status, "COMMITTED");
    const after = await read();
    assert.equal((await fixture.post("/fixture-restore", fresh)).status, 409);
    assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "STALE_REVISION");
    assert.deepEqual(await read(), after);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("restore rejects malformed receipts on the displaced save ancestry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-receipt-restore-"));
  const path = join(directory, "fixture.sqlite");
  let damageAfterStaging: (() => void) | undefined;
  const fixture = await harness(directory, true, (point) => {
    if (point === "after_checkpoint") damageAfterStaging?.();
  });
  const db = new DatabaseSync(path);
  try {
    const ref = await activateFixture(fixture);
    const head = async () => context.parse(await fixture.call("get_turn_context", ref)).context.head;
    const history = () => fixture.call("inspect_session", { ...ref, query: { kind: "history" } });
    const earlier = await saveCombined(fixture, await head(), "request:earlier");
    const turn = await commitFixtureInput(fixture, await head(), "request:later-turn", { kind: "line", text: "look" });
    const originalReceipt = receipt.parse(turn.result).receipt;
    const checkpoint = publishedImage(path).checkpoint.checkpoint_id;
    const later = await saveCombined(fixture, await head(), "request:later");
    const back = { version, target: { ...await head(), request_id: "request:back" }, save_id: earlier };
    await reviewRestore(fixture, back);
    assert.equal(outcome.parse(await fixture.call("restore_session", back)).status, "RESTORED");
    const before = publishedImage(path);
    const activeHistory = inspection.parse(await history());
    const args = { version, target: { ...await head(), request_id: "request:forward" }, save_id: later };
    const original = z.object({ receipt: z.string() }).parse(
      db.prepare("SELECT receipt FROM requests WHERE checkpoint=?").get(checkpoint));
    const damage = () => {
      assert.equal(db.prepare("UPDATE requests SET receipt=json_remove(receipt,'$.receipt.status') WHERE checkpoint=?")
        .run(checkpoint).changes, 1);
    };
    const reset = () => db.prepare("UPDATE requests SET receipt=? WHERE checkpoint=?").run(original.receipt, checkpoint);
    const reject = async () => {
      assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), before);
      assert.deepEqual(inspection.parse(await history()), activeHistory);
    };
    damage();
    await reject();
    reset();
    await reviewRestore(fixture, args);
    damageAfterStaging = damage;
    await reject();
    damageAfterStaging = undefined;
    await reject();
    reset();
    const valid = { ...args, target: { ...args.target, request_id: "request:healthy" } };
    await reviewRestore(fixture, valid);
    assert.equal(outcome.parse(await fixture.call("restore_session", valid)).status, "RESTORED");
    assert.deepEqual(inspection.parse(await history()).receipts[0], originalReceipt);
  } finally {
    db.close();
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("invalid or incompatible saved data leaves the active combined head intact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-invalid-saves-"));
  const path = join(directory, "fixture.sqlite");
  const fixture = await harness(directory);
  try {
    const ref = await activateFixture(fixture);
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const before = await read();
    const source = publishedImage(path);
    const save_id = await saveCombined(fixture, before.head, "request:save");
    await commitFixtureInput(fixture, before.head, "request:advance", { kind: "line", text: "look" });
    const active = publishedImage(path);
    const args = { version, target: { ...(await read()).head, request_id: "request:restore" }, save_id };
    const impossible = z.object({ status: z.string() });
    const db = new DatabaseSync(path);
    try {
      const saved = z.object({ body: z.string() }).parse(db.prepare("SELECT body FROM saved_sessions WHERE id=?").get(save_id));
      const writeSource = (body: string, digest: string) => {
        db.prepare("UPDATE checkpoints SET body=?,digest=? WHERE id=?").run(body, digest, source.checkpoint.checkpoint_id);
        db.prepare("UPDATE saved_sessions SET body=json_set(?, '$.digest', ?) WHERE id=?").run(saved.body, digest, save_id);
      };
      for (const [field, value] of Object.entries({
        story_sha256: "e".repeat(64), runtime_build: "f".repeat(64), adapter_build: "f".repeat(64),
        checkpoint_format: "format:unsupported", version: "2.0.0", native_state: { ...source.checkpoint.native_state, pending_input: { kind: "halted" } },
        policy_ref: "blob:" + "0".repeat(64),
      })) {
        const changed = z.json().parse({ ...source, checkpoint: { ...source.checkpoint, [field]: value } });
        writeSource(canonicalJson(changed), canonicalDigest(changed));
        const result = impossible.parse(await fixture.call("restore_session", args));
        assert.equal(result.status, field === "native_state" ? "CAPABILITY_MISSING" : "VALIDATION_FAILED", field);
        assert.deepEqual(publishedImage(path), active);
      }
      for (const [name, raw] of [
        ["snapshot schema", { ...source, snapshot: { ...source.snapshot, version: "2.0.0" } }],
        ["policy schema", { ...source, snapshot: { ...source.snapshot, policy: { ...source.snapshot.policy, version: "2.0.0" } } }],
      ] as const) {
        const incompatible = z.json().parse(raw);
        writeSource(canonicalJson(incompatible), canonicalDigest(incompatible));
        assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED", name);
        assert.deepEqual(publishedImage(path), active);
      }
      // Invalid JSON exercises decoding. The null payload uses matching row and payload digests
      // so the synthetic executor has to reject it.
      writeSource("{", canonicalDigest(source));
      assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), active);
      const payload_sha256 = canonicalDigest(null);
      const missingNative = TurnImage.parse({ ...source, native: null, checkpoint: {
        ...source.checkpoint, native_state: { ...source.checkpoint.native_state, payload_sha256,
          payload_ref: "blob:" + payload_sha256 },
      } });
      writeSource(canonicalJson(missingNative), canonicalDigest(missingNative));
      assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), active);
      writeSource(canonicalJson(source), canonicalDigest(source));
      const event = db.prepare("SELECT id,request,body FROM events WHERE request IN (SELECT id FROM requests WHERE checkpoint=?)")
        .get(source.checkpoint.checkpoint_id);
      if (!event || typeof event.id !== "string" || typeof event.request !== "string" || typeof event.body !== "string") {
        assert.fail("Expected the saved fixture activation event.");
      }
      db.prepare("DELETE FROM events WHERE id=?").run(event.id);
      assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), active);
      db.prepare("INSERT INTO events VALUES(?,?,?)").run(event.id, event.request, event.body);
      const prepared = await reviewRestore(fixture, args);
      writeSource("{", canonicalDigest(source));
      assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), active);
      writeSource(canonicalJson(source), canonicalDigest(source));
      assert.equal((await fixture.post("/fixture-restore", prepared)).status, 200);
      assert.equal(impossible.parse(await fixture.call("restore_session", args)).status, "RESTORED");
    } finally { db.close(); }
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("native restore rejects incompatible saved images at validation and in the fresh worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-native-invalid-save-"));
  const path = join(directory, "fixture.sqlite");
  let fixture = await harness(directory, true, undefined, "native-z5");
  try {
    const ref = await activateFixture(fixture);
    const source = publishedImage(path);
    const savedHead = context.parse(await fixture.call("get_turn_context", ref)).context.head;
    const save_id = await saveCombined(fixture, savedHead, "request:native-save");
    const played = await commitFixtureInput(fixture, savedHead, "request:advance", { kind: "line", text: "look" });
    assert.equal(outcome.parse(played.result).status, "COMMITTED");
    const active = publishedImage(path);
    const head = context.parse(await fixture.call("get_turn_context", ref)).context.head;
    const args = { version, target: { ...head, request_id: "request:native-restore" }, save_id };
    const original = nativePayload.parse(source.native);
    const window = z.object({ text: z.string(), cursorX: z.number(), cursorY: z.number(), rock: z.number() });
    const envelope = z.object({
      integrity: z.object({ envelopeSha256: z.string() }).passthrough(),
      payload: z.object({ quetzalB64: z.string(), readData: z.object({}).passthrough(),
        windows: z.object({ status: window.nullable() }).passthrough() }).passthrough(),
    }).passthrough();
    const require = createRequire(import.meta.url);
    const codec = require("../../experiments/vm-checkpoint/lib/checkpoint-format.js") as {
      canonicalEnvelopeString: (value: unknown) => string;
      sha256Hex: (value: string) => string;
    };
    const checkpoint = (change: (image: z.infer<typeof envelope>) => void) => {
      const image = envelope.parse(original.checkpoint);
      change(image);
      image.integrity.envelopeSha256 = codec.sha256Hex(codec.canonicalEnvelopeString(image));
      return nativePayload.parse({ ...original, checkpoint: image });
    };
    const db = new DatabaseSync(path);
    try {
      const overwrite = (image: TurnImage) => {
        const digest = canonicalDigest(image);
        assert.equal(db.prepare("UPDATE checkpoints SET body=?,digest=? WHERE id=?")
          .run(canonicalJson(image), digest, source.checkpoint.checkpoint_id).changes, 1);
        assert.equal(db.prepare("UPDATE saved_sessions SET body=json_set(body, '$.digest', ?, '$.head', json(?)) WHERE id=?")
          .run(digest, canonicalJson(image.snapshot.head), save_id).changes, 1);
      };
      const overwriteNative = (native: typeof original) => {
        const payload_sha256 = canonicalDigest(native);
        overwrite(TurnImage.parse({ ...source, native, checkpoint: { ...source.checkpoint, native_state: {
          ...source.checkpoint.native_state, payload_sha256, payload_ref: "blob:" + payload_sha256,
        } } }));
      };
      for (const [name, invalid] of [
        ["opening mismatch", { ...original, opening: { ...original.opening, output: ["Different opening", original.opening.output[1] ?? ""] } }],
        ["truncated Quetzal", checkpoint((image) => { image.payload.quetzalB64 = image.payload.quetzalB64.slice(0, 8); })],
        ["unsupported timed continuation", checkpoint((image) => { image.payload.readData.time = 1; })],
      ] satisfies [string, typeof original][]) {
        overwriteNative(invalid);
        const rejected = z.object({ status: z.literal("VALIDATION_FAILED"), message: z.string() })
          .parse(await fixture.call("restore_session", args));
        assert.equal(rejected.message, "Invalid native fixture image.", name);
        assert.deepEqual(publishedImage(path), active);
      }
      const futureRevision = active.checkpoint.revision + 1;
      overwrite(TurnImage.parse({ ...source, checkpoint: { ...source.checkpoint, revision: futureRevision },
        snapshot: { ...source.snapshot, head: { ...source.snapshot.head, expected_revision: futureRevision } } }));
      assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "VALIDATION_FAILED");
      assert.deepEqual(publishedImage(path), active);

      // The envelope is valid in isolation, but its status-window presence differs from the fresh VM.
      overwriteNative(checkpoint((image) => {
        image.payload.windows.status = image.payload.windows.status ? null : { text: "", cursorX: 0, cursorY: 0, rock: 202 };
      }));
      await reviewRestore(fixture, args);
      const rejected = z.object({ status: z.literal("CAPABILITY_MISSING"), message: z.string() })
        .parse(await fixture.call("restore_session", args));
      assert.match(rejected.message, /pinned native checkpoint.*could not be verified/u);
      assert.deepEqual(publishedImage(path), active);
      assert.equal(db.prepare("SELECT count(*) AS staged FROM checkpoints WHERE published=0").get()?.staged, 0);
      overwrite(source);
    } finally { db.close(); }

    await fixture.close();
    fixture = await harness(directory);
    assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "CAPABILITY_MISSING");
    assert.deepEqual(publishedImage(path), active);
    await fixture.close();
    fixture = await harness(directory, true, undefined, "native-z5");
    await reviewRestore(fixture, args);
    assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "RESTORED");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("collection preserves live turn and restore claims while a nonzero overlay clock is restored", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-live-claim-"));
  const path = join(directory, "fixture.sqlite");
  let atStaged = () => {};
  const fixture = await harness(directory, true, (point) => {
    if (point === "after_checkpoint") atStaged();
  });
  try {
    const draft = await fixture.open(await fixture.launch());
    const item = "remix:key";
    const from = "remix:player";
    const to = "remix:floor";
    const db = new DatabaseSync(path);
    try {
      // Extend only this test's synthetic draft with the inventory needed for a real overlay turn.
      const row = z.object({ body: z.string() }).parse(db.prepare("SELECT body FROM fixture_drafts").get());
      const image = TurnImage.parse(JSON.parse(row.body));
      const room = image.snapshot.entities.find(({ id }) => id === "remix:room");
      const surface = room?.surfaces[0];
      assert.ok(room && surface);
      const inventory = (id: string, field: string, value: string | string[]) => ({
        ...room, id, surfaces: [{ ...surface, field, domain: "inventory" as const, direct_assignment: false,
          fact: { state: "present" as const, value, evidence_id: "evidence:inventory" } }],
      });
      image.snapshot.entities.push(inventory(item, "inventory:holder", from),
        inventory(from, "inventory:contents", [item]), inventory(to, "inventory:contents", []));
      image.checkpoint.remix_state_ref = "blob:" + canonicalDigest(image.snapshot.entities);
      assert.equal(db.prepare("UPDATE fixture_drafts SET body=?,digest=? WHERE checkpoint=?")
        .run(canonicalJson(image), canonicalDigest(image), image.checkpoint.checkpoint_id).changes, 1);
    } finally { db.close(); }

    const ref = await activateFixture(fixture, draft);
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const transfer = async (origin: string, destination: string, request_id: string) => {
      const head = { owner_id: owner, ...(await read()).head };
      const envelope = { ...head, version, request_id, intent: "play", input: { kind: "line", text: "move the key" } };
      const proposal = { ...head, version, request_id, mode: "PLAY", amendment: null,
        operations: [{ kind: "inventory.transfer", item, from: origin, to: destination }],
        declared_effects: [{ entity_id: item, field: "inventory:holder", change: "write" },
          ...[origin, destination].map((entity_id) => ({ entity_id, field: "inventory:contents", change: "write" }))] };
      const stage = take(fixture.service.prepareTurn(head, envelope, proposal));
      assert.equal(stage.kind, "prepared");
      const published = take(await fixture.service.commitTurn(head, envelope, stage.handle.candidate_id));
      assert.equal(published.receipt.time_cost, 1);
    };
    const observedClaims: string[] = [];
    atStaged = () => {
      const readDb = new DatabaseSync(path, { readOnly: true });
      try {
        const rows = readDb.prepare(`
          SELECT 'turn' AS kind FROM checkpoints c JOIN requests r USING(claim) WHERE c.published=0
          UNION ALL
          SELECT 'restore' AS kind FROM checkpoints c JOIN recovery_requests r USING(claim) WHERE c.published=0
        `).all();
        assert.equal(rows.length, 1);
        assert.equal(take(fixture.service.collectAbandoned()), 0);
        const kind = z.enum(["turn", "restore"]).parse(rows[0]?.kind);
        observedClaims.push(kind);
      } finally { readDb.close(); }
    };
    await transfer(from, to, "request:overlay-first");
    const saved = publishedImage(path);
    const save_id = await saveCombined(fixture, (await read()).head, "request:overlay-save");
    assert.equal(saved.checkpoint.clocks.overlay, 1);
    await transfer(to, from, "request:overlay-later");
    assert.equal(publishedImage(path).checkpoint.clocks.overlay, 2);
    const args = { version, target: { ...(await read()).head, request_id: "request:overlay-restore" }, save_id };
    await reviewRestore(fixture, args);
    assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "RESTORED");
    assert.deepEqual(observedClaims, ["turn", "turn", "restore"]);
    const recovered = publishedImage(path);
    assert.equal(recovered.snapshot.clock.overlay_turn, 1);
    assert.deepEqual(recovered.checkpoint.clocks, saved.checkpoint.clocks);
    assert.deepEqual(recovered.snapshot.entities, saved.snapshot.entities);
    assert.deepEqual(recovered.native, saved.native);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function killRestore(path: string, args: unknown, point: FaultPoint, profile: "synthetic" | "native-z5") {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./restore-crash-child.ts", import.meta.url)),
    path, point, profile, JSON.stringify(args)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const closed = once(child, "close");
  let diagnostics = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { diagnostics += chunk; });
  const lines = createInterface({ input: child.stdout });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let approval: string | undefined;
  let reached = false;
  try {
    for await (const line of lines) {
      const event = z.object({ approval: z.string().optional(), point: z.string().optional() }).parse(JSON.parse(line));
      if (event.approval) approval = event.approval;
      if (event.point === point) {
        reached = true;
        assert.ok(child.kill("SIGKILL"));
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    lines.close();
    if (!reached && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
  assert.ok(reached && approval, diagnostics);
  assert.ok(child.exitCode !== 0 || child.signalCode);
  return approval;
}

const restoreInterruptions = [
  ["synthetic", "before_checkpoint"], ["synthetic", "after_checkpoint"],
  ["synthetic", "before_commit"], ["synthetic", "after_commit"],
  ["native-z5", "before_checkpoint"], ["native-z5", "after_checkpoint"],
  ["native-z5", "before_commit"], ["native-z5", "after_commit"],
] as const;
for (const [profile, point] of restoreInterruptions) {
  void test(`combined restore process death at ${point} (${profile})`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "zirp-restore-kill-"));
    const path = join(directory, "fixture.sqlite");
    let fixture = await harness(directory, true, undefined, profile);
    try {
      const ref = await activateFixture(fixture);
      const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
      const saved = await read();
      const savedImage = publishedImage(path);
      const save_id = await saveCombined(fixture, saved.head, "request:save");
      const move = await commitFixtureInput(fixture, saved.head, "request:move",
        { kind: "line", text: profile === "native-z5" ? "take brass key" : "look" });
      const moveReceipt = receipt.parse(move.result).receipt;
      await commitFixtureEdit(fixture, (await read()).head, "request:change", "assignment",
        "Change the label to Current.", assignment("presentation:label", "Current"));
      await commitFixtureEdit(fixture, (await read()).head, "request:amend", "amendment", "Replace inscription protection with label protection.",
        { kind: "supersession", old_rule_id: "rule:inscription",
          replacement: protection("rule:label", "presentation:label"), retained: [] });
      const current = await read();
      const currentImage = publishedImage(path);
      const args = { version, target: { ...current.head, request_id: "request:rollback" }, save_id };
      await fixture.close();
      const oldApproval = await killRestore(path, args, point, profile);
      const afterCrash = publishedImage(path);
      if (point === "after_commit") {
        assert.deepEqual(afterCrash.native, savedImage.native);
        assert.deepEqual(afterCrash.snapshot.entities, savedImage.snapshot.entities);
        assert.deepEqual(afterCrash.snapshot.policy, savedImage.snapshot.policy);
        assert.deepEqual(afterCrash.checkpoint.clocks, savedImage.checkpoint.clocks);
      } else {
        assert.deepEqual(afterCrash, currentImage);
      }
      fixture = await harness(directory, true, undefined, profile);
      assert.equal(take(fixture.service.collectAbandoned()), point === "after_checkpoint" || point === "before_commit" ? 1 : 0);
      assert.equal(take(fixture.service.collectAbandoned()), 0);
      assert.equal((await fixture.get("/fixture-restore?id=" + encodeURIComponent(oldApproval))).status, 404);
      assert.deepEqual(receipt.parse(await fixture.call("commit_turn", move.commit)).receipt, moveReceipt);
      const retried = await fixture.call("restore_session", args);
      if (point === "after_commit") {
        assert.equal(outcome.parse(retried).status, "RESTORED");
        assert.deepEqual(await fixture.call("restore_session", args), retried);
        assert.deepEqual(publishedImage(path), afterCrash);
        assert.equal((await read()).mode, "PLAY");
      } else {
        assert.equal(outcome.parse(retried).status, "NEEDS_BROWSER_CONTROL");
        const fresh = await reviewRestore(fixture, args);
        assert.notEqual(fresh.id, oldApproval);
        assert.equal(outcome.parse(await fixture.call("restore_session", args)).status, "RESTORED");
      }
      const restored = publishedImage(path);
      assert.deepEqual(restored.native, savedImage.native);
      assert.deepEqual(restored.snapshot.entities, savedImage.snapshot.entities);
      assert.deepEqual(restored.snapshot.policy, savedImage.snapshot.policy);
      assert.deepEqual(restored.snapshot.history, savedImage.snapshot.history);
      assert.deepEqual(restored.checkpoint.clocks, savedImage.checkpoint.clocks);
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT COUNT(*) AS total FROM saved_sessions").get()?.total, 1);
        assert.equal(db.prepare("SELECT COUNT(*) AS total FROM checkpoints WHERE published=0").get()?.total, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS total FROM recovery_requests WHERE json_extract(result,'$.status')='RESTORED'")
          .get()?.total, 1);
      } finally { db.close(); }
    } finally {
      await fixture.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

void test("Streamable HTTP rejects unsupported methods and oversized requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-transport-"));
  const fixture = await harness(directory);
  const url = fixture.base + "/mcp";
  const headers = { authorization: "Bearer owner", "content-type": "application/json" };
  try {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(url, { method, headers });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST");
    }
    const withQuery = await fetch(url + "?probe=1", { method: "POST", headers: {
      ...headers, accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    const queryResponse = await withQuery.text();
    assert.equal(withQuery.status, 400, queryResponse);
    assert.deepEqual(JSON.parse(queryResponse), { error: "QUERY_NOT_SUPPORTED" });
    const body = Buffer.alloc(128 * 1024 + 1, 32);
    const oversized = await fetch(url, { method: "POST", headers, body });
    assert.equal(oversized.status, 413);
    const streamed = await new Promise<number | undefined>((resolve, reject) => {
      const streaming = request(url, { method: "POST", headers: { ...headers, "transfer-encoding": "chunked" } }, (response) => {
        response.resume();
        response.on("error", reject);
        response.on("end", () => resolve(response.statusCode));
      });
      streaming.on("error", reject);
      streaming.write(body);
      streaming.end();
    });
    assert.equal(streamed, 413);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("modern Streamable HTTP preserves routing headers for discovery and named tool calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-mcp-modern-"));
  const fixture = await harness(directory);
  const protocolVersion = "2026-07-28";
  function modern(method: string, params: Record<string, unknown> = {}, name?: string, headerMethod = method) {
    return fetch(fixture.base + "/mcp", { method: "POST", headers: {
      authorization: "Bearer owner", accept: "application/json, text/event-stream", "content-type": "application/json",
      "mcp-protocol-version": protocolVersion, "mcp-method": headerMethod, ...(name ? { "mcp-name": name } : {}),
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientInfo": { name: "loopback", version },
      "io.modelcontextprotocol/clientCapabilities": {},
    } } }) });
  }
  async function result(response: Response) {
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return z.object({ result: z.unknown() }).parse(JSON.parse(body)).result;
  }
  async function routingMismatch(response: Response) {
    const body = await response.text();
    assert.equal(response.status, 400, body);
    return z.object({ jsonrpc: z.literal("2.0"), error: z.object({ code: z.literal(-32020),
      data: z.object({ mismatch: z.object({ header: z.string(), body: z.string() }) }),
    }) }).parse(JSON.parse(body)).error.data.mismatch;
  }
  try {
    const discover = z.object({ supportedVersions: z.array(z.string()) }).parse(await result(await modern("server/discover")));
    assert.ok(discover.supportedVersions.includes(protocolVersion));
    const list = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(await result(await modern("tools/list")));
    assert.equal(list.tools.length, 8);
    const { head } = await fixture.open(await fixture.launch());
    const params = { name: "inspect_session", arguments: { version,
      session_id: head.session_id, branch_id: head.branch_id, query: { kind: "facts" } } };
    const wrongName = await routingMismatch(await modern("tools/call", params, "prepare_turn"));
    assert.equal(wrongName.header, "prepare_turn");
    assert.match(wrongName.body, /params\.name="inspect_session".*Mcp-Name/);
    const wrongMethod = await routingMismatch(await modern("tools/call", params, "inspect_session", "tools/list"));
    assert.equal(wrongMethod.header, "tools/list");
    assert.match(wrongMethod.body, /body names method tools\/call.*Mcp-Method/);
    const reply = z.object({ structuredContent: z.object({ version: z.literal(version), result: context }) });
    const readback = reply.parse(await result(await modern("tools/call", params, "inspect_session")));
    assert.equal(readback.structuredContent.result.context.state, "draft");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an assignment-only initial directive publishes the fixture without advancing policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-initial-assignment-"));
  const fixture = await harness(directory);
  try {
    const draft = await fixture.open(await fixture.launch());
    const label = "Lantern Room";
    const text = "Set the room label to Lantern Room.";
    const stored = await fixture.record(draft.head, "request:initial-assignment", "initial", text);
    const interpretation = { version, context_digest: stored.compiler.context_digest,
      clauses: [clause(text, stored.compiler.source_id, "label", text, [assignment("presentation:label", label)])] };
    const prepare = { version, target: stored.target, action: { ...stored.action, interpretation } };
    const inactive = z.object({ status: z.literal("INACTIVE"), proposal_digest: z.string() })
      .parse(await fixture.call("prepare_turn", prepare));
    const selected = await fixture.post("/fixture-subset", { source_ref: stored.action.source_ref,
      proposal_digest: inactive.proposal_digest, clause_ids: ["label"] });
    assert.equal(selected.status, 303, await selected.text());
    const stage = prepared.parse(await fixture.call("prepare_turn", prepare));
    const commit = { version, target: stored.target, action: stored.action, ...stage };
    assert.equal(outcome.parse(await fixture.call("commit_turn", commit)).status, "NEEDS_APPROVAL");
    await fixture.approve(stage);
    const published = receipt.parse(await fixture.call("commit_turn", commit)).receipt;
    assert.equal(published.revision, 1);
    assert.equal(published.policy_revision, 0);
    assert.equal(published.time_cost, 0);
    assert.deepEqual(receipt.parse(await fixture.call("commit_turn", commit)).receipt, published);
    const { session_id, branch_id } = draft.head;
    const active = context.parse(await fixture.call("get_turn_context", { version, session_id, branch_id })).context;
    assert.equal(active.state, "active");
    assert.equal(active.head.expected_policy_revision, 0);
    assert.ok(active.facts.some(({ field, value }) => field === "presentation:label" && value === label));
    assert.deepEqual(active.rules, []);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("native Z5 through MCP matches uninterrupted authored play, discards candidates and inspects without input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-native-"));
  const database = join(directory, "fixture.sqlite");
  let discard = false;
  let fixture = await harness(directory, true, (point) => {
    if (discard && point === "after_checkpoint") throw new Error("Discard the speculative native checkpoint.");
  }, "native-z5");
  try {
    assert.match(await (await fixture.get("/session")).text(), /SEED 42.*advances native time/u);
    const consent = await fixture.post("/fixture-launch", {});
    assert.equal(consent.status, 200);
    const consentPage = await consent.text();
    assert.match(consentPage, /launch handle into your local MCP client/u);
    const launch = /launch:[0-9a-f-]{36}/u.exec(consentPage)?.[0];
    assert.ok(launch);
    const [draft, duplicate] = await Promise.all([fixture.open(launch), fixture.open(launch)]);
    assert.deepEqual(draft, duplicate);
    assert.equal(draft.story_sha256, nativeStory);
    assert.equal(draft.state, "draft");
    assert.equal(draft.native?.projection, null);
    const reference = openStory(storyBytes());
    const opening = reference.start();
    assert.throws(() => capture(reference), { code: "E_RNG" });
    const setup = send(reference, { kind: "line", text: "seed 42" });
    assert.deepEqual(draft.native?.opening, {
      command: "SEED 42", output: [opening.delta, setup.delta], time_cost: 1, startup_counter: 7,
    });
    const initialCheckpoint = capture(reference);
    const { session_id, branch_id } = draft.head;
    const ref = { version, session_id, branch_id };
    const read = async () => context.parse(await fixture.call("get_turn_context", ref)).context;
    const published = () => {
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        const row = z.object({ body: z.string() }).parse(db.prepare(
          "SELECT body FROM checkpoints JOIN heads ON checkpoints.id = heads.checkpoint",
        ).get());
        return TurnImage.parse(JSON.parse(row.body));
      } finally { db.close(); }
    };

    const rewrite = "Prevent the opening side effect.";
    const attempted = await fixture.record(draft.head, "request:opening", "initial", rewrite);
    const interpretation = { version, context_digest: attempted.compiler.context_digest, clauses: [
      clause(rewrite, attempted.compiler.source_id, "opening", rewrite,
        [{ kind: "assignment", entity_id: "native:fixture", field: "progression:startup", value: 0 }]),
    ] };
    assert.equal(outcome.parse(await fixture.call("prepare_turn", {
      version, target: attempted.target, action: { ...attempted.action, interpretation },
    })).status, "CAPABILITY_MISSING");
    assert.equal(outcome.parse(await fixture.call("get_turn_context", {
      ...ref, request_id: attempted.target.request_id,
    })).status, "NEEDS_APPROVAL");
    assert.deepEqual(await read(), draft);

    const initial = await initialDraft(fixture, draft);
    const selected = await fixture.post("/fixture-subset", { source_ref: initial.action.source_ref,
      proposal_digest: initial.inactive.proposal_digest, clause_ids: ["label", "protect"] });
    assert.equal(selected.status, 303, await selected.text());
    const stage = prepared.parse(await fixture.call("prepare_turn", initial.prepare));
    await fixture.approve(stage);
    const publishedInitial = receipt.parse(await fixture.call("commit_turn", {
      version, target: initial.target, action: initial.action, ...stage,
    })).receipt;
    assert.equal(publishedInitial.time_cost, 0);
    assert.deepEqual(nativePayload.parse(published().native).checkpoint, initialCheckpoint);
    assert.equal((await read()).native?.projection?.room.name, "Probe Chamber");

    const activeBefore = published();
    const activeEdit = "Move the brass key to my inventory.";
    const recordedEdit = await fixture.record((await read()).head, "request:native-assignment", "assignment", activeEdit);
    const activeInterpretation = { version, context_digest: recordedEdit.compiler.context_digest, clauses: [
      clause(activeEdit, recordedEdit.compiler.source_id, "move-key", activeEdit,
        [{ kind: "assignment", entity_id: "native:object-30", field: "inventory:holder", value: "native:object-21" }]),
    ] };
    const rejectedEdit = z.object({ status: z.literal("CAPABILITY_MISSING"), message: z.string() }).parse(
      await fixture.call("prepare_turn", { version, target: recordedEdit.target,
        action: { ...recordedEdit.action, interpretation: activeInterpretation } }));
    assert.match(rejectedEdit.message, /no native editing capability/u);
    assert.equal(outcome.parse(await fixture.call("get_turn_context", {
      ...ref, request_id: recordedEdit.target.request_id,
    })).status, "NEEDS_APPROVAL");
    assert.deepEqual(published(), activeBefore);

    let request = 0;
    type Input = { kind: "line"; text: string } | { kind: "character"; value: string };
    const line = (text: string): Input => ({ kind: "line", text });
    const argumentsFor = async (input: Input) => ({
      version, target: { ...(await read()).head, request_id: "request:z5-" + ++request },
      action: { kind: "play", input },
    });
    const attempt = async (input: Input, expected: "success" | "failure", ticks: number, referenceInput = input) => {
      const before = published();
      const args = await argumentsFor(input);
      const preparation = await fixture.call("prepare_turn", args);
      assert.equal(outcome.parse(preparation).status, "PREPARED", JSON.stringify({ input, preparation }));
      const stage = prepared.parse(preparation);
      assert.deepEqual(published(), before);
      const step = send(reference, referenceInput);
      assert.deepEqual(step.errors, []);
      const result = await fixture.call("commit_turn", { ...args, ...stage });
      assert.equal(outcome.parse(result).status, "COMMITTED", JSON.stringify({ input, result }));
      const committed = receipt.parse(result).receipt;
      assert.deepEqual(committed.native_output, [step.delta]);
      assert.equal(committed.in_fiction_result, expected);
      assert.equal(committed.time_cost, ticks);
      const image = published();
      assert.deepEqual(nativePayload.parse(image.native).checkpoint, capture(reference));
      assert.equal(image.checkpoint.clocks.native, before.checkpoint.clocks.native + ticks);
      assert.equal(image.checkpoint.clocks.overlay, 0);
      assert.deepEqual(receipt.parse(await fixture.call("commit_turn", { ...args, ...stage })).receipt, committed);
      assert.deepEqual(published(), image);
      return committed;
    };

    const baseline = published();
    for (const name of ["get_turn_context", "inspect_session", "inspect_session"]) {
      const body = name === "get_turn_context" ? ref : { ...ref, query: { kind: "facts" } };
      const projection = context.parse(await fixture.call(name, body)).context.native?.projection;
      assert.deepEqual(projection?.inventory, []);
      assert.ok(!projection?.visible.some(({ name }) => name === "windowsill"));
      assert.deepEqual(published(), baseline);
    }

    const remaining = ["take stone panel", "north"];
    const attemptedLines = [];
    for (const command of remaining) {
      attemptedLines.push(command);
      const result = await attempt(line(command), "failure", 1);
      if (result.in_fiction_result === "failure") break;
    }
    assert.deepEqual(attemptedLines, ["take stone panel"]);
    assert.equal((await read()).native?.projection?.room.name, "Probe Chamber");
    const key = await attempt(line("take brass key"), "success", 1);
    assert.match(key.native_output.join(""), /\[F06:event=chime\]/u);
    assert.equal(key.event_ids.length, 1);
    assert.equal((await read()).native?.projection?.inventory[0]?.name, "brass key");
    await attempt(line("drop brass key"), "success", 1);
    assert.deepEqual((await read()).native?.projection?.inventory, []);
    await attempt(line("inventory"), "success", 1);
    await attempt(line("take brass key"), "success", 1);
    await attempt(line("look"), "success", 1);
    await attempt(line("inventory"), "success", 1);
    await attempt(line("north"), "success", 1);
    const gallery = published();
    assert.equal(outcome.parse(await fixture.call("prepare_turn", await argumentsFor(line("examine brass token")))).status,
      "NEEDS_CLARIFICATION");
    for (const command of ["save", "restore", "undo", "restart", "north then south"]) {
      assert.equal(outcome.parse(await fixture.call("prepare_turn", await argumentsFor(line(command)))).status,
        "CAPABILITY_MISSING");
    }
    assert.deepEqual(published(), gallery);
    const tokens = (await read()).native?.projection?.visible.filter(({ name }) => name === "brass token");
    assert.deepEqual(tokens?.map(({ id, qualifier }) => [id, qualifier]), [
      ["native:object-32", "red token"], ["native:object-33", "blue token"],
    ]);
    await attempt(line("examine native:object-32"), "success", 1, line("examine red token"));
    await attempt(line("examine native:object-33"), "success", 1, line("examine blue token"));

    const stable = published();
    const speculative = await argumentsFor(line("roll"));
    const stagedRoll = prepared.parse(await fixture.call("prepare_turn", speculative));
    discard = true;
    assert.equal(outcome.parse(await fixture.call("commit_turn", { ...speculative, ...stagedRoll })).status, "ABORTED");
    discard = false;
    assert.deepEqual(published(), stable);
    assert.equal(checkpointView(nativePayload.parse(stable.native).checkpoint).seed,
      checkpointView(capture(reference)).seed);
    await attempt(line("roll"), "success", 1);
    await attempt(line("menu"), "success", 0);
    const menu = published();
    assert.equal((await read()).pending_input, "character");
    assert.equal(outcome.parse(await fixture.call("prepare_turn", await argumentsFor(line("b")))).status, "CAPABILITY_MISSING");
    assert.deepEqual(published(), menu);
    await fixture.close();
    fixture = await harness(directory, true, undefined, "native-z5");
    assert.equal((await read()).pending_input, "character");
    await attempt({ kind: "character", value: "b" }, "success", 1);
    assert.equal((await read()).pending_input, "line");
    await attempt(line("north"), "failure", 1);
    await attempt(line("unlock vault door with brass key"), "success", 1);
    await attempt(line("drop brass key"), "success", 1);
    assert.deepEqual((await read()).native?.projection?.inventory, []);
    const implicitTake = await attempt(line("unlock vault door with brass key"), "failure", 1);
    assert.match(implicitTake.native_output.join(""), /first taking the brass key.*vault door is unlocked/su);
    assert.equal((await read()).native?.projection?.inventory[0]?.id, "native:object-30");
    await attempt(line("open vault door"), "success", 1);
    await attempt(line("north"), "success", 1);
    assert.equal((await read()).native?.projection?.room.name, "Records Vault");
    await attempt(line("south"), "success", 1);
    assert.equal((await read()).native?.projection?.room.name, "Records Vault");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("all eight MCP tools use scoped loopback access, exact browser approval and durable replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-mcp-"));
  let fault: FaultPoint | undefined;
  let fixture = await harness(directory, true, (point) => { if (point === fault) throw new Error("Injected interruption"); });
  try {
    const { base, call, post, get } = fixture;
    const unauthenticated = await fetch(base + "/mcp", { method: "POST" });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /resource_metadata/u);
    const metadata = await fetch(base + "/.well-known/oauth-protected-resource");
    assert.deepEqual(await metadata.json(), { resource: "https://fixture.test/resource",
      authorization_servers: ["https://idp.test/"], scopes_supported: Object.values(scopes) });
    z.object({ capabilities: z.object({ tools: z.object({}) }) }).parse(
      await fixture.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "loopback", version } }));
    const schema = z.object({ type: z.literal("object"), additionalProperties: z.literal(false) });
    const tool = z.object({ name: z.string(), inputSchema: schema, outputSchema: schema,
      annotations: z.object({ readOnlyHint: z.boolean() }), securitySchemes: z.array(z.object({ scopes: z.array(z.string()) })) });
    const listed = z.object({ tools: z.array(tool) }).parse(await fixture.rpc("tools/list", {})).tools;
    assert.deepEqual(listed.map(({ name }) => name), ["open_story_session", "get_turn_context", "set_input_mode",
      "prepare_turn", "commit_turn", "inspect_session", "save_session", "restore_session"]);
    assert.deepEqual(listed.filter((item) => !item.annotations.readOnlyHint).map(({ name }) => name),
      ["open_story_session", "prepare_turn", "commit_turn", "save_session", "restore_session"]);
    assert.deepEqual(listed.map((item) => item.securitySchemes[0]?.scopes[0]),
      [scopes.launch, scopes.read, scopes.read, scopes.stage, scopes.commit, scopes.read, scopes.commit, scopes.commit]);
    const consentPage = await get("/session");
    assert.equal(consentPage.status, 200);
    assert.equal(consentPage.headers.get("referrer-policy"), "same-origin");
    assert.equal((await post("/fixture-launch", {}, "owner", "null")).status, 403);
    assert.equal((await post("/fixture-launch", {}, "owner", "https://foreign.test")).status, 403);
    assert.equal((await post("/fixture-launch", { csrf: "incorrect" })).status, 403);
    const launch = await fixture.launch();
    for (const [token, expected] of [["reader", "INSUFFICIENT_SCOPE"], ["other", "VALIDATION_FAILED"]]) {
      assert.equal(outcome.parse(await call("open_story_session", { version, launch_handle: launch }, token)).status, expected);
    }
    const [draft, duplicate] = await Promise.all([fixture.open(launch), fixture.open(launch)]);
    assert.deepEqual(draft, duplicate);
    assert.equal(draft.state, "draft");
    assert.equal(draft.clocks, null);
    assert.deepEqual(draft.facts, []);
    const { session_id, branch_id } = draft.head;
    const ref = { version, session_id, branch_id };
    assert.equal(outcome.parse(await call("get_turn_context", ref, "other")).status, "VALIDATION_FAILED");
    const draftTarget = { ...draft.head, request_id: "request:draft-save" };
    assert.equal(outcome.parse(await call("save_session", { version, target: draftTarget })).status, "NEEDS_APPROVAL");
    assert.equal(outcome.parse(await call("restore_session", { version, target: draftTarget,
      save_id: "save:00000000-0000-4000-8000-000000000000" })).status, "NEEDS_APPROVAL");
    const attempt = { version, target: { ...draft.head, request_id: "request:play-draft" },
      action: { kind: "play", input: { kind: "line", text: "open" } } };
    assert.equal(outcome.parse(await call("prepare_turn", attempt)).status, "NEEDS_APPROVAL");
    const control = z.object({ control_url: z.url(), current_mode: z.literal("PLAY") }).parse(
      await call("set_input_mode", { ...ref, request_id: "request:initial", mode: "EDITOR" }));
    const controlUrl = new URL(control.control_url);
    assert.match(await (await get(controlUrl.pathname + controlUrl.search)).text(), /Exact directive/u);
    assert.equal(context.parse(await call("get_turn_context", ref)).context.mode, "PLAY");

    const initial = await initialDraft(fixture, draft);
    const forged = await fixture.rpc("tools/call", { name: "prepare_turn", arguments: { ...initial.prepare,
      action: { ...initial.prepare.action, provenance: "caller_recorded", approved: true } } });
    z.object({ isError: z.literal(true) }).parse(forged);
    const sibling = await fixture.open(await fixture.launch());
    const siblingRef = { ...ref, session_id: sibling.head.session_id, source_ref: initial.action.source_ref };
    assert.equal(outcome.parse(await call("get_turn_context", siblingRef)).status, "VALIDATION_FAILED");
    const selection = { source_ref: initial.action.source_ref, proposal_digest: initial.inactive.proposal_digest };
    assert.equal((await post("/fixture-subset", { ...selection, proposal_digest: "0".repeat(64), clause_ids: ["label"] })).status, 404);
    assert.equal((await post("/fixture-subset", { ...selection, clause_ids: ["label", "memory"] })).status, 409);
    const selected = await post("/fixture-subset", { ...selection, clause_ids: ["label", "protect"] });
    assert.equal(selected.status, 303, await selected.text());
    const stage = prepared.parse(await call("prepare_turn", initial.prepare));
    const candidatePath = "/candidate?id=" + stage.candidate_id;
    assert.equal(selected.headers.get("location"), "/candidate?id=" + encodeURIComponent(stage.candidate_id));
    const approvalPage = await get(candidatePath);
    assert.equal(approvalPage.headers.get("referrer-policy"), "same-origin");
    const preview = await approvalPage.text();
    assert.match(preview, /Lantern Room/u);
    assert.match(preview, /field\.unchanged/u);
    assert.equal((await get(candidatePath, "other")).status, 404);
    const firstCommit = { version, target: initial.target, action: initial.action, ...stage };
    assert.equal(outcome.parse(await call("commit_turn", firstCommit)).status, "NEEDS_APPROVAL");
    assert.equal((await post("/approve", { candidate: stage.candidate_id, digest: "0".repeat(64) })).status, 409);
    await fixture.approve(stage);
    fault = "before_commit";
    assert.equal(outcome.parse(await call("commit_turn", firstCommit)).status, "ABORTED");
    assert.equal(context.parse(await call("get_turn_context", ref)).context.state, "draft");
    const history = { ...ref, query: { kind: "history" } };
    assert.equal(inspection.parse(await call("inspect_session", history)).receipts.length, 0);
    fault = "after_commit";
    assert.equal(outcome.parse(await call("commit_turn", firstCommit)).status, "ABORTED");
    fault = undefined;
    const firstReceipt = receipt.parse(await call("commit_turn", firstCommit)).receipt;
    assert.equal(firstReceipt.time_cost, 0);
    assert.equal(firstReceipt.policy_revision, 1);
    const active = context.parse(await call("get_turn_context", ref)).context;
    assert.equal(active.state, "active");
    assert.equal(active.mode, "PLAY");
    assert.ok(active.facts.some(({ value }) => value === "Lantern Room"));
    assert.ok(active.rules.some(({ id }) => id === "rule:inscription"));
    assert.deepEqual(active.clocks, { native: 0, overlay: 0 });
    assert.equal(outcome.parse(await call("commit_turn", firstCommit, "other")).status, "VALIDATION_FAILED");

    async function edit(view: Context, id: string, purpose: string, text: string, entries: unknown[]) {
      const stored = await fixture.record(view.head, id, purpose, text);
      const interpretation = { version, context_digest: stored.compiler.context_digest,
        clauses: [clause(text, stored.compiler.source_id, "edit", text, entries)] };
      const result = await call("prepare_turn", { version, target: stored.target, action: { ...stored.action, interpretation } });
      return { result, interpretation, request: { version, target: stored.target, action: stored.action } };
    }
    const label = await edit(active, "request:assignment", "assignment", "Rename the room Lamplit Room.",
      [assignment("presentation:label", "Lamplit Room")]);
    assert.equal(outcome.parse(label.result).status, "PREPARED", JSON.stringify(label.result));
    const labelStage = prepared.parse(label.result);
    await fixture.approve(labelStage);
    const labelRequest = { ...label.request, ...labelStage };
    const [labelReceipt, duplicateReceipt] = await Promise.all([call("commit_turn", labelRequest), call("commit_turn", labelRequest)]);
    assert.deepEqual(labelReceipt, duplicateReceipt);
    const publicEdit = receipt.parse(labelReceipt).receipt;
    assert.equal(publicEdit.policy_revision, 1);
    assert.deepEqual(publicEdit.event_ids, []);
    assert.deepEqual(publicEdit.narration_facts, []);
    assert.deepEqual(firstReceipt.rule_ids, []);
    assert.deepEqual(await call("prepare_turn", { ...label.request, action: {
      ...label.request.action, interpretation: label.interpretation,
    } }), labelReceipt);
    const edited = context.parse(await call("get_turn_context", ref)).context;
    assert.equal(edited.mode, "PLAY");
    assert.deepEqual(edited.clocks, active.clocks);

    const play = { ...attempt, target: { ...edited.head, request_id: "request:play" } };
    const playStage = prepared.parse(await call("prepare_turn", play));
    const playedReceipt = receipt.parse(await call("commit_turn", { ...play, ...playStage })).receipt;
    assert.equal(playedReceipt.in_fiction_result, "failure");
    assert.equal(playedReceipt.time_cost, 1);
    assert.equal(playedReceipt.native_output[0], "The door stays shut.\r\n");
    const played = context.parse(await call("get_turn_context", ref)).context;
    assert.ok(played.facts.some(({ value }) => value.includes("/edit") && value.includes("export")));
    const mixed = { version, target: { ...played.head, request_id: "request:mixed" }, action: { kind: "mixed" } };
    assert.equal(outcome.parse(await call("prepare_turn", mixed)).status, "NEEDS_CLARIFICATION");
    const blocked = await edit(played, "request:blocked", "assignment", "Change the inscription.",
      [assignment("presentation:inscription", "Different")]);
    assert.equal(outcome.parse(blocked.result).status, "POLICY_CONFLICT");
    assert.deepEqual(context.parse(await call("get_turn_context", ref)).context, played);

    const amendment = await edit(played, "request:amendment", "amendment", "Replace inscription protection with label protection.",
      [{ kind: "supersession", old_rule_id: "rule:inscription", replacement: protection("rule:label", "presentation:label"), retained: [] }]);
    const amendmentStage = prepared.parse(amendment.result);
    await fixture.approve(amendmentStage);
    const amended = receipt.parse(await call("commit_turn", { ...amendment.request, ...amendmentStage })).receipt;
    assert.equal(amended.time_cost, 0);
    assert.equal(amended.policy_revision, 2);
    const before = inspection.parse(await call("inspect_session", history));
    assert.equal(before.receipts.length, 4);
    assert.deepEqual(before.context.clocks, { native: 1, overlay: 0 });
    assert.deepEqual(await call("commit_turn", labelRequest), labelReceipt);
    assert.equal(outcome.parse(await call("commit_turn", { ...labelRequest, diff_digest: "0".repeat(64) })).status, "VALIDATION_FAILED");
    const changed = await call("commit_turn", { ...labelRequest, action: { ...labelRequest.action, source_ref: initial.action.source_ref } });
    z.object({ subtype: z.literal("IDEMPOTENCY_CONFLICT") }).parse(changed);
    const wrongSession = { ...labelRequest, target: { ...labelRequest.target, session_id: sibling.head.session_id } };
    assert.equal(outcome.parse(await call("commit_turn", wrongSession)).status, "VALIDATION_FAILED");
    const exactQuery = { kind: "receipt", generation_id: labelRequest.target.generation_id, request_id: labelRequest.target.request_id };
    assert.deepEqual(inspection.parse(await call("inspect_session", { ...ref, query: exactQuery })).receipts, [receipt.parse(labelReceipt).receipt]);
    const unsupportedExit = "A new exit opens to the north.";
    assert.equal(playedReceipt.narration_facts.includes(unsupportedExit), false);
    assert.equal(played.facts.some(({ value }) => value.includes(unsupportedExit)), false);
    assert.deepEqual(inspection.parse(await call("inspect_session", history)), before);
    const policyOnly = await initialDraft(fixture, sibling);
    const subset = await post("/fixture-subset", { source_ref: policyOnly.action.source_ref,
      proposal_digest: policyOnly.inactive.proposal_digest, clause_ids: ["protect"] });
    assert.equal(subset.status, 303);
    const policyStage = prepared.parse(await call("prepare_turn", policyOnly.prepare));
    await fixture.approve(policyStage);
    assert.equal(receipt.parse(await call("commit_turn", { version, target: policyOnly.target, action: policyOnly.action,
      ...policyStage })).receipt.time_cost, 0);
    const policyOnlyHead = context.parse(await call("get_turn_context", { version,
      session_id: sibling.head.session_id, branch_id: sibling.head.branch_id })).context;
    assert.ok(policyOnlyHead.rules.some(({ id }) => id === "rule:inscription"));
    assert.ok(policyOnlyHead.facts.some(({ value }) => value === "Fixture Room"));
    assert.deepEqual(inspection.parse(await call("inspect_session", history)), before);
    await fixture.close();
    fixture = await harness(directory, false);
    assert.deepEqual(await fixture.call("commit_turn", labelRequest), labelReceipt);
    assert.deepEqual(inspection.parse(await fixture.call("inspect_session", history)), before);
    assert.equal(outcome.parse(await fixture.call("set_input_mode", { ...ref, request_id: "request:next", mode: "EDITOR" })).status, "NEEDS_APPROVAL");
    assert.equal((await fixture.open(launch)).head.session_id, session_id);
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("v2 fixture upgrade preserves active lineage and accepts a new combined save", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-migrate-v2-"));
  const path = join(directory, "fixture.sqlite");
  let fixture = await harness(directory);
  try {
    const ref = await activateFixture(fixture);
    const before = context.parse(await fixture.call("get_turn_context", ref)).context;
    const move = await commitFixtureInput(fixture, before.head, "request:move", { kind: "line", text: "look" });
    assert.equal(outcome.parse(move.result).status, "COMMITTED");
    const head = publishedImage(path);
    await fixture.close();
    const old = new DatabaseSync(path);
    try {
      old.exec("DROP TABLE checkpoint_links; DROP TABLE recovery_requests; DROP TABLE saved_sessions; " +
        "DROP INDEX turn_request_checkpoint; PRAGMA user_version=2");
    } finally { old.close(); }
    fixture = await harness(directory);
    assert.deepEqual(publishedImage(path), head);
    assert.deepEqual(await fixture.call("commit_turn", move.commit), move.result);
    const history = inspection.parse(await fixture.call("inspect_session", { ...ref, query: { kind: "history" } }));
    assert.deepEqual(history.receipts.map((item) => item.request_id), ["request:move", "request:initial"]);
    await saveCombined(fixture, history.context.head, "request:save-migrated");
  } finally {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("v1 store upgrade preserves the prior head and stored receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-migrate-"));
  const path = join(directory, "legacy.sqlite");
  try {
    const input = play();
    const original = new TurnService(path, makeFixture());
    take(original.initialize(input.state));
    const stage = take(original.prepareTurn(input.access, input.envelope, input.proposal));
    assert.equal(stage.kind, "prepared");
    const committed = take(await original.commitTurn(input.access, input.envelope, stage.handle.candidate_id));
    original.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE fixture_records; DROP TABLE fixture_drafts; DROP TABLE checkpoint_links; " +
      "DROP TABLE recovery_requests; DROP TABLE saved_sessions; DROP INDEX turn_request_checkpoint; " +
      "ALTER TABLE requests DROP COLUMN committed_candidate; ALTER TABLE requests DROP COLUMN committed_digest; PRAGMA user_version=1");
    legacy.close();
    const migrated = new TurnService(path, makeFixture());
    try {
      assert.deepEqual(take(await migrated.commitTurn(input.access, input.envelope, stage.handle.candidate_id)), committed);
      assert.ok(take(migrated.issueFixtureLaunch(owner)).startsWith("launch:"));
      const observed = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(observed.prepare("PRAGMA user_version").get()?.user_version, 4);
        assert.deepEqual(observed.prepare("SELECT parent FROM checkpoint_links WHERE id=?")
          .get(committed.receipt.post_checkpoint)?.parent, committed.receipt.pre_checkpoint);
        assert.equal(observed.prepare("SELECT COUNT(*) AS total FROM heads").get()?.total, 1);
      } finally { observed.close(); }
    } finally { migrated.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const profile of ["fixture-line", "fixture-character", "heidi"] as const) {
  void test("private portable " + profile + " round trip transfers committed state and denies stale access", async (t) => {
    const sourceDir = mkdtempSync(join(tmpdir(), "zirp-transfer-source-"));
    const targetDir = mkdtempSync(join(tmpdir(), "zirp-transfer-target-"));
    let now = Date.now();
    let source = await harness(sourceDir, true, undefined, "native-z5", () => now, true);
    let interrupt = false;
    const startTarget = (heidiTrial = true) => harness(targetDir, true, (point) => {
      if (interrupt && point === "before_commit") throw new Error("Interrupt portable publication.");
    }, "native-z5", () => now, true, heidiTrial);
    let target = await startTarget();
    t.after(async () => {
      await source.close();
      await target.close();
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    });
    const heidi = profile === "heidi";
    const character = profile === "fixture-character";
    const story = heidi ? readFileSync(new URL("../../tests/fixtures/zmachine/heidi/Heidi.z5", import.meta.url)) : storyBytes();
    const stage = async (fixture: Awaited<ReturnType<typeof harness>>, browser = "owner", purpose = "open", storyBytes = story) => {
      const delivered = await fixture.upload("/private-story", storyBytes, browser, { "x-upload-purpose": purpose });
      assert.equal(delivered.status, 200, await delivered.clone().text());
      return z.object({ ok: z.literal(true), value: z.string() }).parse(await delivered.json()).value;
    };
    assert.match(await (await source.get("/private-story")).text(), /I consent/u);
    const noStoryConsent = await source.upload("/private-story", story, "owner", {
      "x-upload-purpose": "open", "x-upload-consent": "no",
    });
    assert.equal(noStoryConsent.status, 400);
    assert.deepEqual(await noStoryConsent.json(), { error: "CONSENT_REQUIRED" });
    assert.equal((await source.upload("/private-story", story, "owner", { "x-upload-purpose": "open", "x-csrf-token": "wrong" })).status, 403);
    assert.equal((await source.upload("/private-story", Buffer.alloc(256 * 1024 + 1), "owner", { "x-upload-purpose": "open" })).status, 413);
    const wrongVersion = Buffer.from(story);
    wrongVersion[0] = 3;
    assert.equal((await source.upload("/private-story", wrongVersion, "owner", { "x-upload-purpose": "open" })).status, 404);
    const modified = Buffer.from(story);
    modified[100] = (modified[100] ?? 0) ^ 1;
    assert.equal((await source.upload("/private-story", modified, "owner", { "x-upload-purpose": "open" })).status, 404);
    const catalog = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(await source.rpc("tools/list", {}));
    assert.ok(catalog.tools.every(({ name }) => !/upload|export|fetch|delete|publish/u.test(name)));
    const handle = await stage(source);
    const args = { version, launch_handle: handle };
    assert.equal(outcome.parse(await source.call("open_story_session", args, "other")).status, "VALIDATION_FAILED");
    if (!heidi && !character) {
      const rejectHead = t.mock.method(Authority.prototype, "setHead", () => failure("ABORTED", "Simulated launch publication failure."));
      try {
        assert.equal(outcome.parse(await source.call("open_story_session", args)).status, "ABORTED");
      } finally { rejectHead.mock.restore(); }
    }
    const attempted = await Promise.all([source.call("open_story_session", args), source.call("open_story_session", args)]);
    const contexts = attempted.map((value) => context.safeParse(value)).filter((x) => x.success);
    assert.equal(contexts.length, 1, JSON.stringify(attempted.map((value) => outcome.parse(value).status)));
    const draft = contexts[0]?.data.context;
    assert.ok(draft);
    assert.equal(draft.story_sha256, heidi ? heidiStory : nativeStory);
    assert.equal(outcome.parse(await source.call("open_story_session", args)).status, "VALIDATION_FAILED");
    const ref = await activateFixture(source, draft);
    if (character) {
      const database = join(sourceDir, "fixture.sqlite");
      const image = publishedImage(database);
      image.checkpoint.adapter_build = priorFixtureAdapter;
      await source.close();
      const legacy = new DatabaseSync(database);
      try {
        assert.equal(legacy.prepare("UPDATE checkpoints SET body=?,digest=? WHERE id=?")
          .run(canonicalJson(image), canonicalDigest(image), image.checkpoint.checkpoint_id).changes, 1);
        legacy.exec("PRAGMA user_version=3");
      } finally { legacy.close(); }
      source = await harness(sourceDir, true, undefined, "native-z5", () => now, true);
    }
    const read = async (fixture: Awaited<ReturnType<typeof harness>>, object: unknown) =>
      context.parse(await fixture.call("get_turn_context", object)).context;

    const doLine = async (fixture: Awaited<ReturnType<typeof harness>>, head: Context["head"], text: string) => {
      const { result } = await commitFixtureInput(fixture, head, "request:" + randomUUID(), { kind: "line", text });
      return receipt.parse(result).receipt;
    };
    for (const command of heidi ? ["east", "take bird"] : character ? ["menu"] : ["look"]) {
      await doLine(source, (await read(source, ref)).head, command);
    }
    const saved = await read(source, ref);
    assert.equal(saved.pending_input, character ? "character" : "line");
    const save_id = await saveCombined(source, saved.head, "request:portable-save");
    const selection = { session_id: ref.session_id, branch_id: ref.branch_id, save_id };
    const review = await source.post("/private-export-review", selection);
    const download = /download:[0-9a-f-]{36}/u.exec(await review.text())?.[0];
    assert.ok(download);
    const fields = { ...selection, download };
    assert.equal((await source.post("/private-export", fields, "other")).status, 404);
    const file = await source.post("/private-export", fields);
    assert.equal(file.status, 200, await file.clone().text());
    assert.match(file.headers.get("content-disposition") ?? "", /^attachment;/u);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.includes(story.toString("base64")), false);
    assert.equal((await source.post("/private-export", fields)).status, 404);
    assert.equal((await source.post("/private-export-review", { ...selection, save_id }, "other")).status, 404);
    if (!heidi && !character) {
      let lastGrant: string | undefined;
      for (let i = 0; i < 8; i++) {
        const authorization = await source.post("/private-export-review", selection);
        assert.equal(authorization.status, 200);
        lastGrant = /download:[0-9a-f-]{36}/u.exec(await authorization.text())?.[0];
      }
      assert.ok(lastGrant);
      assert.equal((await source.post("/private-export-review", selection)).status, 409);
      now += 300_001;
      assert.equal((await source.post("/private-export", { ...selection, download: lastGrant })).status, 404);
      assert.equal((await source.post("/private-export-review", selection)).status, 200);
    }

    const wrongStory = heidi ? storyBytes() : readFileSync(new URL("../../tests/fixtures/zmachine/heidi/Heidi.z5", import.meta.url));
    const wrongHandle = await stage(target, "owner", "combined", wrongStory);
    assert.equal((await target.upload("/private-import", bytes, "owner", {
      "x-story-handle": wrongHandle, "x-import-request": randomUUID(),
    })).status, 404);
    const importHandle = await stage(target, "owner", "combined");
    const headers = { "x-story-handle": importHandle, "x-import-request": randomUUID() };
    const noSaveConsent = await target.upload("/private-import", bytes, "owner", { ...headers, "x-upload-consent": "no" });
    assert.equal(noSaveConsent.status, 400);
    assert.deepEqual(await noSaveConsent.json(), { error: "CONSENT_REQUIRED" });
    assert.equal((await target.upload("/private-import", bytes, "other", headers)).status, 404);
    if (!heidi && !character) {
      const otherStory = await stage(target, "other", "combined");
      assert.equal((await target.upload("/private-import", bytes, "other", {
        "x-story-handle": otherStory, "x-import-request": randomUUID(),
      })).status, 404);
      const alteredMac = Buffer.from(bytes.toString("utf8").replace(/"mac":"[0-9a-f]/u, (prefix) => prefix.endsWith("0") ? '"mac":"1' : '"mac":"0'));
      assert.notDeepEqual(alteredMac, bytes);
      assert.equal((await target.upload("/private-import", alteredMac, "owner", headers)).status, 404);
      assert.equal((await target.upload("/private-import", Buffer.alloc(0), "owner", {
        ...headers, connection: "close", expect: "100-continue", "content-length": String(16 * 1024 * 1024 + 1),
      })).status, 413);
      const executor = Object.getOwnPropertyDescriptor(target.service, "executor")?.value as Required<Pick<TurnExecutor, "recreateNative">>;
      const failedWorker = t.mock.method(executor, "recreateNative", () => Promise.resolve(failure("ABORTED", "Simulated worker timeout.")));
      try {
        assert.equal((await target.upload("/private-import", bytes, "owner", headers)).status, 409);
      } finally { failedWorker.mock.restore(); }
    }
    if (heidi) {
      const launch = await stage(target);
      await target.close();
      target = await startTarget(false);
      assert.equal(outcome.parse(await target.call("open_story_session", { version, launch_handle: launch })).status, "VALIDATION_FAILED");
      assert.equal((await target.upload("/private-import", bytes, "owner", headers)).status, 404);
      await target.close();
      target = await startTarget();
    }
    assert.equal((await target.upload("/private-import", bytes.subarray(0, -2), "owner", headers)).status, 404);
    interrupt = true;
    assert.equal((await target.upload("/private-import", bytes, "owner", headers)).status, 409);
    const interrupted = new DatabaseSync(join(targetDir, "fixture.sqlite"), { readOnly: true });
    try {
      for (const table of ["private_stories", "private_imports", "checkpoints", "requests", "heads"]) {
        assert.equal(interrupted.prepare("SELECT COUNT(*) AS count FROM " + table).get()?.count, 0, table);
      }
    } finally { interrupted.close(); }
    interrupt = false;
    const imported = await target.upload("/private-import", bytes, "owner", headers);
    assert.equal(imported.status, 200, await imported.clone().text());
    const importedResult = z.object({ ok: z.literal(true), value: importedSession }).parse(await imported.json()).value;
    const targetRef = { version, session_id: importedResult.head.session_id, branch_id: importedResult.head.branch_id };
    const importedView = await read(target, targetRef);
    assert.equal(importedView.mode, "PLAY");
    assert.notEqual(importedView.head.session_id, saved.head.session_id);
    assert.notEqual(importedView.head.generation_id, saved.head.generation_id);
    assert.deepEqual(importedView.native, saved.native);
    assert.deepEqual(importedView.rules, saved.rules);
    assert.deepEqual(importedView.facts, saved.facts);
    assert.deepEqual(importedView.clocks, saved.clocks);
    const from = publishedImage(join(sourceDir, "fixture.sqlite"));
    const into = publishedImage(join(targetDir, "fixture.sqlite"));
    if (character) {
      assert.equal(into.checkpoint.adapter_build, priorFixtureAdapter);
      const legacy = new DatabaseSync(join(sourceDir, "fixture.sqlite"), { readOnly: true });
      try {
        assert.equal(legacy.prepare("PRAGMA user_version").get()?.user_version, 4);
      } finally { legacy.close(); }
    }
    const check = createNativeFixtureExecutor();
    const prior = TurnImage.parse({ ...from, checkpoint: { ...from.checkpoint, adapter_build: priorFixtureAdapter } });
    assert.equal(check.verifyRestore(prior).ok, !heidi);
    assert.deepEqual(into.native, from.native);
    assert.deepEqual(into.snapshot.policy, from.snapshot.policy);
    assert.deepEqual(into.snapshot.history, from.snapshot.history);

    await target.close();
    target = await harness(targetDir, true, undefined, "native-z5", () => now, true);
    const retry = await target.upload("/private-import", bytes, "owner", headers);
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.deepEqual(z.object({ value: importedSession }).parse(await retry.json()).value, importedResult);
    if (!heidi && !character) {
      const conflict = await target.upload("/private-import", bytes.subarray(0, -2), "owner", headers);
      assert.equal(conflict.status, 404);
      z.object({ error: z.object({ subtype: z.literal("IDEMPOTENCY_CONFLICT") }) }).parse(await conflict.json());
    }
    const log = inspection.parse(await target.call("inspect_session", { ...targetRef, query: { kind: "history" } }));
    assert.ok(log.receipts.length > 1);
    if (heidi) {
      const reference = openStory(story);
      const systemRandom = Math.random;
      let seed = 42;
      try {
        Math.random = () => {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          return (seed >>> 0) / 2 ** 32;
        };
        assert.equal(reference.start().status, "waiting_for_line_input");
      } finally { Math.random = systemRandom; }
      reference.__g1bInternals().vm.xorshift_seed = 42;
      for (const text of ["east", "take bird"]) send(reference, { kind: "line", text });
      assert.deepEqual(capture(reference, heidiStory), nativePayload.parse(into.native).checkpoint);
      let ending = "";
      for (const text of ["northeast", "put bird in nest", "take nest", "up", "put nest on branch"]) {
        const authored = send(reference, { kind: "line", text });
        assert.deepEqual(authored.errors, []);
        const next = await doLine(target, (await read(target, targetRef)).head, text);
        assert.deepEqual(next.native_output, [authored.delta]);
        ending = next.native_output.join("");
        if (["take nest", "up", "put nest on branch"].includes(text)) {
          const projection = (await read(target, targetRef)).native?.projection;
          assert.ok(projection);
          const location = text === "put nest on branch" ? projection.visible : projection.inventory;
          assert.equal(location.find(({ name }) => name === "baby bird")?.qualifier, "in the bird's nest");
        }
      }
      const final = publishedImage(join(targetDir, "fixture.sqlite"));
      assert.deepEqual(capture(reference, heidiStory), nativePayload.parse(final.native).checkpoint);
      assert.match(ending, /You have won/u);
    } else {
      if (character) {
        const choice = { kind: "character", value: "b" } as const;
        const old = receipt.parse((await commitFixtureInput(source, saved.head, "request:choice", choice)).result).receipt;
        const restored = receipt.parse((await commitFixtureInput(target, importedView.head, "request:choice", choice)).result).receipt;
        assert.deepEqual(restored.native_output, old.native_output);
      }
      const reference = await doLine(source, (await read(source, ref)).head, "roll");
      const actual = await doLine(target, (await read(target, targetRef)).head, "roll");
      assert.deepEqual(actual.native_output, reference.native_output);
    }

    if (!heidi && !character) {
      const head = (await read(target, targetRef)).head;
      const savedAgain = await saveCombined(target, head, "request:portable-resave");
      const restore = { version, target: { ...head, request_id: "request:portable-restore" }, save_id: savedAgain };
      await reviewRestore(target, restore);
      assert.equal(outcome.parse(await target.call("restore_session", restore)).status, "RESTORED");
      const newHead = (await read(target, targetRef)).head;
      const exportAgain = { session_id: newHead.session_id, branch_id: newHead.branch_id,
        save_id: await saveCombined(target, newHead, "request:portable-reexport") };
      const confirmation = await target.post("/private-export-review", exportAgain);
      const grant = /download:[0-9a-f-]{36}/u.exec(await confirmation.text())?.[0];
      assert.ok(grant);
      assert.equal((await target.post("/private-export", { ...exportAgain, download: grant })).status, 200);
    }

    const otherHandle = await stage(target, "other");
    const expiredHandle = await stage(target);
    const expiringCombined = await stage(target, "owner", "combined");
    now += 3_600_001;
    take(target.service.collectAbandoned());
    assert.equal(outcome.parse(await target.call("open_story_session", { version, launch_handle: expiredHandle })).status, "VALIDATION_FAILED");
    assert.equal(outcome.parse(await target.call("open_story_session", { version, launch_handle: otherHandle }, "other")).status, "VALIDATION_FAILED");
    assert.equal((await target.upload("/private-import", bytes, "owner", {
      "x-story-handle": expiringCombined, "x-import-request": randomUUID(),
    })).status, 404);
    const revoked = await stage(target);
    assert.equal((await target.post("/private-story-revoke", { handle: revoked }, "other")).status, 404);
    assert.equal((await target.post("/private-story-revoke", { handle: revoked })).status, 200);
    assert.equal(outcome.parse(await target.call("open_story_session", { version, launch_handle: revoked })).status, "VALIDATION_FAILED");
    const deletion = { session_id: targetRef.session_id, branch_id: targetRef.branch_id, confirmed: "yes" };
    assert.equal((await target.post("/private-delete", deletion, "other")).status, 404);
    assert.match(await (await target.get("/private-sessions")).text(), new RegExp(importedResult.head.session_id, "u"));
    assert.doesNotMatch(await (await target.get("/private-sessions", "other")).text(), new RegExp(importedResult.head.session_id, "u"));
    assert.equal((await target.post("/private-delete", deletion)).status, 200);
    assert.doesNotMatch(await (await target.get("/private-sessions")).text(), new RegExp(importedResult.head.session_id, "u"));
    assert.equal((await target.upload("/private-import", bytes, "owner", headers)).status, 404);
    assert.equal(outcome.parse(await target.call("get_turn_context", targetRef)).status, "VALIDATION_FAILED");
    const deleted = new DatabaseSync(join(targetDir, "fixture.sqlite"), { readOnly: true });
    try {
      for (const table of ["private_stories", "private_uploads", "private_imports", "checkpoints", "checkpoint_links", "requests", "events", "heads"]) {
        assert.equal(deleted.prepare("SELECT COUNT(*) AS count FROM " + table).get()?.count, 0, table);
      }
    } finally { deleted.close(); }
    const unaffected = context.parse(await target.call("open_story_session", {
      version, launch_handle: await stage(target, "other"),
    }, "other")).context;
    const own = context.parse(await target.call("open_story_session", { version, launch_handle: await stage(target) })).context;
    assert.equal((await target.post("/private-delete", { session_id: own.head.session_id, branch_id: own.head.branch_id, confirmed: "yes" })).status, 200);
    assert.deepEqual(context.parse(await target.call("get_turn_context", {
      version, session_id: unaffected.head.session_id, branch_id: unaffected.head.branch_id,
    }, "other")).context, unaffected);
    if (!heidi && !character) {
      const bundled = await activateFixture(target);
      const head = (await read(target, bundled)).head;
      const save_id = await saveCombined(target, head, "request:bundled-nonportable");
      const scope = { session_id: bundled.session_id, branch_id: bundled.branch_id };
      const manager = "/private-session?" + new URLSearchParams(scope).toString();
      assert.equal((await target.get(manager)).status, 404);
      assert.equal((await target.post("/private-export-review", { ...scope, save_id })).status, 404);
    }
  });
}
