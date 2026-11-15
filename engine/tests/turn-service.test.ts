import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { TurnService } from "../src/turn/service.ts";
import { TurnImage, limits } from "../src/turn/contracts.ts";
import { browserControl } from "../src/auth/browser-control.ts";
import { BranchId, canonicalDigest, canonicalJson } from "../src/contracts.ts";
import type { Permit } from "../src/auth/authority.ts";
import type { FaultPoint } from "../src/turn/contracts.ts";
import type { Result } from "../src/ports.ts";
import { amendment, edit, endpoint, makeFixture, play, take } from "./turn-fixture.ts";

void test("A25–A26 concurrent retries execute once and retain the exact receipt", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "zirp-turn-"));
  const fixture = makeFixture();
  const service = new TurnService(join(directory, "turns.db"), fixture);
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  const { access, envelope, proposal, state } = play();
  take(service.initialize(state));
  const prepared = take(service.prepareTurn(access, envelope, proposal));
  assert.equal(prepared.kind, "prepared");
  if (prepared.kind !== "prepared") return;
  assert.equal(fixture.executions, 0);
  const first = service.commitTurn(access, envelope, prepared.handle.candidate_id);
  const second = service.commitTurn(access, envelope, prepared.handle.candidate_id);
  const [a, b] = (await Promise.all([first, second])).map(take);
  assert.deepEqual(a, b);
  assert.equal(a?.receipt.time_cost, 1);
  assert.equal(a?.receipt.in_fiction_result, "failure");
  assert.equal(fixture.executions, 1);
  const retry = take(await service.commitTurn(access, envelope, prepared.handle.candidate_id));
  assert.deepEqual(retry, a);
  const changed = await service.commitTurn(access, { ...envelope, input: { kind: "line", text: "different" } }, prepared.handle.candidate_id);
  assert.ok(!changed.ok);
  assert.equal(changed.error.subtype, "IDEMPOTENCY_CONFLICT");
  assert.equal(fixture.executions, 1);
});

function temp(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "zirp-turn-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "turns.db");
}

function database(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT c.body FROM checkpoints c JOIN heads h ON c.id=h.checkpoint").get();
    assert.equal(typeof row?.body, "string");
    const requests = db.prepare("SELECT receipt, claim FROM requests WHERE receipt IS NOT NULL").all();
    const events = db.prepare("SELECT body FROM events").all();
    const candidates = db.prepare("SELECT json_extract(value,'$.spent') AS spent FROM authority WHERE area='candidates'").all();
    const leases = db.prepare("SELECT json_extract(value,'$.remaining') AS remaining FROM authority WHERE area='leases'").all();
    const orphan = db.prepare("SELECT count(*) AS count FROM checkpoints WHERE published=0").get()?.count;
    return { head: TurnImage.parse(JSON.parse(String(row?.body))), receipts: requests, events, candidates, leases, orphan };
  } finally { db.close(); }
}

function prepared(service: TurnService, input: ReturnType<typeof play> | ReturnType<typeof edit> | ReturnType<typeof amendment>) {
  const result = take(service.prepareTurn(input.access, input.envelope, input.proposal, "context" in input ? input.context : null));
  assert.equal(result.kind, "prepared");
  return result;
}

function permission(service: TurnService, input: ReturnType<typeof edit> | ReturnType<typeof amendment>) {
  take(service.browser.control(input.access.owner_id, input.state.snapshot.head, "request:mode", "/edit"));
  const result = prepared(service, input);
  const displayed = take(service.browser.display(input.access.owner_id, result.handle.candidate_id));
  assert.equal(displayed.diff, result.diff);
  const grant = take(service.browser.confirm(input.access.owner_id, result.handle.candidate_id, displayed.digest));
  const permit: Permit = { candidate_id: result.handle.candidate_id, diff_digest: displayed.digest, reference: grant.grant_id, source: "approval" };
  return { result, permit };
}

function rejects(result: Result<unknown>, status: string) {
  assert.ok(!result.ok);
  assert.equal(result.error.status, status);
}

