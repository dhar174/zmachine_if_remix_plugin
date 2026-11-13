import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
  CandidateHandle, CapabilityManifest, CombinedCheckpoint, DirectiveBundle, PendingInput,
  TurnEnvelope, TurnProposal, TurnReceipt, canonicalDigest, canonicalJson,
} from "../src/contracts.ts";
import { candidate, checkpoint, envelope, manifest, proposal, receipt } from "./fixture.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const bundleExample = read("../../docs/examples/initial-directive-bundle.v1.json");


void test("versioned turn and state records round-trip and reject unknown fields and versions", () => {
  for (const [schema, input] of [
    [TurnEnvelope, envelope], [TurnProposal, proposal], [TurnReceipt, receipt],
    [CandidateHandle, candidate], [CombinedCheckpoint, checkpoint], [CapabilityManifest, manifest],
    [DirectiveBundle, DirectiveBundle.parse(bundleExample)],
  ] as const) {
    assert.deepEqual(schema.parse(JSON.parse(JSON.stringify(input))), input);
    assert.equal(schema.safeParse({ ...input, version: "2.0.0" }).success, false);
    assert.equal(schema.safeParse({ ...input, extra: true }).success, false);
  }
});

void test("untrusted mode, approval, origin and unknown operations fail explicitly", () => {
  const { input: ignored, ...missing } = envelope;
  assert.ok(ignored);
  for (const input of [
    missing, { ...envelope, is_editor: true }, { ...envelope, approved: true },
    { ...envelope, origin: "editor" }, { ...envelope, owner_id: "room name" },
    { ...envelope, expected_revision: "2" }, { ...envelope, input: { kind: "line", text: 42 } },
  ]) assert.equal(TurnEnvelope.safeParse(input).success, false);
  assert.equal(TurnProposal.safeParse({ ...proposal, operations: [{ kind: "native.teleport" }] }).success, false);
  assert.equal(TurnProposal.safeParse({ ...proposal, operations: [{ kind: "native.line", text: "look", origin: "remix" }] }).success, false);
  assert.equal(CombinedCheckpoint.safeParse({ ...checkpoint, approval: "grant:one" }).success, false);
});

void test("line and character inputs and pending boundaries are distinct", () => {
  assert.equal(TurnEnvelope.safeParse({ ...envelope, input: { kind: "character", value: "🗝" } }).success, true);
  assert.equal(TurnEnvelope.safeParse({ ...envelope, input: { kind: "character", value: "look" } }).success, false);
  assert.equal(PendingInput.safeParse({ kind: "line", value: "x" }).success, false);
  assert.equal(PendingInput.safeParse({ kind: "character" }).success, true);
});

void test("same-key conflict is distinct from committed fictional failure", () => {
  const common = Object.fromEntries(["version", "owner_id", "session_id", "branch_id", "generation_id", "request_id", "warnings"].map(
    (key) => [key, Reflect.get(receipt, key) as unknown],
  ));
  const conflict = { ...common, status: "VALIDATION_FAILED", subtype: "IDEMPOTENCY_CONFLICT", message: "Different payload", retry: "none" };
  assert.equal(TurnReceipt.safeParse(conflict).success, true);
  assert.equal(TurnReceipt.safeParse({ ...conflict, status: "ABORTED" }).success, false);
  assert.equal(TurnReceipt.parse(receipt).status, "COMMITTED");
});

void test("canonical serialization preserves Unicode, array order, and numeric-looking key order", () => {
  const value = { "2": "é", "10": "🗝", sequence: ["z", "a"] };
  assert.equal(canonicalJson(value), '{"10":"🗝","2":"é","sequence":["z","a"]}');
  assert.equal(canonicalDigest(value), canonicalDigest({ sequence: ["z", "a"], "10": "🗝", "2": "é" }));
  assert.notEqual(canonicalDigest(value), canonicalDigest({ ...value, sequence: ["a", "z"] }));
});

