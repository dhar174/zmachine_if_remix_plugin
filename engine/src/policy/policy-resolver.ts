import { canonicalDigest, canonicalJson } from "../contracts.ts";
import { compileDirective, selectDirectiveSubset } from "./directive-compiler.ts";
import { ResolverProposal, ResolverSnapshot } from "./resolver-contracts.ts";
import type { ActiveRule, DecisionTrace, EffectPlan, PolicyResolverPort, Resolution, ResolverOperation } from "./resolver-contracts.ts";
import { deriveFootprint, effectKey, ResolutionProblem } from "./resolver-effects.ts";
import type { Footprint, ResolvedEffect } from "./resolver-effects.ts";

const ordered = (ids: Iterable<string>) => [...new Set(ids)].sort();
const same = (left: Parameters<typeof canonicalJson>[0], right: Parameters<typeof canonicalJson>[0]) =>
  canonicalJson(left) === canonicalJson(right);
const invalid = (reason: string, message: string) => new ResolutionProblem("VALIDATION_FAILED", reason, message);

function committedRules(snapshot: ResolverSnapshot): ActiveRule[] {
  const { generation_rules, invariants } = snapshot.policy.policy_amendment;
  return [...generation_rules.map((rule) => ({ ...rule, kind: "permission" as const })),
    ...invariants.map((rule) => ({ ...rule, kind: "invariant" as const }))];
}

function scopeMatch(rule: ActiveRule, effect: ResolvedEffect): "yes" | "no" | "unknown" {
  const { scope } = rule;
  const { entity, surface } = effect;
  if (!scope.origins.includes(entity.origin) || !scope.domains.includes(surface.domain) ||
      (scope.entity_ids.length > 0 && !scope.entity_ids.includes(entity.id))) return "no";
  if (!scope.region_ids.length) return "yes";
  if (entity.region_ids === null) return "unknown";
  return scope.region_ids.some((id) => entity.region_ids?.includes(id)) ? "yes" : "no";
}

