import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DirectiveBundle, canonicalDigest } from "../src/contracts.ts";
import { compileDirective, previewDirective, selectDirectiveSubset } from "../src/policy/directive-compiler.ts";
import { CompilationResult, modelInterpretationJsonSchema } from "../src/policy/directive-contracts.ts";
import type { CompilationInput, ModelInterpretation } from "../src/policy/directive-contracts.ts";

const source = { id: "s1", message_id: "message:1", origin: "initial", provenance: "caller_recorded",
  text: "Give me a key 🗝.\r\nGive me a key 🗝. e\u0301?" } as const;
const input = {
  version: "1.0.0", policy_id: "policy:test", story_sha256: "a".repeat(64),
  head: { owner_id: "owner:test", session_id: "session:test", branch_id: "branch:test",
    generation_id: "generation:test", expected_revision: 0, expected_policy_revision: 0 },
  sources: [source], active_rules: [], history: [], guards: [],
} satisfies CompilationInput;
const quote = "Give me a key 🗝.";
const clause = {
  id: "c1", source: { source_id: "s1", start: 0, end: [...quote].length }, quote,
  entries: [{ kind: "assignment", entity_id: "remix:player", field: "inventory:key", value: true }],
} satisfies ModelInterpretation["clauses"][number];
const model = { version: "1.0.0", context_digest: canonicalDigest(input), clauses: [clause] } satisfies ModelInterpretation;

void test("binds exact Unicode source, exposes gaps, and selects only named supported effects", () => {
  const before = structuredClone({ input, model });
  const full = compileDirective(input, model);
  assert.ok(full.ok);
  assert.equal(full.value.bundle.sources[0]?.text, source.text);
  assert.equal(full.value.bundle.world_patch.length, 1);
  assert.equal(full.value.bundle.policy_amendment.invariants.length, 0);
  const gap = full.value.clauses.find((entry) => entry.status === "unresolved");
  assert.ok(gap);
  assert.ok(gap.quote.includes(quote));
  const subset = selectDirectiveSubset(input, model, {
    version: "1.0.0", proposal_digest: full.value.digest, clause_ids: ["c1"],
  });
  assert.ok(subset.ok);
  assert.equal(subset.value.bundle.world_patch.length, 1);
  assert.notEqual(full.value.digest, subset.value.digest);
  assert.equal(subset.value.clauses.find((entry) => entry.id === gap.id)?.status, "unresolved");
  assert.deepEqual({ input, model }, before);
});

const scope = { origins: ["remix"], entity_ids: ["remix:guard", "remix:keeper"], region_ids: [],
  domains: ["characterization"] } satisfies CompilationInput["active_rules"][number]["scope"];
const original = {
  kind: "invariant", id: "protect", source: { source_id: "earlier", start: 0, end: 1 }, scope,
  supersedes: [], protected: true, guard: { id: "personality", enforcement: "structural", parameters: { stable: true } },
} satisfies CompilationInput["active_rules"][number];
const guards = [{ id: "personality", enforcement: "structural", parameters: { stable: "boolean" },
  protected_fields: ["character:personality"] }] satisfies CompilationInput["guards"];

function scenario(text: string, entries: typeof clause.entries | ModelInterpretation["clauses"][number]["entries"],
  overrides: Partial<CompilationInput> = {}) {
  const context = { ...input, sources: [{ ...source, origin: "editor" as const, text }], ...overrides };
  const interpretation = { ...model, context_digest: canonicalDigest(context), clauses: [
    { ...clause, quote: text, source: { ...clause.source, end: [...text].length }, entries },
  ] };
  return { context, interpretation, result: compileDirective(context, interpretation) };
}

void test("distinguishes explicit lasting invariants and prospective generation restrictions", () => {
  const { source: previousSource, supersedes: previousLineage, ...rule } = original;
  assert.ok(previousSource && previousLineage);
  const { result } = scenario("Always preserve the guard's personality. Stop generating shops.", [rule, {
    kind: "permission", id: "no-shops", scope: { ...scope, domains: ["topology"] },
    action: "generate.location", decision: "deny", triggers: ["player_attempt"],
  }], { guards });
  assert.ok(result.ok);
  assert.equal(result.value.bundle.policy_amendment.invariants.length, 1);
  assert.equal(result.value.bundle.policy_amendment.generation_rules[0]?.decision, "deny");
  assert.deepEqual(result.value.bundle.world_patch, []);
});

