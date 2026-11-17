import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { z } from "zod";
import { OwnerId } from "../src/contracts.ts";
import { compilerView, fixtureContext, receiptView } from "../src/fixture/session-contracts.ts";
import { createFixtureExecutor } from "../src/fixture/synthetic-world.ts";
import { fixtureServer } from "../src/mcp/server.ts";
import { scopes } from "../src/mcp/tools.ts";
import type { FaultPoint } from "../src/turn/contracts.ts";
import { TurnService } from "../src/turn/service.ts";
import { makeFixture, play, take } from "./turn-fixture.ts";

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

async function harness(directory: string, browserEnabled = true, fault?: (point: FaultPoint) => void) {
  const service = new TurnService(join(directory, "fixture.sqlite"), createFixtureExecutor(), Date.now, fault);
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
  function browserRequest(path: string, method: string, browser: string, requestOrigin: string, body?: string) {
    return new Promise<Response>((resolve, reject) => {
      const call = request(base + path, { method,
        headers: { host: "fixture.test", origin: requestOrigin, cookie: "fixture=" + browser,
          ...(body ? { "content-type": "application/json" } : {}) },
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
      call.end(body);
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
  return { base, rpc, call, post, get, open, record,
    launch: () => reference("/fixture-launch", {}, /launch:[0-9a-f-]{36}/u),
    async approve({ candidate_id, diff_digest }: z.infer<typeof prepared>) {
      const response = await post("/approve", { candidate: candidate_id, digest: diff_digest });
      assert.equal(response.status, 200, await response.text());
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      service.close();
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
      ["open_story_session", "prepare_turn", "commit_turn"]);
    assert.deepEqual(listed.map((item) => item.securitySchemes[0]?.scopes[0]),
      [scopes.launch, scopes.read, scopes.read, scopes.stage, scopes.commit, scopes.read, scopes.read, scopes.read]);
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
    for (const name of ["save_session", "restore_session"]) {
      z.object({ status: z.literal("CAPABILITY_MISSING"), handoff: z.literal("#21") }).parse(await call(name, ref));
    }
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
    assert.equal(receipt.parse(await call("commit_turn", firstCommit)).receipt.time_cost, 0);
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
      return { result, request: { version, target: stored.target, action: stored.action } };
    }
    const label = await edit(active, "request:assignment", "assignment", "Rename the room Lamplit Room.",
      [assignment("presentation:label", "Lamplit Room")]);
    assert.equal(outcome.parse(label.result).status, "PREPARED", JSON.stringify(label.result));
    const labelStage = prepared.parse(label.result);
    await fixture.approve(labelStage);
    const labelRequest = { ...label.request, ...labelStage };
    const [labelReceipt, duplicateReceipt] = await Promise.all([call("commit_turn", labelRequest), call("commit_turn", labelRequest)]);
    assert.deepEqual(labelReceipt, duplicateReceipt);
    assert.equal(receipt.parse(labelReceipt).receipt.policy_revision, 1);
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
    legacy.exec("DROP TABLE fixture_records; DROP TABLE fixture_drafts; ALTER TABLE requests DROP COLUMN committed_candidate; " +
      "ALTER TABLE requests DROP COLUMN committed_digest; PRAGMA user_version=1");
    legacy.close();
    const migrated = new TurnService(path, makeFixture());
    try {
      assert.deepEqual(take(await migrated.commitTurn(input.access, input.envelope, stage.handle.candidate_id)), committed);
      assert.ok(take(migrated.issueFixtureLaunch(owner)).startsWith("launch:"));
      const observed = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(observed.prepare("PRAGMA user_version").get()?.user_version, 2);
        assert.equal(observed.prepare("SELECT COUNT(*) AS total FROM heads").get()?.total, 1);
      } finally { observed.close(); }
    } finally { migrated.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
