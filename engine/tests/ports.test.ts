import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  CandidateHandle, CapabilityManifest, CombinedCheckpoint, DirectiveBundle, HeadExpectation, RequestIdentity, TurnEnvelope, TurnProposal, TurnReceipt,
  canonicalDigest, canonicalJson,
} from "../src/contracts.ts";
import type { AuthorizationPort, CandidateStore, HeadPublisher, NativePort, PolicyPort, ReceiptLookup, Result, StagedCandidate } from "../src/ports.ts";
import { base, candidate, checkpoint, envelope, identity, manifest, proposal, receipt } from "./fixture.ts";

const reject = <T>(status: "STALE_REVISION" | "VALIDATION_FAILED" | "NEEDS_APPROVAL" | "CAPABILITY_MISSING", message: string): Result<T> =>
  ({ ok: false, error: { status, message, retry: "none" } });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const head = HeadExpectation.parse({
  owner_id: base.owner_id, session_id: base.session_id, branch_id: base.branch_id,
  generation_id: base.generation_id, expected_revision: base.expected_revision,
  expected_policy_revision: base.expected_policy_revision,
});
const sameHead = (request: HeadExpectation, expected: HeadExpectation) =>
  request.owner_id === expected.owner_id && request.session_id === expected.session_id &&
  request.branch_id === expected.branch_id && request.generation_id === expected.generation_id &&
  request.expected_revision === expected.expected_revision && request.expected_policy_revision === expected.expected_policy_revision;

const auth: AuthorizationPort = {
  authorize(context, input, plan) {
    const result = !sameHead(input, context.head) || !sameHead(plan, context.head) || context.owner_id !== input.owner_id ||
      input.request_id !== plan.request_id
      ? reject<void>("STALE_REVISION", "Identity or revision mismatch")
      : context.mode !== plan.intent || (context.mode === "PLAY" && input.intent === "editor")
        ? reject<void>("NEEDS_APPROVAL", "Trusted Editor context required")
        : ok(undefined);
    return Promise.resolve(result);
  },
  verifyApproval(context, handle, approval) {
    const eligible = context.owner_id === approval.owner_id && context.mode === "EDITOR" && sameHead(handle, context.head) &&
      canonicalJson(handle) === canonicalJson(approval.candidate) && handle.expires_at > "2026-11-13T00:00:00Z";
    return Promise.resolve(eligible ? ok(undefined) : reject("NEEDS_APPROVAL", "Wrong grant binding"));
  },
};

function memory() {
  let revision = head.expected_revision;
  const staged = new Map<string, StagedCandidate>();
  const receipts = new Map<string, { digest: string; receipt: TurnReceipt }>();
  const candidates: CandidateStore = {
    put(value) {
      staged.set(canonicalJson(value.handle), structuredClone(value));
      return Promise.resolve(ok(undefined));
    },
    get(handle) {
      const value = staged.get(canonicalJson(handle));
      return Promise.resolve(value ? ok(structuredClone(value)) : reject("CAPABILITY_MISSING", "Unknown candidate"));
    },
    discard(handle) {
      staged.delete(canonicalJson(handle));
      return Promise.resolve(ok(undefined));
    },
  };
  const lookup: ReceiptLookup = {
    find(key, digest) {
      const existing = receipts.get(canonicalJson(key));
      if (existing && existing.digest !== digest) return Promise.resolve({ ok: false, error: {
        status: "VALIDATION_FAILED", subtype: "IDEMPOTENCY_CONFLICT", message: "Changed payload", retry: "none",
      } });
      return Promise.resolve(ok(structuredClone(existing?.receipt)));
    },
  };
  const publish: HeadPublisher = {
    compareAndPublish(change) {
      const { handle, checkpoint } = change.candidate;
      const stored = staged.get(canonicalJson(handle));
      if (!sameHead(change.expected, { ...head, expected_revision: revision }) ||
          !sameHead(handle, change.expected) || !stored ||
          canonicalJson(stored.checkpoint) !== canonicalJson(checkpoint) ||
          checkpoint.owner_id !== handle.owner_id || checkpoint.session_id !== handle.session_id ||
          checkpoint.branch_id !== handle.branch_id || checkpoint.generation_id !== handle.generation_id ||
          change.receipt.owner_id !== handle.owner_id || change.receipt.session_id !== handle.session_id ||
          change.receipt.branch_id !== handle.branch_id || change.receipt.generation_id !== handle.generation_id ||
          change.receipt.request_id !== handle.request_id ||
          change.receipt.revision !== checkpoint.revision || checkpoint.revision !== revision + 1 ||
          change.receipt.policy_revision !== checkpoint.policy_revision ||
          change.receipt.post_checkpoint !== checkpoint.checkpoint_id) {
        return Promise.resolve(reject("STALE_REVISION", "Head or staged candidate mismatch"));
      }
      const key = RequestIdentity.parse({
        owner_id: change.receipt.owner_id, session_id: change.receipt.session_id, branch_id: change.receipt.branch_id,
        generation_id: change.receipt.generation_id, request_id: change.receipt.request_id,
      });
      revision = change.receipt.revision;
      receipts.set(canonicalJson(key), { digest: change.request_digest, receipt: structuredClone(change.receipt) });
      staged.delete(canonicalJson(change.candidate.handle));
      return Promise.resolve(ok(structuredClone(change.receipt)));
    },
  };
  return { candidates, lookup, publish };
}