void test("v1 directive fixture preserves original source mappings and rejects invalid spans", () => {
  const original = z.object({
    sources: z.array(z.json()), preferences: z.array(z.json()),
    defaults: z.json(), generation_rules: z.array(z.json()), invariants: z.array(z.json()),
  }).parse(read("../../docs/examples/initial-policy.json"));
  const v1 = DirectiveBundle.parse(bundleExample);
  assert.deepEqual(v1.sources, original.sources);
  assert.deepEqual(v1.preferences, original.preferences);
  assert.deepEqual(v1.policy_amendment, {
    defaults: original.defaults, generation_rules: original.generation_rules, invariants: original.invariants,
  });
  const sources = [{ id: "unicode", origin: "initial", text: "A🗝é" }];
  const bundle = { ...v1, sources, preferences: [], policy_amendment: { ...v1.policy_amendment, generation_rules: [], invariants: [] } };
  const clause = { source: { source_id: "unicode", start: 1, end: 3 }, reason: "Unclear" };
  assert.equal(DirectiveBundle.safeParse({ ...bundle, unresolved: [clause] }).success, true);
  assert.equal(DirectiveBundle.safeParse({ ...bundle, unresolved: [{ ...clause, source: { ...clause.source, end: 4 } }] }).success, false);
  assert.equal(DirectiveBundle.safeParse({ ...bundle, sources: [...sources, ...sources] }).success, false);
});

void test("proposal references accept actual policy and guard IDs", () => {
  const bundle = DirectiveBundle.parse(bundleExample);
  const rules = bundle.policy_amendment.generation_rules.map((rule) => rule.id);
  const guards = bundle.policy_amendment.invariants.map((rule) => rule.guard.id);
  assert.ok(rules.length && guards.length);
  const parsed = TurnProposal.parse({ ...proposal, rule_ids: rules, guard_ids: guards });
  assert.deepEqual(parsed.rule_ids, rules);
  assert.deepEqual(parsed.guard_ids, guards);
  assert.equal(TurnProposal.safeParse({ ...proposal, rule_ids: ["display label"] }).success, false);
});

void test("explicitly undefined optional record fields serialize as omitted", () => {
  const request = TurnEnvelope.parse({ ...envelope, intent: undefined });
  assert.deepEqual(JSON.parse(canonicalJson(request)), envelope);
  assert.equal(canonicalDigest(request), canonicalDigest(TurnEnvelope.parse(envelope)));
  const rejected = {
    version: receipt.version, owner_id: receipt.owner_id, session_id: receipt.session_id,
    branch_id: receipt.branch_id, generation_id: receipt.generation_id, request_id: receipt.request_id,
    warnings: [], status: "VALIDATION_FAILED", message: "Invalid", retry: "none",
  };
  const parsed = TurnReceipt.parse({ ...rejected, subtype: undefined });
  assert.deepEqual(JSON.parse(canonicalJson(parsed)), rejected);
  assert.equal(canonicalDigest(parsed), canonicalDigest(TurnReceipt.parse(rejected)));
});

void test("directive rejects duplicate policy entries and non-finite guard parameters", () => {
  const bundle = DirectiveBundle.parse(bundleExample);
  const rule = bundle.policy_amendment.generation_rules[0];
  const invariant = bundle.policy_amendment.invariants[0];
  const preference = bundle.preferences[0];
  assert.ok(rule && invariant && preference);
  for (const policy_amendment of [
    { ...bundle.policy_amendment, generation_rules: [rule, rule] },
    { ...bundle.policy_amendment, invariants: [invariant, { ...invariant, id: rule.id }] },
    ...[NaN, Infinity, -Infinity].map((amount) => ({
      ...bundle.policy_amendment,
      invariants: [{ ...invariant, guard: { ...invariant.guard, parameters: { amount } } }],
    })),
  ]) assert.equal(DirectiveBundle.safeParse({ ...bundle, policy_amendment }).success, false);
  assert.equal(DirectiveBundle.safeParse({ ...bundle, preferences: [preference, preference] }).success, false);
});
