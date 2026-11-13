import { DirectiveBundle, canonicalDigest, canonicalJson } from "../contracts.ts";
import {
  CompilationInput, ModelInterpretation, SupportedSubsetSelection,
} from "./directive-contracts.ts";
import type {
  Clause, CompilationProposal, CompilationResult, Diagnostic, PolicyRule, ProposedRule,
} from "./directive-contracts.ts";
import { exactPartition, normalizedScope, overlaps } from "./directive-scopes.ts";

type Input = ReturnType<typeof CompilationInput.parse>;
type Record = CompilationProposal["clauses"][number];
type Entry = Clause["entries"][number];
type Change = Extract<Entry, { kind: "supersession" }>;
type Prepared = { input: Input; model: ModelInterpretation; clauses: Clause[]; diagnostics: Diagnostic[] };
type Failure = Extract<CompilationResult, { ok: false }>;
type Path = Diagnostic["path"];

function failure(code: Diagnostic["code"], path: Path, message: string, clause_id?: string): Failure {
  return { ok: false, diagnostics: [{ code, path, message, ...(clause_id ? { clause_id } : {}) }] };
}

function schemaFailure(issues: readonly { path: PropertyKey[]; message: string }[], root: string): Failure {
  return { ok: false, diagnostics: issues.map((issue) => ({
    code: "invalid", path: [root, ...issue.path.map((key) => typeof key === "number" ? key : String(key))],
    message: issue.message,
  })) };
}