void test("trusted context rejects ownership, scope and revision mismatch and Play promotion", async () => {
  const context = { owner_id: head.owner_id, head, mode: "PLAY" } as const;
  const input = TurnEnvelope.parse(envelope);
  const plan = TurnProposal.parse(proposal);
  assert.deepEqual(await auth.authorize(context, input, plan), ok(undefined));
  for (const change of [
    { owner_id: "owner:other" }, { session_id: "session:other" }, { branch_id: "branch:other" },
    { generation_id: "generation:other" }, { expected_revision: 8 }, { expected_policy_revision: 8 },
  ]) {
    const result = await auth.authorize(context, TurnEnvelope.parse({ ...envelope, ...change }), plan);
    assert.equal(result.ok ? undefined : result.error.status, "STALE_REVISION");
  }
  const result = await auth.authorize(context, TurnEnvelope.parse({ ...envelope, intent: "editor" }), plan);
  assert.equal(result.ok ? undefined : result.error.status, "NEEDS_APPROVAL");
  const elevated = await auth.authorize(context, input, TurnProposal.parse({ ...proposal, intent: "EDITOR" }));
  assert.equal(elevated.ok ? undefined : elevated.error.status, "NEEDS_APPROVAL");
});

void test("approval fixture binds digest, scope, owner and expiry", async () => {
  const context = { owner_id: head.owner_id, head, mode: "EDITOR" } as const;
  const handle = CandidateHandle.parse(candidate);
  const grant = { owner_id: head.owner_id, candidate: handle, grant_id: "grant:one" };
  assert.equal((await auth.verifyApproval(context, handle, grant)).ok, true);
  for (const altered of [
    { proposal_digest: "b".repeat(64) }, { approval_scope: ["scope:other"] },
    { owner_id: "owner:other" }, { expected_revision: 9 }, { expires_at: "2020-01-01T00:00:00Z" },
  ]) assert.equal((await auth.verifyApproval(context, CandidateHandle.parse({ ...candidate, ...altered }), grant)).ok, false);
});