void test("broad proposals leave protections intact and scoped replacement verifies every retained part", () => {
  const { source: previousSource, supersedes: previousLineage, ...rule } = original;
  assert.ok(previousSource && previousLineage);
  const options = { active_rules: [original], guards };
  const broad = scenario("Make everyone friendlier.", [{
    kind: "assignment", entity_id: "remix:guard", field: "character:personality", value: "friendly",
  }], options).result;
  assert.ok(broad.ok);
  assert.equal(broad.value.diagnostics[0]?.code, "policy_conflict");
  assert.deepEqual(broad.value.bundle.world_patch, []);

  const replacement = { ...rule, id: "guard-replacement", protected: false,
    scope: { ...scope, entity_ids: ["remix:guard"] } };
  const remainder = { ...rule, id: "keeper-retained", scope: { ...scope, entity_ids: ["remix:keeper"] } };
  const supersession = { kind: "supersession", old_rule_id: original.id, replacement, retained: [remainder] } as const;
  const valid = scenario("Remove only the guard's personality protection.",
    [{ ...supersession, retained: [remainder] }], options).result;
  assert.ok(valid.ok);
  assert.equal(valid.value.lineage[0]?.old_rule.id, original.id);
  assert.deepEqual(valid.value.bundle.policy_amendment.invariants.map(({ id, protected: protectedRule }) =>
    [id, protectedRule]), [["guard-replacement", false], ["keeper-retained", true]]);
  for (const invalid of [
    { ...supersession, retained: [] },
    { ...supersession, retained: [{ ...remainder, protected: false }] },
    { ...supersession, retained: [{ ...rule, id: "overlapping-retained", scope: replacement.scope }] },
  ]) {
    const { result } = scenario("Only the guard.", [invalid], options);
    assert.ok(result.ok);
    assert.equal(result.value.diagnostics[0]?.code, "unsafe_partition");
    assert.deepEqual(result.value.lineage, []);
  }
  const wildcard = scenario("Only the guard.", [{ ...supersession, retained: [remainder] }], {
    guards, active_rules: [{ ...original, scope: { ...scope, entity_ids: [] } }],
  }).result;
  assert.ok(wildcard.ok);
  assert.equal(wildcard.value.diagnostics[0]?.code, "unsafe_partition");
  const dangling = scenario("Only the guard.", [{ ...supersession, retained: [remainder] }], { guards }).result;
  assert.equal(dangling.ok, false);
  assert.equal(dangling.diagnostics[0]?.code, "invalid_reference");
});

void test("rejects historical cycles and protects subset dependency and digest boundaries", () => {
  const cycle = scenario(quote, clause.entries, { history: [
    { id: "a", supersedes: ["b"] }, { id: "b", supersedes: ["a"] },
  ] }).result;
  assert.equal(cycle.ok, false);
  assert.equal(cycle.diagnostics[0]?.code, "cyclic_lineage");
  const secondStart = [...quote].length + 2;
  const second = { ...clause, id: "c2", requires: ["c1"],
    source: { ...clause.source, start: secondStart, end: secondStart + [...quote].length },
    entries: [{ kind: "preference", text: "Keep descriptions brief." }],
  } satisfies ModelInterpretation["clauses"][number];
  const proposal = { ...model, clauses: [clause, second] };
  const full = compileDirective(input, proposal);
  assert.ok(full.ok);
  const choose = (clause_ids: string[], proposal_digest = full.value.digest) =>
    selectDirectiveSubset(input, proposal, { version: "1.0.0", proposal_digest, clause_ids });
  assert.equal(choose(["c2"]).ok, false);
  assert.equal(choose(["c1", "unknown"]).ok, false);
  assert.equal(choose(["c1"], "b".repeat(64)).ok, false);
  const all = choose(["c1", "c2"]);
  const reordered = choose(["c2", "c1"]);
  assert.ok(all.ok && reordered.ok);
  assert.equal(all.value.digest, reordered.value.digest);
  const subset = choose(["c1"]);
  assert.ok(subset.ok);
  assert.equal(subset.value.bundle.preferences.length, 0);
  assert.equal(subset.value.clauses.find(({ id }) => id === "c2")?.status, "excluded");
  assert.match(previewDirective(subset.value), /Inactive subset proposal/);
  assert.equal(CompilationResult.safeParse(subset).success, true);
});