void test("A15 rejected candidate discards native state, RNG, boundary, time and output", async (t) => {
  const path = temp(t);
  let inject = true;
  const fixture = makeFixture((result) => {
    if (inject) result.effects = [...result.effects, { ...endpoint, change: "write" }];
  });
  const service = new TurnService(path, fixture);
  const input = play();
  try {
    take(service.initialize(input.state));
    const stage = prepared(service, input);
    rejects(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id), "VALIDATION_FAILED");
    assert.deepEqual(database(path).head, input.state);
    assert.deepEqual(database(path).events, []);
    assert.deepEqual(database(path).receipts, []);
    inject = false;
    const retry = take(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id));
    const next = database(path).head;
    const controlPath = temp(t);
    const control = new TurnService(controlPath, makeFixture());
    try {
      take(control.initialize(input.state));
      const expected = take(await control.commitTurn(input.access, input.envelope, prepared(control, input).handle.candidate_id));
      assert.deepEqual(next.native, database(controlPath).head.native);
      assert.deepEqual(retry.receipt.native_output, expected.receipt.native_output);
      assert.deepEqual(next.checkpoint.clocks, database(controlPath).head.checkpoint.clocks);
    } finally { control.close(); }
    assert.equal(next.checkpoint.native_state.pending_input.kind, "character");
    const character = play("request:character", next);
    assert.equal(take(await service.commitTurn(character.access, character.envelope, prepared(service, character).handle.candidate_id)).receipt.time_cost, 1);
    assert.equal(database(path).head.checkpoint.native_state.pending_input.kind, "line");
  } finally { service.close(); }
});

void test("A27 concurrent different requests cannot both publish against the same head", async (t) => {
  const path = temp(t);
  const service = new TurnService(path, makeFixture());
  try {
    const a = play();
    const b = play("request:second");
    take(service.initialize(a.state));
    const first = prepared(service, a);
    const second = prepared(service, b);
    const results = await Promise.all([service.commitTurn(a.access, a.envelope, first.handle.candidate_id),
      service.commitTurn(b.access, b.envelope, second.handle.candidate_id)]);
    assert.equal(results.filter(({ ok }) => ok).length, 1);
    assert.ok(results.some((result) => !result.ok && result.error.status === "STALE_REVISION"));
    assert.equal(database(path).head.checkpoint.clocks.native, 1);
    assert.equal(database(path).receipts.length, 1);
    const stale = { ...b.envelope, generation_id: "generation:other" };
    rejects(service.prepareTurn(b.access, stale, b.proposal), "STALE_REVISION");
    const wrongPolicy = { ...b.envelope, request_id: "request:wrong-policy", expected_revision: database(path).head.checkpoint.revision,
      expected_policy_revision: b.envelope.expected_policy_revision + 1 };
    rejects(service.prepareTurn(b.access, wrongPolicy, b.proposal), "STALE_REVISION");
  } finally { service.close(); }
});