function assertSnapshot(snapshot: ResolverSnapshot, rules: ActiveRule[]) {
  const unique = <T>(items: T[], key: (item: T) => string) => new Set(items.map(key)).size === items.length;
  const { policy, head } = snapshot;
  if (policy.story_sha256 !== snapshot.story_sha256 || policy.revision !== head.expected_policy_revision) {
    throw new ResolutionProblem("STALE_REVISION", "policy_snapshot", "The committed policy does not match the active snapshot.");
  }
  if (!unique(snapshot.entities, (entity) => entity.id) || !unique(snapshot.regions, (id) => id) ||
      snapshot.entities.some((entity) => !entity.id.startsWith(entity.origin + ":") ||
        !unique(entity.surfaces, (surface) => surface.field) ||
        entity.region_ids?.some((region) => !snapshot.regions.includes(region)))) {
    throw invalid("projection_identity", "The projection has inconsistent identities or region membership.");
  }
  const history = new Map([...snapshot.history, ...rules].map((rule) => [rule.id, rule.supersedes]));
  const active = new Set(rules.map((rule) => rule.id));
  if (history.size !== snapshot.history.length + rules.length ||
      [...history.values()].some((edges) => new Set(edges).size !== edges.length ||
        edges.some((id) => !history.has(id) || active.has(id)))) {
    throw invalid("committed_lineage", "The policy contains ambiguous, missing, or still-active superseded rules.");
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw invalid("committed_lineage", "Committed rule lineage contains a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of history.get(id) ?? []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of history.keys()) visit(id);
  if (!unique(snapshot.applicability, (window) => window.rule_id) ||
      snapshot.applicability.some((window) => !active.has(window.rule_id) ||
        (window.until_turn !== null && window.from_turn >= window.until_turn))) {
    throw invalid("rule_applicability", "Rule time windows are inconsistent with committed policy.");
  }
}

function prepareAmendment(snapshot: ResolverSnapshot, proposal: ResolverProposal, rules: ActiveRule[]):
{ operations: ResolverOperation[]; candidate: EffectPlan["amendment"]; rules: ActiveRule[] } {
  const amendment = proposal.amendment;
  if (!amendment) return { operations: proposal.operations, candidate: null, rules };
  if (snapshot.mode !== "EDITOR") {
    throw new ResolutionProblem("NEEDS_APPROVAL", "editor_mode", "An amendment requires trusted Editor mode.");
  }
  const context = snapshot.compiler_context;
  const byId = (a: ActiveRule, b: ActiveRule) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (!context || !same(context.head, snapshot.head) || context.story_sha256 !== snapshot.story_sha256 ||
      context.policy_id !== snapshot.policy.policy_id || !same([...context.active_rules].sort(byId), [...rules].sort(byId)) ||
      !same(context.history, snapshot.history)) {
    throw new ResolutionProblem("STALE_REVISION", "amendment_context", "The amendment compiler context no longer matches committed policy.");
  }
  const verified = amendment.selection
    ? selectDirectiveSubset(context, amendment.interpretation, amendment.selection)
    : compileDirective(context, amendment.interpretation);
  if (!verified.ok || !same(verified.value, amendment.compiled)) {
    throw invalid("amendment_integrity", "The complete compiled proposal does not match a fresh compilation.");
  }
  const compiled = verified.value;
  if (compiled.kind === "full" && compiled.clauses.some(({ status }) => status !== "supported")) {
    throw new ResolutionProblem("NEEDS_CLARIFICATION", "amendment_subset", "Select a coherent supported subset before approval.");
  }
  const { generation_rules, invariants } = compiled.bundle.policy_amendment;
  const replacements: ActiveRule[] = [
    ...generation_rules.map((rule) => ({ ...rule, kind: "permission" as const })),
    ...invariants.map((rule) => ({ ...rule, kind: "invariant" as const })),
  ];
  const superseded = new Map(compiled.lineage.map((entry) => [entry.old_rule.id, entry]));
  const candidateRules = [...rules.filter((rule) => !superseded.has(rule.id)), ...replacements].sort(byId);
  const applicability = snapshot.applicability.flatMap((window) => {
    const entry = superseded.get(window.rule_id);
    return entry ? [entry.replacement_id, ...entry.retained_ids].map((rule_id) => ({ ...window, rule_id })) : [window];
  });
  // New grants cannot authorize the same candidate's one-time effects. Verified
  // invariant replacements govern the affected patch while retained pieces survive.
  const evaluationRules = [...rules.filter((rule) => rule.kind === "permission" || !superseded.has(rule.id)),
    ...replacements.filter((rule) => rule.kind === "invariant")];
  return {
    candidate: { compiled, active_rules: candidateRules,
      applicability, preferences: [...snapshot.policy.preferences, ...compiled.bundle.preferences] },
    rules: evaluationRules,
    operations: compiled.bundle.world_patch.map(({ entity_id, field, value }) => ({ kind: "remix.assign", entity_id, field, value })),
  };
}

function structuralGuard(rule: Extract<ActiveRule, { kind: "invariant" }>,
  effect: ResolvedEffect, operation: ResolverOperation): boolean {
  const parameters = rule.guard.parameters;
  if (rule.guard.id === "inventory.possession" && typeof parameters.holder === "string" &&
      typeof parameters.item === "string" && Object.keys(parameters).length === 2) {
    if (effect.ref.field !== "inventory:holder" || effect.entity.id !== parameters.item) return true;
    return operation.kind === "inventory.transfer" && operation.item === parameters.item && operation.to === parameters.holder;
  }
  if (rule.guard.id === "field.unchanged" && typeof parameters.field === "string" && Object.keys(parameters).length === 1) {
    if (effect.ref.field !== parameters.field) return true;
    return operation.kind === "remix.assign" && operation.entity_id === effect.ref.entity_id &&
      operation.field === effect.ref.field && effect.surface.fact.state === "present" &&
      same(effect.surface.fact.value, operation.value);
  }
  throw new ResolutionProblem("CAPABILITY_MISSING", "structural_guard", "The structural guard or its parameters are unsupported.");
}

function checkPolicy(snapshot: ResolverSnapshot, operation: ResolverOperation, footprint: Footprint,
  rules: ActiveRule[], windows: ResolverSnapshot["applicability"], digest: string,
  ruleIds: Set<string>, evidenceIds: Set<string>, semantic: DecisionTrace["semantic"][number][]) {
  const active = rules.filter(({ id }) => {
    const window = windows.find((window) => window.rule_id === id);
    const turn = snapshot.clock.overlay_turn;
    return !window || (window.from_turn <= turn && (window.until_turn === null || turn < window.until_turn));
  });
  for (const effect of footprint.effects.filter(({ ref }) => ref.change === "write")) {
    const matches = active.map((rule) => ({ rule, match: scopeMatch(rule, effect) })).filter(({ match }) => match !== "no");
    if (footprint.action !== null) {
      const permissions = matches.filter(({ rule }) => rule.kind === "permission" &&
        rule.action === footprint.action && rule.triggers.includes(snapshot.trigger));
      permissions.forEach(({ rule }) => ruleIds.add(rule.id));
      if (permissions.some(({ rule, match }) => rule.kind === "permission" && rule.decision === "deny" && match === "yes")) {
        throw new ResolutionProblem("POLICY_CONFLICT", "matching_deny", "A matching permission rule denies a required effect.");
      }
      if (permissions.some(({ rule, match }) => rule.kind === "permission" && rule.decision === "deny" && match === "unknown")) {
        throw new ResolutionProblem("NEEDS_CLARIFICATION", "unknown_scope", "Unknown region membership may overlap a denial.");
      }
      if (snapshot.mode !== "EDITOR" &&
          !permissions.some(({ rule, match }) => rule.kind === "permission" && rule.decision === "allow" && match === "yes")) {
        if (permissions.some(({ match }) => match === "unknown")) {
          throw new ResolutionProblem("NEEDS_CLARIFICATION", "unknown_scope", "Unknown region membership cannot establish permission.");
        }
        throw new ResolutionProblem("POLICY_CONFLICT", "no_allowance", "A required effect has no matching generation allowance.");
      }
    }
    for (const { rule, match } of matches) {
      if (rule.kind !== "invariant") continue;
      ruleIds.add(rule.id);
      if (match === "unknown") {
        throw new ResolutionProblem("NEEDS_CLARIFICATION", "unknown_protection", "Unknown region membership may overlap an invariant.");
      }
      if (rule.guard.enforcement === "structural") {
        if (!structuralGuard(rule, effect, operation)) {
          throw new ResolutionProblem("POLICY_CONFLICT", "invariant_violation", "A required effect violates a structural invariant.");
        }
        continue;
      }
      const evidence = snapshot.guard_evidence.filter((entry) => entry.rule_id === rule.id &&
        entry.operation_digest === canonicalDigest(operation) && entry.proposal_digest === digest &&
        entry.kind === rule.guard.enforcement);
      if (evidence.length > 1) throw invalid("guard_evidence", "Guard evidence is ambiguous.");
      const result = evidence[0];
      const verdict = result?.confidence === "uncertain" && result.verdict === "satisfied" ? "uncertain" : result?.verdict;
      if (result) evidenceIds.add(result.evidence_id);
      if (rule.guard.enforcement === "semantic") {
        const bestEffort = effect.surface.risk === "low_reversible" && !rule.protected && verdict !== "violated";
        const outcome = bestEffort && verdict !== "satisfied" ? "best_effort" : verdict ?? "uncertain";
        const entry = { rule_id: rule.id, evidence_id: result?.evidence_id ?? "resolver:missing_semantic_evidence",
          confidence: result?.confidence ?? "uncertain", outcome } as const;
        if (!semantic.some((prior) => same(prior, entry))) semantic.push(entry);
        if (outcome === "best_effort") continue;
      }
      if (verdict === "violated") {
        throw new ResolutionProblem("POLICY_CONFLICT", "guard_violation", "A guard reports a conflict.");
      }
      if (verdict !== "satisfied") {
        throw new ResolutionProblem(rule.guard.enforcement === "adapter" ? "CAPABILITY_MISSING" : "NEEDS_CLARIFICATION",
          "guard_unresolved", "A required guard has no conclusive evidence.");
      }
    }
  }
}

function evaluate(rawSnapshot: unknown, rawProposal: unknown, preview: boolean): Resolution {
  const ruleIds = new Set<string>();
  const capabilityIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const semantic: DecisionTrace["semantic"][number][] = [];
  const trace = (): DecisionTrace => ({
    rule_ids: ordered(ruleIds), capability_ids: ordered(capabilityIds), evidence_ids: ordered(evidenceIds), semantic,
  });
  try {
    const context = ResolverSnapshot.safeParse(rawSnapshot);
    const request = ResolverProposal.safeParse(rawProposal);
    if (!context.success || !request.success) throw invalid("schema", "The resolver input does not match its versioned contract.");
    const snapshot = context.data;
    const proposal = request.data;
    const { head } = snapshot;
    if (head.owner_id !== proposal.owner_id || head.session_id !== proposal.session_id || head.branch_id !== proposal.branch_id) {
      throw invalid("identity", "The proposal belongs to a different owner, session, or branch.");
    }
    if (head.generation_id !== proposal.generation_id || head.expected_revision !== proposal.expected_revision ||
        head.expected_policy_revision !== proposal.expected_policy_revision) {
      throw new ResolutionProblem("STALE_REVISION", "proposal_revision", "The proposal is stale.");
    }
    if (snapshot.mode !== proposal.mode) {
      throw new ResolutionProblem("NEEDS_APPROVAL", "mode_mismatch", "The requested mode does not match trusted authority.");
    }
    const rules = committedRules(snapshot);
    assertSnapshot(snapshot, rules);
    const amendment = prepareAmendment(snapshot, proposal, rules);
    const digest = canonicalDigest(proposal);
    if (!preview && snapshot.mode === "EDITOR" && (proposal.amendment || amendment.operations.some((op) => op.kind !== "inspect.entity"))) {
      if (snapshot.editor_authority?.proposal_digest !== digest) {
        throw new ResolutionProblem("NEEDS_APPROVAL", "exact_authority", "The exact proposal needs verified Editor authority.");
      }
      evidenceIds.add(snapshot.editor_authority.evidence_id);
    }
    if (amendment.operations.some((op) => op.kind === "remix.assign" && snapshot.mode !== "EDITOR")) {
      throw new ResolutionProblem("NEEDS_APPROVAL", "editor_assignment", "Direct assignments require Editor authority.");
    }
    if (amendment.operations.some((op) => op.kind === "native.line" || op.kind === "native.character") &&
        (amendment.operations.length !== 1 || snapshot.mode !== "PLAY" || snapshot.trigger !== "player_attempt")) {
      throw new ResolutionProblem("NEEDS_CLARIFICATION", "native_subturn", "Resolve native input as one ordinary Play subturn.");
    }
    const inspections = amendment.operations.filter((op) => op.kind === "inspect.entity").length;
    if (inspections > 0 && inspections !== amendment.operations.length) {
      throw new ResolutionProblem("NEEDS_CLARIFICATION", "mixed_inspection", "Resolve read-only inspection separately from world changes.");
    }
    const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    const accumulated = new Map<string, "read" | "write">();
    const operations: EffectPlan["operations"][number][] = [];
    const routes = new Set<EffectPlan["route"]>();
    for (const operation of amendment.operations) {
      const footprint = deriveFootprint(snapshot, entities, operation, { capabilityIds, evidenceIds });
      routes.add(footprint.route);
      checkPolicy(snapshot, operation, footprint, amendment.rules,
        [...snapshot.applicability, ...(amendment.candidate?.applicability ?? [])], digest, ruleIds, evidenceIds, semantic);
      for (const { ref } of footprint.effects) {
        const key = canonicalJson([ref.entity_id, ref.field]);
        if (accumulated.has(key) && (ref.change === "write" || accumulated.get(key) === "write")) {
          // Duplicate read/write references inside one operation are collapsed below.
          throw new ResolutionProblem("NEEDS_CLARIFICATION", "dependent_subturn", "Resolve operations that change each other's inputs as separate subturns.");
        }
      }
      for (const { ref } of footprint.effects) {
        const key = canonicalJson([ref.entity_id, ref.field]);
        if (accumulated.get(key) !== "write") accumulated.set(key, ref.change);
      }
      operations.push({ operation, effects: footprint.effects.map(({ ref }) => ref), capability_ids: footprint.capability_ids });
    }
    if (routes.has("native") && routes.size > 1) {
      throw new ResolutionProblem("CAPABILITY_MISSING", "unregistered_combination", "Independent native and remix operations lack a registered bridge.");
    }
    const declared = proposal.declared_effects.map(effectKey).sort();
    if (!same(declared, ordered(operations.flatMap(({ effects }) => effects.map(effectKey))))) {
      throw invalid("declared_footprint", "The declared effects do not match the complete derived footprint.");
    }
    const route = routes.has("bridged") ? "bridged" : routes.has("native") ? "native" : "remix";
    const time = snapshot.mode === "EDITOR" || operations.every(({ operation }) => operation.kind === "inspect.entity")
      ? "none" : operations.some(({ operation }) => operation.kind === "native.line" || operation.kind === "native.character")
        ? "native" : "overlay";
    return { ok: true, plan: { version: "1.0.0", head, request_id: proposal.request_id, proposal_digest: digest,
      route, time, operations, amendment: amendment.candidate, trace: trace() } };
  } catch (error) {
    if (!(error instanceof ResolutionProblem)) throw error;
    error.evidence_ids.forEach((id) => evidenceIds.add(id));
    return { ok: false, error: { status: error.status, reason: error.reason, message: error.message,
      retry: error.status === "STALE_REVISION" ? "refresh" : "none" }, trace: trace() };
  }
}

export function resolvePolicy(snapshot: unknown, proposal: unknown): Resolution {
  return evaluate(snapshot, proposal, false);
}

/** Server-side preview only. Its result carries neither a plan nor authority. */
export function previewPolicy(snapshot: unknown, proposal: unknown):
  { ok: true; preview: Omit<EffectPlan, "version"> } | Extract<Resolution, { ok: false }> {
  const result = evaluate(snapshot, proposal, true);
  if (!result.ok) return result;
  const { version: schemaVersion, ...preview } = result.plan;
  void schemaVersion;
  return { ok: true, preview };
}

export const policyResolver: PolicyResolverPort = { resolve: resolvePolicy };