void test("synthetic staging, compare-and-publish, scoped replay, and conflicts", async () => {
  const { candidates, lookup, publish } = memory();
  const handle = CandidateHandle.parse(candidate);
  const staged = { handle, checkpoint: CombinedCheckpoint.parse(checkpoint) };
  const key = RequestIdentity.parse(identity);
  const digest = canonicalDigest(envelope);
  const committed = TurnReceipt.parse(receipt);
  assert.equal(committed.status, "COMMITTED");
  if (committed.status !== "COMMITTED") return;
  await candidates.put(staged);
  assert.deepEqual(await lookup.find(key, digest), ok(undefined));
  assert.equal((await candidates.get(handle)).ok, true);
  assert.equal((await candidates.get(CandidateHandle.parse({ ...candidate, owner_id: "owner:other" }))).ok, false);
  const publication = { expected: head, candidate: staged, receipt: committed, request_digest: digest };
  assert.equal((await publish.compareAndPublish({ ...publication, candidate: {
    ...staged, checkpoint: CombinedCheckpoint.parse({ ...checkpoint, remix_state_ref: "blob:forged" }),
  } })).ok, false);
  assert.equal((await publish.compareAndPublish({
    ...publication, receipt: { ...committed, session_id: RequestIdentity.parse({ ...identity, session_id: "session:other" }).session_id },
  })).ok, false);
  assert.deepEqual(await lookup.find(key, digest), ok(undefined));
  assert.equal((await publish.compareAndPublish(publication)).ok, true);
  assert.equal((await publish.compareAndPublish(publication)).ok, false);
  assert.deepEqual(await lookup.find(key, digest), ok(committed));
  assert.deepEqual(await lookup.find(RequestIdentity.parse({ ...identity, generation_id: "generation:two" }), digest), ok(undefined));
  const result = await lookup.find(key, "b".repeat(64));
  assert.equal(result.ok ? undefined : result.error.subtype, "IDEMPOTENCY_CONFLICT");
  assert.equal((await candidates.get(handle)).ok, false);
});

void test("native and policy ports can be driven by a synthetic room without a VM dependency", async () => {
  type Room = { state: CombinedCheckpoint["native_state"]; actions: number };
  const native: NativePort<Room> = {
    manifest() { return Promise.resolve(ok(CapabilityManifest.parse(manifest))); },
    restore(saved) { return Promise.resolve(ok({ state: structuredClone(saved.native_state), actions: 0 })); },
    capture(room) { return Promise.resolve(ok(structuredClone(room.state))); },
    inspect() { return Promise.resolve(ok(["Fixture Chamber"])); },
    execute(room, operation) {
      if (operation.kind !== "native.character" || room.state.pending_input.kind !== "character") {
        return Promise.resolve(reject("CAPABILITY_MISSING", "Wrong pending input"));
      }
      room.actions++;
      room.state.pending_input = { kind: "line" };
      return Promise.resolve(ok({ pending: room.state.pending_input, effects: [], output: ["Fixture Chamber"], time_cost: 1, outcome: "success" }));
    },
  };
  const policy: PolicyPort = {
    evaluate(_, plan) {
      return Promise.resolve(plan.effect_coverage === "known" ? ok(plan.known_effects) : reject("CAPABILITY_MISSING", "Unknown effects"));
    },
  };
  const saved = CombinedCheckpoint.parse(checkpoint);
  const restored = await native.restore(saved);
  assert.ok(restored.ok);
  const room = restored.value;
  const plan = TurnProposal.parse(proposal);
  const lineOperation = plan.operations[0];
  assert.ok(lineOperation?.kind === "native.line");
  assert.equal((await native.manifest(saved)).ok, true);
  assert.deepEqual(await native.inspect(room, { kind: "inspect.entity", entity_id: "remix:chamber" }), ok(["Fixture Chamber"]));
  assert.equal(room.actions, 0);
  assert.equal((await native.execute(room, lineOperation)).ok, false);
  assert.equal(room.actions, 0);
  assert.equal((await native.execute(room, { kind: "native.character", value: "y" })).ok, true);
  assert.equal(room.actions, 1);
  assert.deepEqual(await native.capture(room), ok({ ...saved.native_state, pending_input: { kind: "line" } }));
  assert.deepEqual(saved.native_state.pending_input, { kind: "character" });
  const sample: unknown = JSON.parse(readFileSync(new URL("../../docs/examples/initial-directive-bundle.v1.json", import.meta.url), "utf8"));
  const bundle = DirectiveBundle.parse(sample);
  const context = { owner_id: head.owner_id, head, mode: "PLAY" } as const;
  assert.deepEqual(await policy.evaluate(bundle, plan, context), ok([]));
  assert.equal((await policy.evaluate(bundle, { ...plan, effect_coverage: "incomplete" }, context)).ok, false);
});