void test("inspection and clarification keep head and clocks unchanged, and cancellation beats a running fixture", async (t) => {
  const path = temp(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new TurnService(path, makeFixture(undefined, () => gate));
  try {
    const input = play();
    take(service.initialize(input.state));
    const inspection = { ...input.proposal, operations: [{ kind: "inspect.entity", entity_id: endpoint.entity_id }],
      declared_effects: [{ ...endpoint, change: "read" }] };
    const result = take(service.prepareTurn(input.access, { ...input.envelope, intent: "inspect" }, inspection));
    assert.equal(result.kind, "inspection");
    assert.equal(result.time_cost, 0);
    assert.ok(result.facts[0]?.includes("Before"));
    rejects(service.prepareTurn(input.access, { ...input.envelope, intent: "editor" }, input.proposal), "NEEDS_CLARIFICATION");
    const stage = prepared(service, input);
    const committing = service.commitTurn(input.access, input.envelope, stage.handle.candidate_id);
    await Promise.resolve();
    take(service.cancelTurn(input.access, input.envelope, stage.handle.candidate_id));
    release();
    rejects(await committing, "ABORTED");
    assert.deepEqual(database(path).head, input.state);
  } finally { release(); service.close(); }
});

void test("A38 wrong scope, changed proposal, and revoked or expired authority fail before publication", async (t) => {
  const path = temp(t);
  let now = 1000;
  const fixture = makeFixture();
  const service = new TurnService(path, fixture, () => now);
  try {
    const input = edit();
    take(service.initialize(input.state));
    const { result, permit } = permission(service, input);
    rejects(await service.commitTurn(input.access, input.envelope, "candidate:guessed", permit), "VALIDATION_FAILED");
    const version = await service.commitTurn({ ...input.access, session_id: "session:other" as typeof input.access.session_id },
      input.envelope, result.handle.candidate_id, permit);
    rejects(version, "VALIDATION_FAILED");
    const changed = service.prepareTurn(input.access, input.envelope, { ...input.proposal,
      operations: [{ ...input.proposal.operations[0], value: "Tampered" }] });
    assert.ok(!changed.ok);
    assert.equal(changed.error.subtype, "IDEMPOTENCY_CONFLICT");
    rejects(await service.commitTurn(input.access, input.envelope, result.handle.candidate_id,
      { ...permit, diff_digest: "0".repeat(64) }), "NEEDS_APPROVAL");
    take(service.browser.revokeCandidate(input.access.owner_id, result.handle.candidate_id));
    rejects(await service.commitTurn(input.access, input.envelope, result.handle.candidate_id, permit), "NEEDS_APPROVAL");
    const expiring = edit("request:expiry");
    const e = permission(service, expiring);
    now += 300_000;
    rejects(await service.commitTurn(expiring.access, expiring.envelope, e.result.handle.candidate_id, e.permit), "NEEDS_APPROVAL");
    assert.deepEqual(database(path).head, input.state);
    assert.equal(fixture.executions, 0);
  } finally { service.close(); }
});

void test("A30 a verified #15 subset, policy, overlay patch, grant and receipt publish together", async (t) => {
  const path = temp(t);
  let fail = true;
  const service = new TurnService(path, makeFixture(), () => 1000, (point) => {
    if (fail && point === "before_commit") throw new Error("Injected publication failure");
  });
  try {
    const request = amendment();
    take(service.initialize(request.state));
    const { result, permit } = permission(service, request);
    rejects(await service.commitTurn(request.access, request.envelope, result.handle.candidate_id, permit), "ABORTED");
    const baseline = database(path);
    assert.deepEqual(baseline.head, request.state);
    assert.deepEqual(baseline.events, []);
    assert.deepEqual(baseline.receipts, []);
    assert.equal(baseline.candidates[0]?.spent, 0);
    assert.equal(take(service.collectAbandoned()), 1);
    fail = false;
    const committed = take(await service.commitTurn(request.access, request.envelope, result.handle.candidate_id, permit));
    const saved = database(path);
    assert.equal(committed.receipt.time_cost, 0);
    assert.equal(saved.head.checkpoint.policy_revision, request.state.checkpoint.policy_revision + 1);
    assert.deepEqual(saved.head.amendment, request.proposal.amendment.compiled);
    assert.equal(saved.head.snapshot.policy.policy_amendment.generation_rules[0]?.id, "rule:no-generation");
    assert.deepEqual(saved.head.snapshot.policy.world_patch, []);
    assert.deepEqual(saved.head.snapshot.policy.unresolved, [
      ...request.state.snapshot.policy.unresolved, ...request.proposal.amendment.compiled.bundle.unresolved,
    ]);
    assert.ok(request.proposal.amendment.compiled.bundle.unresolved.length > 0);
    const later = amendment(saved.head);
    const next = permission(service, later);
    take(await service.commitTurn(later.access, later.envelope, next.result.handle.candidate_id, next.permit));
    assert.deepEqual(database(path).head.snapshot.policy.unresolved, [
      ...saved.head.snapshot.policy.unresolved, ...later.proposal.amendment.compiled.bundle.unresolved,
    ]);
    assert.equal(saved.head.snapshot.entities[0]?.surfaces[0]?.fact.state, "present");
    assert.match(canonicalJson(saved.head.snapshot.entities), /Updated/);
    assert.equal(saved.candidates[0]?.spent, 1);
    assert.equal(saved.receipts[0]?.receipt, canonicalJson(committed));
    assert.equal(saved.events.length, 1);
  } finally { service.close(); }
});

void test("execution budget and corrupt checkpoints fail closed", async (t) => {
  const path = temp(t);
  const fixture = makeFixture((result) => { result.events = Array.from({ length: 33 }, () => ({})); });
  const service = new TurnService(path, fixture);
  const request = play();
  try {
    take(service.initialize(request.state));
    const id = prepared(service, request).handle.candidate_id;
    rejects(await service.commitTurn(request.access, request.envelope, id), "ABORTED");
    assert.deepEqual(database(path).head, request.state);
    const raw = new DatabaseSync(path);
    try { raw.exec("UPDATE checkpoints SET digest='invalid' WHERE published=1"); } finally { raw.close(); }
    rejects(await service.commitTurn(request.access, request.envelope, id), "ABORTED");
    assert.equal(fixture.executions, 1);
  } finally { service.close(); }
});

async function killAt(path: string, point: FaultPoint, editor = false) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./turn-crash-child.ts", import.meta.url)), path, point, ...(editor ? ["edit"] : [])],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const exited = once(child, "close");
  let diagnostics = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => { diagnostics += value; });
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let id = "";
  let reached = false;
  try {
    for await (const line of lines) {
      const event = JSON.parse(line) as { candidate?: string; point?: string };
      if (event.candidate) id = event.candidate;
      if (event.point === point) { reached = true; assert.ok(child.kill("SIGKILL")); break; }
    }
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null && child.signalCode === null && !reached) child.kill("SIGKILL");
    await exited;
    assert.ok(reached && id, diagnostics);
    assert.ok(child.exitCode !== 0 || child.signalCode, "Child must have exited abnormally.");
  }
  return id;
}