void test("the published example reproduces both previews", () => {
  const example = JSON.parse(readFileSync(new URL(
    "../../docs/examples/directive-compilation.v1.json", import.meta.url,
  ), "utf8")) as { context: unknown; interpretation: unknown; selection: unknown; full_preview: string; subset_preview: string };
  const full = compileDirective(example.context, example.interpretation);
  const subset = selectDirectiveSubset(example.context, example.interpretation, example.selection);
  assert.ok(full.ok && subset.ok);
  assert.equal(previewDirective(full.value), example.full_preview);
  assert.equal(previewDirective(subset.value), example.subset_preview);
});

void test("does not promote Play or unverified provenance and does not accept unsupported guards", () => {
  for (const untrusted of [
    { ...source, text: quote, origin: "play" as const }, { ...source, text: quote, provenance: "unverified" as const },
  ]) {
    const { result } = scenario(quote, clause.entries, { sources: [untrusted] });
    if (result.ok) {
      assert.equal(result.value.diagnostics[0]?.code, "untrusted_source");
      assert.deepEqual(result.value.bundle.world_patch, []);
    } else {
      assert.equal(result.diagnostics[0]?.code, "untrusted_source");
    }
  }
  const { source: previousSource, supersedes: previousLineage, ...rule } = original;
  assert.ok(previousSource && previousLineage);
  const invalid = { ...rule, guard: { ...rule.guard, parameters: { stable: 1 } } };
  const { result } = scenario("Keep the original personality.", [invalid], { guards });
  assert.ok(result.ok);
  assert.equal(result.value.diagnostics[0]?.code, "unsupported_guard");
});

void test("the published schema matches the generated model-facing contract", () => {
  const schema: unknown = JSON.parse(readFileSync(new URL(
    "../../docs/contracts/directive-interpretation.v1.schema.json", import.meta.url,
  ), "utf8"));
  assert.deepEqual(schema, modelInterpretationJsonSchema);
});

void test("reports the omitted generation restriction in the historical #14 sample", () => {
  const sample = DirectiveBundle.parse(JSON.parse(readFileSync(new URL(
    "../../docs/examples/initial-directive-bundle.v1.json", import.meta.url,
  ), "utf8")));
  const [first] = sample.sources;
  assert.ok(first);
  const context = { ...input, sources: [{ ...first, message_id: "message:sample", provenance: "caller_recorded" }] };
  const seen = new Set<string>();
  const clauses = [];
  for (const rule of [...sample.policy_amendment.generation_rules, ...sample.policy_amendment.invariants, ...sample.preferences]) {
    const key = `${rule.source.start}:${rule.source.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push({ id: rule.id, source: rule.source, quote: [...first.text].slice(rule.source.start, rule.source.end).join(""),
      entries: [{ kind: "unresolved", reason: "Historical mapping supplied only as a coverage fixture" }] });
  }
  const result = compileDirective(context, { version: "1.0.0", context_digest: canonicalDigest(context), clauses });
  assert.ok(result.ok);
  assert.ok(result.value.clauses.some((entry) => entry.id.startsWith("gap:") &&
    entry.quote.includes("Do not invent content elsewhere") && entry.status === "unresolved"));
});

void test("rejects forged source claims, wrong offsets, stale context, and unknown authority fields", () => {
  for (const proposal of [
    { ...model, approved: true },
    { ...model, context_digest: "b".repeat(64) },
    { ...model, clauses: [{ ...clause, quote: "fabricated" }] },
    { ...model, clauses: [{ ...clause, source: { ...clause.source, end: clause.source.end + 1 } }] },
    { ...model, clauses: [clause, clause] },
  ]) assert.equal(compileDirective(input, proposal).ok, false);
});
