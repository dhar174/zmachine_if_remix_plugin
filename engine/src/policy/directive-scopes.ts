import { canonicalJson } from "../contracts.ts";
import type { PolicyRule, ProposedRule } from "./directive-contracts.ts";

type Scope = PolicyRule["scope"];
const axes = ["origins", "entity_ids", "region_ids", "domains"] as const;

export function normalizedScope(scope: Scope): Scope {
  return {
    origins: [...new Set(scope.origins)].sort(),
    entity_ids: [...new Set(scope.entity_ids)].sort(),
    region_ids: [...new Set(scope.region_ids)].sort(),
    domains: [...new Set(scope.domains)].sort(),
  };
}

export function overlaps(a: Scope, b: Scope): boolean {
  return axes.every((axis) => {
    const left: readonly string[] = a[axis];
    const right: readonly string[] = b[axis];
    return left.length === 0 || right.length === 0 || left.some((value) => right.includes(value));
  });
}

function ruleContent(rule: ProposedRule | PolicyRule): string {
  if (rule.kind === "permission") {
    return canonicalJson({ kind: rule.kind, action: rule.action,
      triggers: [...new Set(rule.triggers)].sort(), decision: rule.decision });
  }
  return canonicalJson({ kind: rule.kind, protected: rule.protected, guard: rule.guard });
}

export function exactPartition(old: PolicyRule, replacement: ProposedRule, retained: ProposedRule[]): boolean {
  if (old.kind !== replacement.kind || retained.some((piece) => ruleContent(piece) !== ruleContent(old))) return false;
  if (old.kind === "permission" && replacement.kind === "permission" &&
      (old.action !== replacement.action ||
       canonicalJson([...new Set(old.triggers)].sort()) !== canonicalJson([...new Set(replacement.triggers)].sort()))) return false;
  const original = normalizedScope(old.scope);
  const pieces = [replacement, ...retained].map((rule) => normalizedScope(rule.scope));
  for (const [index, piece] of pieces.entries()) {
    if (pieces.slice(0, index).some((earlier) => overlaps(piece, earlier))) return false;
    for (const axis of axes) {
      const previous: readonly string[] = original[axis];
      const next: readonly string[] = piece[axis];
      if (previous.length && (!next.length || next.some((value) => !previous.includes(value)))) return false;
    }
  }
  // Wildcard axes include an extra cell for every value outside the named selectors.
  // Counting disjoint rectangles avoids enumerating their Cartesian product.
  const cardinality = axes.map((axis) => original[axis].length ||
    new Set(pieces.flatMap((piece) => [...piece[axis]])).size + 1);
  const volume = (scope: Scope) => axes.reduce(
    (count, axis, i) => count * BigInt(scope[axis].length || cardinality[i] || 1), 1n,
  );
  return pieces.reduce((sum, piece) => sum + volume(piece), 0n) === volume(original);
}