for (const point of ["before_checkpoint", "after_checkpoint", "before_commit", "after_commit"] as const) {
  void test("A28–A29 process kill at " + point, async (t) => {
    const path = temp(t);
    const request = play();
    const id = await killAt(path, point);
    const onDisk = database(path);
    const fixture = makeFixture();
    const service = new TurnService(path, fixture, () => 1000);
    try {
      if (point === "after_commit") {
        const receipt = take(await service.commitTurn(request.access, request.envelope, id));
        assert.equal(onDisk.receipts[0]?.receipt, canonicalJson(receipt));
        assert.equal(onDisk.head.checkpoint.clocks.native, 1);
        assert.equal(onDisk.events.length, 1);
        assert.equal(fixture.executions, 0);
      } else {
        assert.deepEqual(onDisk.head, request.state);
        assert.equal(onDisk.receipts.length, 0);
        assert.equal(onDisk.events.length, 0);
        assert.equal(take(service.collectAbandoned()), point === "before_checkpoint" ? 0 : 1);
        const receipt = take(await service.commitTurn(request.access, request.envelope, id));
        assert.equal(receipt.receipt.time_cost, 1);
        assert.equal(fixture.executions, 1);
      }
    } finally { service.close(); }
  });
}

void test("A30 a process kill rolls back authority consumption with the amendment", async (t) => {
  const path = temp(t);
  const request = amendment();
  await killAt(path, "before_commit", true);
  const onDisk = database(path);
  assert.deepEqual(onDisk.head, request.state);
  assert.equal(onDisk.candidates[0]?.spent, 0);
  assert.equal(onDisk.events.length, 0);
  assert.equal(onDisk.receipts.length, 0);
  const service = new TurnService(path, makeFixture());
  try {
    assert.equal(take(service.collectAbandoned()), 1);
    rejects(service.prepareTurn(request.access, request.envelope, request.proposal, request.context), "NEEDS_APPROVAL");
  } finally { service.close(); }
});

void test("lease consumption and final authority recheck share the publication boundary", async (t) => {
  const path = temp(t);
  let entered = () => {};
  let release = () => {};
  const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const service = new TurnService(path, makeFixture(undefined, async () => { entered(); await wait; }), () => 1000);
  try {
    const input = edit();
    take(service.initialize(input.state));
    const head = input.state.snapshot.head;
    take(service.browser.control(input.access.owner_id, head, "request:mode", "/edit"));
    const lease = take(service.browser.issueLease(input.access.owner_id, head, [endpoint], 300_000, 1));
    const staged = prepared(service, input);
    const permit: Permit = { candidate_id: staged.handle.candidate_id, diff_digest: staged.diff_digest, source: "lease", reference: lease };
    const commit = service.commitTurn(input.access, input.envelope, staged.handle.candidate_id, permit);
    await enteredGate;
    take(service.browser.revokeLease(input.access.owner_id, lease));
    release();
    rejects(await commit, "NEEDS_APPROVAL");
    assert.deepEqual(database(path).head, input.state);
    assert.equal(database(path).receipts.length, 0);
    const replacement = take(service.browser.issueLease(input.access.owner_id, head, [endpoint], 300_000, 1));
    const grant = { ...permit, reference: replacement };
    const receipt = take(await service.commitTurn(input.access, input.envelope, staged.handle.candidate_id, grant));
    assert.deepEqual(take(await service.commitTurn(input.access, input.envelope, staged.handle.candidate_id, grant)), receipt);
    assert.deepEqual(database(path).leases.map(({ remaining }) => remaining), [0, 0]);
    assert.equal(database(path).receipts.length, 1);
    assert.equal(receipt.receipt.time_cost, 0);
  } finally { release(); service.close(); }
});

