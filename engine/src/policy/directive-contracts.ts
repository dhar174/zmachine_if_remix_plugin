import { z } from "zod";
import { DirectiveBundle, HeadExpectation } from "../contracts.ts";

const bundle = DirectiveBundle.shape;
const amendment = bundle.policy_amendment.shape;
const permission = amendment.generation_rules.element;
const invariant = amendment.invariants.element;
const patch = bundle.world_patch.element;
const preference = bundle.preferences.element;
const unresolved = bundle.unresolved.element;
const span = patch.shape.source;
const id = permission.shape.id;
const version = z.literal("1.0.0");
const digest = bundle.story_sha256;
const path = z.array(z.union([z.string(), z.int().nonnegative()]));
const source = bundle.sources.element.extend({
  origin: z.enum(["initial", "editor", "play"]),
  message_id: id,
  provenance: z.enum(["caller_recorded", "unverified"]),
});
export const PolicyRule = z.discriminatedUnion("kind", [
  permission.extend({ kind: z.literal("permission") }),
  invariant.extend({ kind: z.literal("invariant") }),
]);
const proposedRule = z.discriminatedUnion("kind", [
  permission.omit({ source: true, supersedes: true }).extend({ kind: z.literal("permission") }),
  invariant.omit({ source: true, supersedes: true }).extend({ kind: z.literal("invariant") }),
]);
const guardDefinition = z.strictObject({
  id, enforcement: invariant.shape.guard.shape.enforcement,
  parameters: z.record(id, z.enum(["string", "number", "boolean", "null", "strings", "numbers", "booleans"])),
  protected_fields: z.array(patch.shape.field),
});
export const CompilationInput = z.strictObject({
  version, policy_id: bundle.policy_id, story_sha256: digest, head: HeadExpectation,
  sources: z.array(source).min(1).max(64),
  active_rules: z.array(PolicyRule).max(512),
  history: z.array(z.strictObject({ id, supersedes: z.array(id).max(512) })).max(512),
  guards: z.array(guardDefinition).max(128),
});
const entry = z.discriminatedUnion("kind", [
  ...proposedRule.options,
  patch.omit({ source: true }).extend({ kind: z.literal("assignment") }),
  preference.omit({ source: true, id: true }).extend({ kind: z.literal("preference") }),
  unresolved.omit({ source: true }).extend({ kind: z.literal("unresolved"), reason: z.string().min(1).max(32000) }),
  z.strictObject({ kind: z.literal("supersession"), old_rule_id: id, replacement: proposedRule,
    retained: z.array(proposedRule).max(32) }),
]);
const clause = z.strictObject({
  id, source: span, quote: bundle.sources.element.shape.text,
  entries: z.array(entry).min(1).max(32),
  requires: z.array(id).max(64).optional(),
});
export const ModelInterpretation = z.strictObject({
  version, context_digest: digest, clauses: z.array(clause).max(512),
});
export const SupportedSubsetSelection = z.strictObject({
  version, proposal_digest: digest, clause_ids: z.array(id).min(1).max(512),
});
const diagnostic = z.strictObject({
  code: z.enum(["invalid", "stale_context", "invalid_source", "duplicate_id", "invalid_reference",
    "cyclic_lineage", "uncovered_source", "untrusted_source", "unresolved", "policy_conflict",
    "unsupported_guard", "unsafe_partition", "unsupported_dependency"]),
  path, clause_id: id.optional(), message: z.string(),
});
const clauseRecord = z.strictObject({
  id, source: span, quote: z.string(), requires: z.array(id),
  status: z.enum(["supported", "unresolved", "excluded"]),
  entries: z.array(z.strictObject({
    kind: z.enum(["assignment", "invariant", "permission", "preference", "unresolved"]),
    index: z.int().nonnegative(),
  })),
});
export const CompilationProposal = z.strictObject({
  version, status: z.literal("inactive"), kind: z.enum(["full", "subset"]),
  context_digest: digest, interpretation_digest: digest, parent_digest: digest.nullable(), head: HeadExpectation,
  sources: z.array(source), bundle: DirectiveBundle, clauses: z.array(clauseRecord),
  lineage: z.array(z.strictObject({
    clause_id: id, old_rule: PolicyRule, replacement_id: id, retained_ids: z.array(id),
  })),
  diagnostics: z.array(diagnostic), digest,
});
export const CompilationResult = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: CompilationProposal }),
  z.strictObject({ ok: z.literal(false), diagnostics: z.array(diagnostic).min(1) }),
]);

export type CompilationInput = z.input<typeof CompilationInput>;
export type ModelInterpretation = z.infer<typeof ModelInterpretation>;
export type CompilationProposal = z.infer<typeof CompilationProposal>;
export type CompilationResult = z.infer<typeof CompilationResult>;
export type SupportedSubsetSelection = z.infer<typeof SupportedSubsetSelection>;
export type PolicyRule = z.infer<typeof PolicyRule>;
export type Diagnostic = z.infer<typeof diagnostic>;
export type Clause = z.infer<typeof clause>;
export type ProposedRule = z.infer<typeof proposedRule>;

export const modelInterpretationJsonSchema = z.toJSONSchema(ModelInterpretation, { target: "draft-2020-12" });
