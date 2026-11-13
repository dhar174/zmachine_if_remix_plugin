import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { EffectRef, EntityProjection, PolicyAction, ResolverOperation, ResolverSnapshot } from "./resolver-contracts.ts";

type Surface = EntityProjection["surfaces"][number];
export interface ResolvedEffect {
  ref: EffectRef;
  entity: EntityProjection;
  surface: Surface;
}
export interface Footprint {
  effects: ResolvedEffect[];
  capability_ids: string[];
  action: PolicyAction | null;
  route: "native" | "remix" | "bridged";
}
export class ResolutionProblem extends Error {
  readonly status: "VALIDATION_FAILED" | "NEEDS_CLARIFICATION" | "CAPABILITY_MISSING" |
    "POLICY_CONFLICT" | "NEEDS_APPROVAL" | "STALE_REVISION";
  readonly reason: string;
  readonly evidence_ids: readonly string[];

  constructor(status: ResolutionProblem["status"], reason: string, message: string, evidenceIds: readonly string[] = []) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.evidence_ids = evidenceIds;
  }
}
export function effectKey(ref: EffectRef): string {
  return canonicalJson([ref.entity_id, ref.field, ref.change]);
}
const ref = (entity_id: string, field: string, change: EffectRef["change"] = "write"): EffectRef =>
  ({ entity_id, field, change });
const missing = (reason: string, message: string) => new ResolutionProblem("CAPABILITY_MISSING", reason, message);