void test("native line text must match the exact envelope before execution", (t) => {
  const path = temp(t);
  const fixture = makeFixture();
  const service = new TurnService(path, fixture);
  const request = play();
  try {
    take(service.initialize(request.state));
    rejects(service.prepareTurn(request.access, request.envelope, { ...request.proposal,
      operations: [{ kind: "native.line", text: "open " }] }), "VALIDATION_FAILED");
    assert.equal(fixture.executions, 0);
    assert.deepEqual(database(path).head, request.state);
  } finally { service.close(); }
});

void test("inspection withholds a presentation fact from an incompletely covered surface", (t) => {
  const service = new TurnService(temp(t), makeFixture());
  const request = play();
  const surface = request.state.snapshot.entities[0]?.surfaces[0];
  assert.ok(surface);
  surface.coverage = "incomplete";
  request.state.checkpoint.remix_state_ref = "blob:" + canonicalDigest(request.state.snapshot.entities);
  try {
    take(service.initialize(request.state));
    const inspected = take(service.prepareTurn(request.access, { ...request.envelope, intent: "inspect" }, {
      ...request.proposal, operations: [{ kind: "inspect.entity", entity_id: endpoint.entity_id }], declared_effects: [],
    }));
    assert.deepEqual(inspected, { kind: "inspection", facts: [], time_cost: 0 });
  } finally { service.close(); }
});

void test("one-turn Editor retries survive a transient rollback and reject conflicting duplicates", async (t) => {
  const path = temp(t);
  const fixture = makeFixture();
  let fail = true;
  const service = new TurnService(path, fixture, () => 1000, (point) => {
    if (fail && point === "before_commit") throw new Error("Transient fixture failure");
  });
  try {
    const input = edit();
    const head = input.state.snapshot.head;
    take(service.initialize(input.state));
    take(service.browser.control(input.access.owner_id, head, input.envelope.request_id, "/edit Change the room label."));
    const stage = prepared(service, input);
    const grant = take(service.browser.confirm(input.access.owner_id, stage.handle.candidate_id, stage.diff_digest));
    const permit: Permit = { candidate_id: stage.handle.candidate_id, source: "approval", diff_digest: stage.diff_digest, reference: grant.grant_id };
    for (const proposal of [{ bogus: true }, { ...input.proposal, operations: [{ kind: "native.line", text: "other" }] }]) {
      const result = service.prepareTurn(input.access, input.envelope, proposal);
      assert.ok(!result.ok);
      assert.equal(result.error.subtype, "IDEMPOTENCY_CONFLICT");
    }
    const aborted = await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id, permit);
    assert.ok(!aborted.ok);
    assert.equal(aborted.error.retry, "same_request");
    assert.deepEqual(database(path).head, input.state);
    fail = false;
    const committed = take(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id, permit));
    assert.equal(committed.receipt.time_cost, 0);
    const next = database(path).head;
    const cancel = edit("request:cancel-edit");
    Object.assign(cancel.envelope, next.snapshot.head);
    Object.assign(cancel.proposal, next.snapshot.head);
    rejects(service.prepareTurn(cancel.access, cancel.envelope, cancel.proposal), "NEEDS_APPROVAL");
    take(service.browser.control(cancel.access.owner_id, next.snapshot.head, cancel.envelope.request_id, "/edit Change the room label again."));
    const pending = prepared(service, cancel);
    take(service.cancelTurn(cancel.access, cancel.envelope, pending.handle.candidate_id));
    const cancelled = await service.commitTurn(cancel.access, cancel.envelope, pending.handle.candidate_id);
    assert.ok(!cancelled.ok);
    assert.equal(cancelled.error.retry, "none");
    assert.deepEqual(database(path).head, next);
    assert.equal(fixture.executions, 2);
  } finally { service.close(); }
});