function graphFailure(graph: Map<string, string[]>, path: Path): Failure | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): Failure | undefined {
    const edges = graph.get(id);
    if (!edges) return failure("invalid_reference", path, `Unknown reference ${id}`);
    if (visiting.has(id)) return failure("cyclic_lineage", path, `Cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of edges) {
      const problem = visit(edge);
      if (problem) return problem;
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) {
    const problem = visit(id);
    if (problem) return problem;
  }
}

function rules(entry: Entry): ProposedRule[] {
  if (entry.kind === "supersession") return [entry.replacement, ...entry.retained];
  return entry.kind === "permission" || entry.kind === "invariant" ? [entry] : [];
}

function isChange(entry: Entry): entry is Change {
  return entry.kind === "supersession";
}

function preferenceId(clauseId: string, index: number): string {
  return `preference:${canonicalDigest([clauseId, index])}`;
}

function prepare(rawInput: unknown, rawModel: unknown): Prepared | Failure {
  const context = CompilationInput.safeParse(rawInput);
  if (!context.success) return schemaFailure(context.error.issues, "context");
  const interpretation = ModelInterpretation.safeParse(rawModel);
  if (!interpretation.success) return schemaFailure(interpretation.error.issues, "interpretation");
  const input = context.data;
  const model = interpretation.data;
  if (model.context_digest !== canonicalDigest(input)) {
    return failure("stale_context", ["interpretation", "context_digest"], "Interpretation belongs to a different context");
  }
  const sources = new Map(input.sources.map((source) => [source.id, [...source.text]]));
  if (sources.size !== input.sources.length || new Set(input.guards.map((guard) => guard.id)).size !== input.guards.length) {
    return failure("duplicate_id", ["context"], "Duplicate source or guard ID");
  }
  const active = new Map(input.active_rules.map((rule) => [rule.id, rule]));
  const lineage = new Map<string, string[]>();
  for (const rule of [...input.history, ...input.active_rules]) {
    if (lineage.has(rule.id) || new Set(rule.supersedes).size !== rule.supersedes.length) {
      return failure("duplicate_id", ["context", "history"], `Duplicate rule ID or lineage edge for ${rule.id}`);
    }
    lineage.set(rule.id, rule.supersedes);
  }
  const badLineage = graphFailure(lineage, ["context", "history"]);
  if (badLineage) return badLineage;

  const clauses = [...model.clauses];
  const dependencies = new Map<string, string[]>();
  const ranges = new Map<string, Clause[]>();
  const claims = new Map<string, number>();
  for (const [index, clause] of clauses.entries()) {
    const path = ["interpretation", "clauses", index];
    if (dependencies.has(clause.id) || clause.id.startsWith("gap:") ||
        new Set(clause.requires).size !== (clause.requires?.length ?? 0)) {
      return failure("duplicate_id", path, "Duplicate or reserved clause ID or duplicate dependency", clause.id);
    }
    dependencies.set(clause.id, clause.requires ?? []);
    const { source_id, start, end } = clause.source;
    const points = sources.get(source_id);
    if (!points || start >= end || end > points.length || points.slice(start, end).join("") !== clause.quote ||
        !/\S/u.test(clause.quote)) {
      return failure("invalid_source", [...path, "source"], "Quote must match a nonblank exact code-point span", clause.id);
    }
    const previous = ranges.get(source_id) ?? [];
    if (previous.some((other) => start < other.source.end && other.source.start < end)) {
      return failure("invalid_source", [...path, "source"], "Clause spans overlap; group related effects in one clause", clause.id);
    }
    previous.push(clause);
    ranges.set(source_id, previous);
    for (const [entryIndex, entry] of clause.entries.entries()) {
      if (isChange(entry)) {
        if (!active.has(entry.old_rule_id)) {
          return failure("invalid_reference", path, `Supersession target ${entry.old_rule_id} is not active`, clause.id);
        }
        claims.set(entry.old_rule_id, (claims.get(entry.old_rule_id) ?? 0) + 1);
      }
      const ids = rules(entry).map((rule) => rule.id);
      if (entry.kind === "preference") ids.push(preferenceId(clause.id, entryIndex));
      for (const id of ids) {
        if (lineage.has(id)) return failure("duplicate_id", path, `Duplicate rule or preference ID ${id}`, clause.id);
        lineage.set(id, isChange(entry) ? [entry.old_rule_id] : []);
      }
    }
  }
  const badDependencies = graphFailure(dependencies, ["interpretation", "clauses"]);
  if (badDependencies) return badDependencies;
  const diagnostics: Diagnostic[] = [];
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  for (const [index, clause] of clauses.entries()) {
    const note = (code: Diagnostic["code"], message: string) =>
      diagnostics.push({ code, path: ["interpretation", "clauses", index], clause_id: clause.id, message });
    const source = sourceById.get(clause.source.source_id);
    if (source?.origin === "play" || source?.provenance !== "caller_recorded") {
      note("untrusted_source", "Source is not a caller-recorded initial or Editor directive");
    }
    for (const entry of clause.entries) {
      if (entry.kind === "unresolved") note("unresolved", entry.reason);
      if (isChange(entry)) {
        const old = active.get(entry.old_rule_id);
        if (!old || claims.get(entry.old_rule_id) !== 1 || !exactPartition(old, entry.replacement, entry.retained)) {
          note("unsafe_partition", `Cannot establish a single exact replacement and retained scope for ${entry.old_rule_id}`);
        }
      }
      for (const rule of rules(entry)) {
        if (rule.kind === "invariant" && !validGuard(input, rule)) {
          note("unsupported_guard", `Unsupported guard or parameters for ${rule.guard.id}`);
        }
      }
    }
    for (const old of input.active_rules) {
      if (conflicts(input, old, clause)) note("policy_conflict", `Proposed effects conflict with active rule ${old.id}`);
    }
  }
  for (const [id, points] of sources) {
    const ordered = (ranges.get(id) ?? []).sort((a, b) => a.source.start - b.source.start);
    let start = 0;
    for (const next of [...ordered, undefined]) {
      const end = next?.source.start ?? points.length;
      const quote = points.slice(start, end).join("");
      if (/\S/u.test(quote)) {
      const clauseId = `gap:${canonicalDigest({ id, start, end })}`;
        clauses.push({ id: clauseId, source: { source_id: id, start, end }, quote, entries: [] });
        diagnostics.push({ code: "uncovered_source", path: ["context", "sources", id], clause_id: clauseId,
          message: "Source text has no model interpretation" });
      }
      start = next?.source.end ?? end;
    }
  }
  return { input, model, clauses, diagnostics };
}

function validGuard(input: Input, rule: Extract<ProposedRule, { kind: "invariant" }>): boolean {
  const definition = input.guards.find((guard) => guard.id === rule.guard.id);
  if (!definition || definition.enforcement !== rule.guard.enforcement) return false;
  const parameters = Object.entries(rule.guard.parameters);
  return parameters.length === Object.keys(definition.parameters).length && parameters.every(([key, value]) => {
    if (!Object.hasOwn(definition.parameters, key)) return false;
    const type = definition.parameters[key];
    if (type === "null") return value === null;
    if (type === "strings" || type === "numbers" || type === "booleans") {
      return Array.isArray(value) && value.every((item) => typeof item === type.slice(0, -1));
    }
    return typeof value === type;
  });
}

function conflicts(input: Input, old: PolicyRule, clause: Clause): boolean {
  return clause.entries.some((entry) => {
    if (isChange(entry) && entry.old_rule_id === old.id) return false;
    if (old.kind === "permission") {
      return rules(entry).some((rule) => rule.kind === "permission" && rule.action === old.action &&
        rule.decision === "allow" && old.decision === "deny" &&
        rule.triggers.some((trigger) => old.triggers.includes(trigger)) && overlaps(rule.scope, old.scope));
    }
    if (!old.protected) return false;
    if (entry.kind === "assignment") {
      const origin = entry.entity_id.startsWith("native:") ? "native" : "remix";
      const guard = input.guards.find((definition) => definition.id === old.guard.id);
      return (!guard || guard.protected_fields.includes(entry.field)) && old.scope.origins.includes(origin) &&
        (!old.scope.entity_ids.length || old.scope.entity_ids.includes(entry.entity_id));
    }
    return rules(entry).some((rule) => rule.kind === "invariant" && !rule.protected &&
      rule.guard.id === old.guard.id && overlaps(rule.scope, old.scope));
  });
}

function build(prepared: Prepared, selected?: Set<string>, parent: string | null = null): CompilationResult {
  const { input, model, clauses } = prepared;
  const diagnostics = [...prepared.diagnostics];
  const blocked = new Set(diagnostics.map((entry) => entry.clause_id));
  // Propagate failures before emission so a clause and all its entries remain atomic.
  for (let changed = true; changed;) {
    changed = false;
    for (const clause of clauses) {
      if (blocked.has(clause.id) || !clause.requires?.some((id) => blocked.has(id))) continue;
      blocked.add(clause.id);
      diagnostics.push({ code: "unsupported_dependency", path: ["interpretation", "clauses", clause.id],
        clause_id: clause.id, message: "A required clause is unresolved" });
      changed = true;
    }
  }
  if (selected) {
    const byId = new Map(clauses.map((clause) => [clause.id, clause]));
    for (const id of selected) {
      const clause = byId.get(id);
      if (!clause || blocked.has(id) || clause.requires?.some((dependency) => !selected.has(dependency))) {
        return failure("unsupported_dependency", ["selection", "clause_ids"], "Selection must contain only supported clauses and all dependencies", id);
      }
    }
  }
  const sources: DirectiveBundle["sources"] = input.sources
    .filter((source) => source.origin !== "play")
    .map(({ id, origin, text }) => ({ id, origin: origin === "initial" ? "initial" : "editor", text }));
  // Play-only input cannot form a v1 directive source. Mixed input keeps Play records
  // exclusively in the enclosing proposal's provenance and diagnostic fields.
  if (!sources.length) return failure("untrusted_source", ["context", "sources"], "No initial or Editor source");
  const bundle: DirectiveBundle = {
    version: "1.0.0", policy_id: input.policy_id, revision: input.head.expected_policy_revision,
    story_sha256: input.story_sha256, sources,
    policy_amendment: { defaults: { fidelity: "preserve_authored_behavior", play_semantics: "attempt",
      unlisted_generation: "deny", unknown_facts: "unresolved", implicit_retcons: false, editor_time: "no_game_time" },
      generation_rules: [], invariants: [] },
    world_patch: [], preferences: [], unresolved: [],
  };
  const lineage: CompilationProposal["lineage"] = [];
  const records: Record[] = [];
  const bundleSourceIds = new Set(sources.map((source) => source.id));
  const active = new Map(input.active_rules.map((rule) => [rule.id, rule]));
  for (const clause of clauses) {
    const { id, source, quote } = clause;
    const status = blocked.has(id) ? "unresolved" : selected && !selected.has(id) ? "excluded" : "supported";
    const record: Record = { id, source, quote, requires: clause.requires ?? [], status, entries: [] };
    records.push(record);
    if (status === "unresolved" && bundleSourceIds.has(source.source_id)) {
      const reason = diagnostics.find((diagnostic) => diagnostic.clause_id === id)?.message ?? "Unresolved clause";
      record.entries.push({ kind: "unresolved", index: bundle.unresolved.length });
      bundle.unresolved.push({ source, reason });
    }
    if (status !== "supported") continue;
    for (const [index, entry] of clause.entries.entries()) {
      if (entry.kind === "assignment") {
        record.entries.push({ kind: "assignment", index: bundle.world_patch.length });
        bundle.world_patch.push({ source, entity_id: entry.entity_id, field: entry.field, value: entry.value });
      }
      if (entry.kind === "preference") {
        record.entries.push({ kind: "preference", index: bundle.preferences.length });
        bundle.preferences.push({ id: preferenceId(id, index), source, text: entry.text });
      }
      const supersedes = isChange(entry) ? [entry.old_rule_id] : [];
      for (const { kind, ...rule } of rules(entry)) {
        const scope = normalizedScope(rule.scope);
        if (kind === "permission" && "triggers" in rule) {
          record.entries.push({ kind, index: bundle.policy_amendment.generation_rules.length });
          bundle.policy_amendment.generation_rules.push({ ...rule, scope, source, supersedes,
            triggers: [...new Set(rule.triggers)].sort() });
        } else if ("guard" in rule) {
          record.entries.push({ kind: "invariant", index: bundle.policy_amendment.invariants.length });
          bundle.policy_amendment.invariants.push({ ...rule, scope, source, supersedes });
        }
      }
      if (isChange(entry)) {
        const old = active.get(entry.old_rule_id);
        if (old) lineage.push({ clause_id: id, old_rule: old, replacement_id: entry.replacement.id,
          retained_ids: entry.retained.map((rule) => rule.id) });
      }
    }
  }
  const parsed = DirectiveBundle.safeParse(bundle);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "bundle");
  const payload = {
    version: "1.0.0", status: "inactive", kind: selected ? "subset" : "full",
    context_digest: model.context_digest, interpretation_digest: canonicalDigest(model),
    parent_digest: parent, head: input.head, sources: input.sources, bundle: parsed.data,
    clauses: records, lineage, diagnostics,
  } as const;
  return { ok: true, value: { ...payload, digest: canonicalDigest(payload) } };
}

export function compileDirective(input: unknown, interpretation: unknown): CompilationResult {
  const prepared = prepare(input, interpretation);
  return "ok" in prepared ? prepared : build(prepared);
}

export function selectDirectiveSubset(input: unknown, interpretation: unknown, selection: unknown): CompilationResult {
  const parsed = SupportedSubsetSelection.safeParse(selection);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "selection");
  const prepared = prepare(input, interpretation);
  if ("ok" in prepared) return prepared;
  const full = build(prepared);
  if (!full.ok) return full;
  if (parsed.data.proposal_digest !== full.value.digest) {
    return failure("stale_context", ["selection", "proposal_digest"], "Selection belongs to a different proposal");
  }
  const selected = new Set(parsed.data.clause_ids);
  if (selected.size !== parsed.data.clause_ids.length) {
    return failure("duplicate_id", ["selection", "clause_ids"], "Duplicate selected clause ID");
  }
  return build(prepared, selected, full.value.digest);
}

/** Format an inactive proposal returned by this compiler. */
export function previewDirective(proposal: CompilationProposal): string {
  const { bundle, clauses, diagnostics, lineage } = proposal;
  const rules = [...bundle.policy_amendment.generation_rules, ...bundle.policy_amendment.invariants];
  return [
    `Inactive ${proposal.kind} proposal (${proposal.digest})`,
    ...clauses.map((clause) => `[${clause.status}] ${clause.id}: ${JSON.stringify(clause.quote)}`),
    ...bundle.world_patch.map((patch) => `One-time assignment: ${patch.entity_id} / ${patch.field} = ${canonicalJson(patch.value)}`),
    ...rules.map((rule) => `Persistent ${"guard" in rule ? "invariant" : "permission"}: ${canonicalJson(rule)}`),
    ...bundle.preferences.map((preference) => `Presentation preference: ${JSON.stringify(preference.text)}`),
    ...lineage.map((change) => `Replace ${change.old_rule.id} with ${change.replacement_id}; retain ${change.retained_ids.join(", ") || "no remainder"}`),
    ...diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.clause_id ?? ""} ${diagnostic.message}`),
  ].join("\n");
}