export function deriveFootprint(snapshot: ResolverSnapshot, entities: Map<string, EntityProjection>,
  operation: ResolverOperation, trace: { capabilityIds: Set<string>; evidenceIds: Set<string> }): Footprint {
  const evidence = trace.evidenceIds;
  const capabilityIds = new Set<string>();
  const effects = new Map<string, ResolvedEffect>();
  const operationDigest = canonicalDigest(operation);
  const native = snapshot.native;
  const bindings = native?.bindings.filter((binding) => binding.operation_digest === operationDigest) ?? [];
  const authored = operation.kind === "native.line" || operation.kind === "native.character";
  let action: PolicyAction | null = null;
  let seeds: EffectRef[];
  let requiredSuppression: EffectRef[] = [];
  let resolvedCapability: ReturnType<typeof resolveCapability> | undefined;

  function present(id: string): EntityProjection {
    const entity = entities.get(id);
    if (entity) evidence.add(entity.evidence_id);
    if (entity?.existence !== "present") {
      const state = entity?.existence ?? "unobserved";
      throw new ResolutionProblem("NEEDS_CLARIFICATION", `entity_${state}`,
        "The target's existence is not established for this operation.", [...evidence]);
    }
    return entity;
  }
  function readSurface(target: EffectRef): ResolvedEffect {
    const entity = present(target.entity_id);
    const surface = entity.surfaces.find((entry) => entry.field === target.field);
    if (!surface || surface.coverage !== "complete") {
      throw missing("effect_coverage", "The effect surface or its dependencies are not fully described.");
    }
    evidence.add(surface.fact.evidence_id);
    if (surface.fact.state === "unobserved" || surface.fact.state === "unmapped" || surface.fact.state === "contradictory") {
      throw new ResolutionProblem("NEEDS_CLARIFICATION", `fact_${surface.fact.state}`,
        "The projected field does not establish a usable fact.", [...evidence]);
    }
    return { ref: target, entity, surface };
  }
  function introduce(id: string, regionIds: string[] | null, fields: string[], domain: Surface["domain"]) {
    const previous = entities.get(id);
    if (!id.startsWith("remix:") || (previous && previous.existence !== "absent")) {
      throw new ResolutionProblem("VALIDATION_FAILED", "creation_identity",
        "Creation requires a fresh remix identity with no conflicting projection record.");
    }
    entities.set(id, { id, origin: "remix", region_ids: regionIds, existence: "present",
      evidence_id: previous?.evidence_id ?? "resolver:proposed", takeover_surfaces: null,
      surfaces: fields.map((field) => ({ field, owner: "remix", domain,
        fact: { state: "absent", evidence_id: "resolver:proposed" }, risk: "consequential",
        direct_assignment: false, coverage: "complete", dependencies: [] })) });
    return fields.map((field) => ref(id, field));
  }
  function resolveCapability(kind: string) {
    const manifest = native?.manifest;
    if (!native || !manifest || manifest.story_sha256 !== snapshot.story_sha256 ||
        manifest.story_sha256 !== native.identity.story_sha256 ||
        manifest.runtime_build !== native.identity.runtime_build ||
        manifest.adapter_build !== native.identity.adapter_build ||
        manifest.checkpoint_format !== native.identity.checkpoint_format) {
      throw missing("native_identity", "No verified capability manifest matches the active story and builds.");
    }
    if (bindings.length !== 1 || !bindings[0]) {
      throw missing("operation_binding", "No unique capability binds the exact operation.");
    }
    const binding = bindings[0];
    trace.capabilityIds.add(binding.capability_id);
    const matches = manifest.capabilities.filter((capability) => capability.id === binding.capability_id);
    const capability = matches[0];
    if (matches.length !== 1 || !capability || capability.operation !== kind ||
        capability.boundary.kind !== native.pending.kind || capability.coverage !== "supported" ||
        capability.evidence.length === 0 || (kind !== "inspect.entity" && capability.recovery !== "checkpoint")) {
      throw missing("native_coverage", "The native operation lacks verified boundary, effect, or recovery coverage.");
    }
    const names = new Set(binding.preconditions.map(({ name }) => name));
    if (capability.preconditions.length !== binding.preconditions.length || names.size !== binding.preconditions.length ||
        capability.preconditions.some((name) => !names.has(name))) {
      throw missing("native_preconditions", "Native preconditions lack structured evidence.");
    }
    for (const precondition of binding.preconditions) {
      const result = readSurface(ref(precondition.entity_id, precondition.field, "read"));
      if (result.surface.fact.state !== "present" || canonicalJson(result.surface.fact.value) !== canonicalJson(precondition.equals)) {
        throw missing("native_preconditions", "A native capability precondition is not established.");
      }
    }
    capabilityIds.add(capability.id);
    capability.evidence.forEach((id) => evidence.add(id));
    return { capability, binding };
  }
  function expand(initial: EffectRef[]) {
    const pending = [...initial];
    while (pending.length > 0) {
      const target = pending.pop();
      if (!target || effects.has(effectKey(target))) continue;
      if (effects.size >= 512) throw missing("effect_limit", "The dependency footprint exceeds the resolver limit.");
      const resolved = readSurface(target);
      effects.set(effectKey(target), resolved);
      if (target.change === "write") pending.push(...resolved.surface.dependencies);
    }
  }

  switch (operation.kind) {
    case "native.line":
    case "native.character": {
      if (!snapshot.clock.native_running || native?.pending.kind !== (operation.kind === "native.line" ? "line" : "character")) {
        throw missing("native_input", "The current native input boundary does not support the request.");
      }
      resolvedCapability = resolveCapability(operation.kind);
      seeds = resolvedCapability.capability.effects;
      break;
    }
    case "inspect.entity": {
      const entity = present(operation.entity_id);
      if (entity.origin === "native" || entity.surfaces.some((surface) => surface.owner === "native")) {
        resolvedCapability = resolveCapability(operation.kind);
        seeds = resolvedCapability.capability.effects;
        if (seeds.some((target) => target.change === "write" || target.entity_id !== entity.id)) {
          throw missing("inspection_scope", "Inspection coverage must be read-only and limited to the requested entity.");
        }
      } else {
        seeds = entity.surfaces.filter((surface) => surface.coverage === "complete" && surface.fact.state === "present")
          .map((surface) => ref(entity.id, surface.field, "read"));
      }
      break;
    }
    case "remix.assign": {
      const target = readSurface(ref(operation.entity_id, operation.field));
      if (!target.surface.direct_assignment || ["inventory:holder", "inventory:contents", "topology:exits",
        "topology:connection", "dialogue:script", "dialogue:overlay", "entity:record"].includes(operation.field)) {
        throw missing("structured_operation_required", "Use a registered operation for this relational field.");
      }
      seeds = [target.ref];
      break;
    }
    case "inventory.transfer": {
      if (operation.item === operation.from || operation.item === operation.to || operation.from === operation.to) {
        throw new ResolutionProblem("VALIDATION_FAILED", "transfer_identity", "Inventory transfer requires distinct participants.");
      }
      const holder = readSurface(ref(operation.item, "inventory:holder")).surface.fact;
      if (holder.state !== "present" || holder.value !== operation.from) {
        throw new ResolutionProblem("NEEDS_CLARIFICATION", "inventory_holder", "The current inventory holder does not match.");
      }
      for (const [container, contains] of [[operation.from, true], [operation.to, false]] as const) {
        const contents = readSurface(ref(container, "inventory:contents")).surface.fact;
        if (contents.state !== "present" || !Array.isArray(contents.value) ||
            contents.value.includes(operation.item) !== contains) {
          throw new ResolutionProblem("NEEDS_CLARIFICATION", "inventory_contents", "Inventory ownership and contents disagree.");
        }
      }
      seeds = [ref(operation.item, "inventory:holder"), ref(operation.from, "inventory:contents"),
        ref(operation.to, "inventory:contents")];
      break;
    }
    case "overlay.create":
      if (!snapshot.regions.includes(operation.region)) {
        throw new ResolutionProblem("NEEDS_CLARIFICATION", "region_unobserved", "The destination region is not established.");
      }
      action = `generate.${operation.entity_kind}`;
      seeds = introduce(operation.entity, [operation.region], ["entity:record"], "identity");
      break;
    case "overlay.connect": {
      if (operation.from === operation.to) {
        throw new ResolutionProblem("VALIDATION_FAILED", "connection_identity", "A connection requires distinct endpoints.");
      }
      const from = present(operation.from);
      present(operation.to);
      action = "generate.connection";
      seeds = [...introduce(operation.connection, from.region_ids, ["topology:connection"], "topology"),
        ref(operation.from, "topology:exits"), ref(operation.to, "topology:exits")];
      break;
    }
    case "dialogue.change": {
      const character = present(operation.character);
      action = "dialogue.adapt";
      if (operation.takeover) {
        if (character.takeover_surfaces === null) {
          throw missing("takeover_coverage", "Conflicting native routines have not been completely identified.");
        }
        requiredSuppression = character.takeover_surfaces;
        if (requiredSuppression.some((target) => target.change !== "write" || readSurface(target).surface.owner !== "native")) {
          throw missing("takeover_coverage", "Every conflicting native surface needs a declared native write.");
        }
      }
      seeds = [ref(character.id, operation.takeover ? "dialogue:script" : "dialogue:overlay"), ...requiredSuppression];
      break;
    }
  }
  expand(seeds);
  // New locations expose their own overlay endpoint for another operation in the same proposal.
  if (operation.kind === "overlay.create" && operation.entity_kind === "location") {
    const created = present(operation.entity);
    created.surfaces.push({ field: "topology:exits", owner: "remix", domain: "topology",
      fact: { state: "absent", evidence_id: "resolver:proposed" }, risk: "consequential", direct_assignment: false,
      coverage: "complete", dependencies: [] });
  }
  const nativeEffects = [...effects.values()].filter(({ surface }) => surface.owner === "native");
  const remixEffects = [...effects.values()].filter(({ surface }) => surface.owner === "remix");
  const needsNative = authored || capabilityIds.size > 0 || nativeEffects.length > 0;
  if (needsNative) {
    const { capability, binding } = resolvedCapability ?? resolveCapability(operation.kind);
    const nativeKeys = new Set(nativeEffects.map(({ ref }) => effectKey(ref)));
    const capabilityKeys = new Set(capability.effects.map(effectKey));
    if (nativeKeys.size !== capabilityKeys.size || [...nativeKeys].some((key) => !capabilityKeys.has(key))) {
      throw missing("native_effect_coverage", "The native capability does not cover the exact native footprint.");
    }
    const suppressed = new Set(binding.suppressed_surfaces.map(effectKey));
    if (requiredSuppression.some((target) => !suppressed.has(effectKey(target)))) {
      throw missing("takeover_coverage", "A conflicting native routine lacks verified suppression or interception.");
    }
    if (remixEffects.length > 0) {
      const allKeys = new Set(effects.keys());
      const mapping = snapshot.bridges.filter((bridge) => bridge.operation_digest === operationDigest &&
        bridge.native_capability_id === capability.id && new Set(bridge.effects.map(effectKey)).size === allKeys.size &&
        bridge.effects.every((target) => allKeys.has(effectKey(target))));
      const bridge = mapping[0];
      if (mapping.length !== 1 || !bridge) throw missing("bridge_coverage", "No registered bridge covers both owners.");
      capabilityIds.add(bridge.id);
      trace.capabilityIds.add(bridge.id);
      evidence.add(bridge.evidence_id);
    }
    // Conditions are reads used to justify this plan, not adapter writes.
    expand(binding.preconditions.map((condition) => ref(condition.entity_id, condition.field, "read")));
  }
  return {
    effects: [...effects.values()].sort((a, b) => effectKey(a.ref) < effectKey(b.ref) ? -1 : 1),
    action, route: needsNative ? remixEffects.length ? "bridged" : "native" : "remix",
    capability_ids: [...capabilityIds].sort(),
  };
}