void test("expired Editor requests stay retired when collection drops their payloads", async (t) => {
  const path = temp(t);
  let now = 1000;
  const service = new TurnService(path, makeFixture(), () => now);
  try {
    const input = edit();
    take(service.initialize(input.state));
    const { result, permit } = permission(service, input);
    now += 300_000;
    take(service.collectAbandoned());
    rejects(service.prepareTurn(input.access, input.envelope, input.proposal), "NEEDS_APPROVAL");
    rejects(await service.commitTurn(input.access, input.envelope, result.handle.candidate_id, permit), "NEEDS_APPROVAL");
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT count(*) AS count FROM authority WHERE area IN ('candidates','requestCandidates')").get()?.count, 0);
      assert.equal(db.prepare("SELECT stage FROM requests").get()?.stage, null);
    } finally { db.close(); }
    prepared(service, edit("request:new-edit"));
  } finally { service.close(); }
});

void test("replacement coordinator fences the old service from publishing staged work", async (t) => {
  const path = temp(t);
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = new TurnService(path, makeFixture(undefined, async () => { enter(); await gate; }));
  const input = play();
  try {
    take(first.initialize(input.state));
    const id = prepared(first, input).handle.candidate_id;
    const oldCommit = first.commitTurn(input.access, input.envelope, id);
    await entered;
    const second = new TurnService(path, makeFixture());
    try {
      release();
      rejects(await oldCommit, "ABORTED");
      assert.deepEqual(database(path).head, input.state);
      take(await second.commitTurn(input.access, input.envelope, id));
      assert.equal(database(path).receipts.length, 1);
    } finally { second.close(); }
  } finally { release(); first.close(); }
});

void test("branch initialization rejects checkpoint ID collisions without creating a partial branch", (t) => {
  const service = new TurnService(temp(t), makeFixture());
  try {
    const first = play().state;
    take(service.initialize(first));
    const second = structuredClone(first);
    const branch = BranchId.parse("branch:second");
    second.checkpoint.branch_id = branch;
    second.snapshot.head.branch_id = branch;
    rejects(service.initialize(second), "VALIDATION_FAILED");
    second.checkpoint.checkpoint_id = TurnImage.shape.checkpoint.shape.checkpoint_id.parse("checkpoint:second");
    take(service.initialize(second));
  } finally { service.close(); }
});

void test("browserControl over the turn service persists exact-diff approval", async (t) => {
  const path = temp(t);
  const service = new TurnService(path, makeFixture());
  const input = edit();
  let origin = "";
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  const handler = (req: Parameters<ReturnType<typeof browserControl>>[0], res: Parameters<ReturnType<typeof browserControl>>[1]) =>
    browserControl(service.browser, origin, (request) => request.headers.cookie === "browser=fixture"
      ? { owner: input.access.owner_id, csrf: "separate-csrf" } : undefined)(req, res);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
  try {
    const headers = { origin, cookie: "browser=fixture", "content-type": "application/json", "x-csrf-token": "separate-csrf" };
    take(service.initialize(input.state));
    const mode = await fetch(origin + "/mode", { method: "POST", headers, body: JSON.stringify({
      head: input.state.snapshot.head, request_id: "request:mode", command: "/edit",
    }) });
    assert.equal(mode.status, 200);
    await mode.text();
    const stage = prepared(service, input);
    const id = stage.handle.candidate_id;
    const browser = await fetch(origin + "/candidate?id=" + id, { headers });
    assert.equal(browser.status, 200);
    assert.match(await browser.text(), new RegExp(stage.diff_digest));
    const approved = await fetch(origin + "/approve", { method: "POST", headers, body: JSON.stringify({ candidate: id, digest: stage.diff_digest }) });
    assert.equal(approved.status, 200);
    await approved.text();
    const grant = take(service.lookupApproval(input.access, input.state.snapshot.head, id));
    take(await service.commitTurn(input.access, input.envelope, id, {
      candidate_id: id, source: "approval", diff_digest: stage.diff_digest, reference: grant.grant_id,
    }));
    assert.equal(database(path).candidates[0]?.spent, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
  }
});

void test("overlay inventory transfer advances only overlay time, followed by a native success", async (t) => {
  const path = temp(t);
  const input = play("request:overlay");
  const room = input.state.snapshot.entities[0];
  const surface = room?.surfaces[0];
  assert.ok(room && surface);
  const inventory = (id: string, field: string, value: string | string[]) => ({
    ...room, id, surfaces: [{ ...surface, field, domain: "inventory" as const, direct_assignment: false,
      fact: { state: "present" as const, value, evidence_id: "evidence:inventory" } }],
  });
  const item = "remix:key";
  const from = "remix:player";
  const to = "remix:floor";
  input.state.snapshot.entities.push(inventory(item, "inventory:holder", from),
    inventory(from, "inventory:contents", [item]), inventory(to, "inventory:contents", []));
  input.state.checkpoint.remix_state_ref = "blob:" + canonicalDigest(input.state.snapshot.entities);
  const proposal = { ...input.proposal, operations: [{ kind: "inventory.transfer", item, from, to }],
    declared_effects: [{ entity_id: item, field: "inventory:holder", change: "write" },
      ...[from, to].map((entity_id) => ({ entity_id, field: "inventory:contents", change: "write" }))] };
  let omit = true;
  const service = new TurnService(path, makeFixture((execution) => {
    if (omit) execution.effects = execution.effects.slice(0, 2);
  }));
  try {
    take(service.initialize(input.state));
    const stage = take(service.prepareTurn(input.access, input.envelope, proposal));
    assert.equal(stage.kind, "prepared");
    rejects(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id), "VALIDATION_FAILED");
    assert.deepEqual(database(path).head, input.state);
    omit = false;
    const committed = take(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id));
    const next = database(path).head;
    assert.equal(committed.receipt.time_cost, 1);
    assert.deepEqual(next.checkpoint.clocks, { native: 0, overlay: 1, policy: "native_running" });
    const fact = (id: string) => next.snapshot.entities.find((entity) => entity.id === id)?.surfaces[0]?.fact;
    for (const [id, value] of [[item, to], [from, []], [to, [item]]] as const) {
      assert.deepEqual(fact(id), { state: "present", value, evidence_id: "evidence:inventory" });
    }
    const native = play("request:success", next, "look");
    const observed = take(await service.commitTurn(native.access, native.envelope, prepared(service, native).handle.candidate_id));
    assert.equal(observed.receipt.in_fiction_result, "success");
    assert.deepEqual(observed.receipt.native_output, ["You look around.\r\n"]);
    assert.deepEqual(database(path).head.checkpoint.clocks, { native: 1, overlay: 1, policy: "native_running" });
  } finally { service.close(); }
});

void test("paused native clock disallows a turn before executor dispatch", (t) => {
  const path = temp(t);
  const fixture = makeFixture();
  const service = new TurnService(path, fixture);
  try {
    const input = play();
    input.state.checkpoint.clocks.policy = "native_paused";
    input.state.snapshot.clock.native_running = false;
    take(service.initialize(input.state));
    rejects(service.prepareTurn(input.access, input.envelope, input.proposal), "CAPABILITY_MISSING");
    assert.equal(fixture.executions, 0);
    assert.deepEqual(database(path).head, input.state);
  } finally { service.close(); }
});

void test("storage version, output size and checkpoint size are enforced", async (t) => {
  const path = temp(t);
  const alternate = temp(t);
  const versioned = new DatabaseSync(alternate);
  try { versioned.exec("PRAGMA user_version=999"); } finally { versioned.close(); }
  assert.throws(() => new TurnService(alternate, makeFixture()), /Unsupported turn database version/);
  const service = new TurnService(path, makeFixture((execution) => { execution.output = ["x".repeat(limits.output_bytes + 1)]; }));
  try {
    const input = play();
    const tooLarge = structuredClone(input.state);
    tooLarge.native = { bytes: "x".repeat(limits.checkpoint_bytes + 1) };
    rejects(service.initialize(tooLarge), "ABORTED");
    take(service.initialize(input.state));
    const stage = prepared(service, input);
    const result = await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id);
    assert.ok(!result.ok);
    assert.equal(result.error.status, "ABORTED");
    assert.match(result.error.message, /output budget/);
    assert.deepEqual(database(path).head, input.state);
  } finally { service.close(); }
});

void test("cooperative deadline aborts without publishing and allows an identical fresh attempt", async (t) => {
  const path = temp(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new TurnService(path, makeFixture(undefined, () => gate));
  try {
    const input = play();
    take(service.initialize(input.state));
    const stage = prepared(service, input);
    const commit = service.commitTurn(input.access, input.envelope, stage.handle.candidate_id);
    await Promise.resolve();
    t.mock.timers.tick(5000);
    const aborted = await commit;
    assert.ok(!aborted.ok);
    assert.equal(aborted.error.retry, "same_request");
    assert.deepEqual(database(path).head, input.state);
    release();
    assert.equal(take(await service.commitTurn(input.access, input.envelope, stage.handle.candidate_id)).receipt.time_cost, 1);
  } finally { release(); service.close(); }
});
