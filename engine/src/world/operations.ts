
import { canonicalDigest, canonicalJson } from "../contracts.ts";
import { limits, turnBudget } from "../turn/limits.ts";
import type { TurnBudget } from "../turn/limits.ts";
import { effectKey } from "../policy/resolver-effects.ts";
import type { Footprint, ResolvedEffect } from "../policy/resolver-effects.ts";
import { ruleLimits } from "./rule-contracts.ts";
import type { RuleCause, RuleStep } from "./rule-contracts.ts";
import { acyclicRules, observedBy, offerEligible, ruleReferences, validDefinition } from "./rule-state.ts";
import type { EffectPlan, EffectRef, EntityProjection, PolicyAction, ResolverOperation, ResolverSnapshot } from "../policy/resolver-contracts.ts";
import { World, activeFact, eligibleFact, isHolder, relationshipTarget, validWorld, worldView } from "./model.ts";
import type { BehaviorWorld, WorldEvent } from "./model.ts";
import { ownedByWorld, projectWorld, visibleWorldNote, worldInspection, worldTargetVisible } from "./projection.ts";

type PlanInput = Pick<EffectPlan, "head" | "proposal_digest" | "request_id" | "world_mode"> & {
  operations: readonly { operation: ResolverOperation; effects?: readonly EffectRef[] }[];
};
type RuleCheck = (snapshot: ResolverSnapshot, operation: Operation, footprint: Footprint) => void;
type Intent = { request: string; proposal: string; revision: number; index: number; mode: ResolverSnapshot["mode"] };
type Surface = EntityProjection["surfaces"][number];

export class WorldOperationError extends Error {
readonly status: "CAPABILITY_MISSING" | "NEEDS_CLARIFICATION" | "VALIDATION_FAILED" | "ABORTED";

  constructor(status: WorldOperationError["status"], message: string) {
    super(message);
    this.status = status;
  }
}

const invalid = (message: string) => new WorldOperationError("VALIDATION_FAILED", message);
const missing = (message: string) => new WorldOperationError("CAPABILITY_MISSING", message);
const unclear = (message: string) => new WorldOperationError("NEEDS_CLARIFICATION", message);

export function usesWorld(snapshot: ResolverSnapshot, operation: ResolverOperation): boolean {
  const world = snapshot.world;
  switch (operation.kind) {
    case "rule.install":
    case "offer.accept":
    case "speech.record":
    case "observation.record":
    case "belief.update": return true;
    case "overlay.create":
    case "overlay.connect": return world !== undefined;
    case "remix.assign":
    case "inspect.entity": return !!world && ownedByWorld(world, operation.entity_id);
    case "inventory.transfer": return !!world && [operation.item, operation.from, operation.to].some((id) => ownedByWorld(world, id));
    default: return false;
  }
}

function beforeAndAfter(before: EntityProjection[], after: EntityProjection[]):
{ ref: EffectRef; entity: EntityProjection; surface: Surface }[] {
  const index = new Map(before.map((entity) => [entity.id, new Map(entity.surfaces.map((surface) => [surface.field, surface]))]));
  return after.flatMap((entity) => entity.surfaces.flatMap((surface) => {
    const prior = index.get(entity.id)?.get(surface.field);
    if (prior && canonicalJson(prior.fact) === canonicalJson(surface.fact)) return [];
    // Empty collections are computed by the projection and do not establish a fact at creation.
    if (!prior && surface.fact.state === "present" && Array.isArray(surface.fact.value) && !surface.fact.value.length) return [];
    const ref = { entity_id: entity.id, field: surface.field, change: "write" as const };
    const previous: Surface = prior ?? { ...surface, fact: { state: "absent", evidence_id: entity.evidence_id } };
    return [{ ref, entity, surface: previous }];
  }));
}

type Derived = { cause: RuleCause; owner: string };
export type Operation = ResolverOperation | { kind: "rule.effect"; derived: Derived };

export function evaluateWorldOperation(snapshot: ResolverSnapshot, operation: Operation, intent: Intent) {
  if (!snapshot.world) throw missing("The session has no registered remix world.");
  const base = snapshot.world;
  const next = structuredClone(operation.kind === "rule.install" && base.version === "1.0.0"
    ? { ...base, version: "2.0.0" as const, rules: [], offers: [] } : base) as World;
  const id = "world-event:" + canonicalDigest([snapshot.head.generation_id, intent.request, intent.revision, intent.index]);
  const eventBase = { id, revision: intent.revision, request: intent.request, proposal: intent.proposal };
  const before = projectWorld(base);
  let action: PolicyAction | null = null;
  let event: WorldEvent | undefined;
  const reads: { id: string; field: string }[] = [];
  const view = worldView(base);
  const { entities, events, listenersAt, observable, observationRoom, roomOf, rootHolder } = view;
  const playerRoom = roomOf(base.player, intent.revision);
  function read(id: string, field = "entity:record") {
    reads.push({ id, field });
  }
  function readPlacement(id: string) {
    let entity = entities.get(id);
    for (let depth = 0; entity?.kind === "item"; depth++) {
      if (depth >= 16) throw invalid("The containment path cannot be verified.");
      read(entity.id, "inventory:holder");
      entity = entities.get(activeFact(base, entity.id, "inventory:holder")?.value ?? "");
    }
  }
  function lookup(id: string) {
    if (id.startsWith("native:")) throw missing("The requested operation needs a verified native or cross-owner capability.");
    const entity = entities.get(id);
    if (!entity) throw unclear("The remix entity is not established at this revision.");
    read(id);
    return entity;
  }
  function fresh(target: string) {
    if (!target.startsWith("remix:") || ownedByWorld(base, target) || snapshot.entities.some(({ id }) => id === target)) {
      throw invalid("Creation requires a fresh remix identity.");
    }
  }
  function change(subject: string) {
    event = { ...eventBase, kind: "change", mode: intent.mode, subject };
  }
  function assign(subject: string, field: string, value: string) {
    const prior = activeFact(next, subject, field);
    if (prior) prior.until = intent.revision;
    next.facts.push({ subject, field, value, owner: "remix", source: id, from: intent.revision, until: null,
      visibility: field === "world:private_note" ? "owner" : "player",
      evidence: intent.mode === "EDITOR" ? "editor_committed" : "play_committed" });
  }
  let policyOperation: ResolverOperation | undefined;
  const behavior = (): BehaviorWorld => {
    if (next.version !== "2.0.0") throw missing("The session has no behavior registry.");
    return next;
  };
  switch (operation.kind) {
    case "rule.install": {
      const { rule } = operation;
      const registry = behavior().rules;
      if (registry.length >= ruleLimits.rules || registry.some(({ definition }) => definition.id === rule.id) ||
          !validDefinition(base, rule, view, snapshot.head.expected_revision) ||
          !acyclicRules([...registry.map(({ definition }) => definition), rule])) {
        throw invalid("The rule has invalid references, a conflicting identity, or a trigger cycle.");
      }
      for (const { id } of ruleReferences(rule)) read(id);
      registry.push({ definition: rule, source: id });
      action = "generate.rule";
      event = { ...eventBase, kind: "rule.installed", rule_id: rule.id, definition_digest: canonicalDigest(rule), mode: intent.mode };
      break;
    }
    case "offer.accept": {
      const offer = behavior().offers.find(({ id }) => id === operation.offer_id);
      if (intent.mode !== "PLAY" || !offer || offer.consumed_by !== null || offer.recipient !== base.player ||
          (events.get(offer.id)?.revision ?? Infinity) > snapshot.head.expected_revision ||
          !offerEligible(base, view, offer.giver, offer.item, intent.revision, read)) {
        throw unclear("The offer is unavailable.");
      }
      read(offer.giver, "inventory:offers");
      event = { ...eventBase, kind: "offer.accepted", offer_id: offer.id };
      break;
    }
    case "rule.effect": {
      const { cause, owner } = operation.derived;
      const effect = cause.effect;
      read(owner);
      let subject = owner;
      switch (effect.kind) {
        case "belief.record": {
          read(owner, "characterization:beliefs");
          const evidence = events.get(cause.event_id);
          if (!evidence || evidence.kind !== "speech" && evidence.kind !== "observation" ||
              behavior().beliefs.some((belief) => belief.character === owner && belief.topic === effect.topic)) {
            throw invalid("The rule cannot record that belief.");
          }
          read(owner, evidence.kind === "speech" ? "dialogue:speech" : "dialogue:observation");
          behavior().beliefs.push({ character: owner, topic: effect.topic, evidence: evidence.id, owner: "remix",
            visibility: "owner", evidence_status: "play_committed", source: id, from: intent.revision, until: null });
          break;
        }
        case "offer.create": {
          read(owner, "inventory:offers");
          const { offers } = behavior();
          if (!offerEligible(base, view, owner, effect.item, intent.revision, read) ||
              offers.some((offer) => offer.giver === owner && offer.recipient === base.player && offer.item === effect.item)) {
            throw invalid("The item is ineligible for an offer.");
          }
          offers.push({ id, giver: owner, recipient: base.player, item: effect.item, consumed_by: null });
          break;
        }
        case "relationship.adjust": {
          read(effect.target);
          if (roomOf(effect.target, intent.revision) !== playerRoom) throw unclear("The relationship target is outside the active scene.");
          const field = "relationship:" + effect.target;
          const from = effect.step === 1 ? "acquaintance" : "friend";
          const to = effect.step === 1 ? "friend" : "acquaintance";
          if (activeFact(base, owner, field)?.value !== from) throw invalid("The relationship adjustment exceeds its supported bounds.");
          assign(owner, field, to);
          policyOperation = { kind: "remix.assign", entity_id: owner, field, value: to };
          break;
        }
        case "offer.transfer": {
          const offer = behavior().offers.find(({ id }) => id === effect.offer_id);
          const accept = events.get(cause.event_id);
          if (accept?.kind !== "offer.accepted" || accept.offer_id !== effect.offer_id || !offer ||
              offer.giver !== owner || offer.recipient !== base.player || offer.consumed_by !== null ||
              !offerEligible(base, view, owner, offer.item, intent.revision, read)) {
            throw unclear("The offer is unavailable.");
          }
          read(owner, "inventory:offers");
          subject = offer.item;
          assign(offer.item, "inventory:holder", offer.recipient);
          offer.consumed_by = id;
          policyOperation = { kind: "inventory.transfer", item: offer.item, from: offer.giver, to: offer.recipient };
          break;
        }
      }
      event = { ...eventBase, kind: "rule.effect", subject, step: { ...cause, result_id: id, effects: [] } };
      break;
    }
    case "inspect.entity": {
      const entity = before.find(({ id }) => id === operation.entity_id);
      const editor = intent.mode === "EDITOR";
      if (!entity || !editor && !worldTargetVisible(base, operation.entity_id, intent.revision)) {
        throw unclear("The target is not available for inspection.");
      }
      const visible = new Set(worldInspection(base, entity.id, editor, intent.revision).map(({ field }) => field));
      const effects = entity.surfaces.filter(({ field }) => visible.has(field))
        .map((surface) => ({ ref: { entity_id: entity.id, field: surface.field, change: "read" as const }, entity, surface }));
      return { next: base, effects, action, event, policyOperation };
    }
    case "overlay.create": {
      const { entity, region, label, entity_kind: kind, holder, room, container } = operation;
      fresh(entity);
      if (!snapshot.regions.includes(region)) throw unclear("The proposed region is not registered.");
      const common = { id: entity, label, source: id };
      action = `generate.${kind}`;
      if (kind === "location" && holder === undefined && room === undefined && container === undefined) {
        next.entities.push({ ...common, kind, region });
      } else if (kind === "character" && room && holder === undefined && container === undefined) {
        const target = lookup(room);
        if (target.kind !== "location" || target.region !== region) throw invalid("Character placement needs a room in the declared region.");
        next.entities.push({ ...common, kind, room });
      } else if (kind === "item" && holder && room === undefined) {
        if (!isHolder(lookup(holder))) throw invalid("The initial item holder is ineligible.");
        readPlacement(holder);
        const location = entities.get(roomOf(holder) ?? "");
        if (location?.kind !== "location" || location.region !== region) throw invalid("The initial holder is outside the declared region.");
        next.entities.push({ ...common, kind, container: container ?? false });
        assign(entity, "inventory:holder", holder);
      } else {
        throw missing("Use a room, a placed character, or an item with an eligible holder.");
      }
      change(entity);
      break;
    }
    case "overlay.connect": {
      fresh(operation.connection);
      const from = lookup(operation.from);
      const to = lookup(operation.to);
      if (from.kind !== "location" || to.kind !== "location" || from.id === to.id) throw invalid("An exit needs two distinct overlay rooms.");
      next.exits.push({ id: operation.connection, from: from.id, to: to.id, source: id });
      action = "generate.connection";
      change(operation.connection);
      break;
    }
    case "remix.assign": {
      const subject = lookup(operation.entity_id);
      if (typeof operation.value !== "string" || !eligibleFact(base, subject.id, operation.field, operation.value)) {
        throw missing("The assignment is outside the registered remix fact fields.");
      }
      const target = relationshipTarget(operation.field);
      if (target) lookup(target);
      assign(subject.id, operation.field, operation.value);
      change(subject.id);
      break;
    }
    case "inventory.transfer": {
      const item = lookup(operation.item);
      const from = lookup(operation.from);
      const to = lookup(operation.to);
      if (item.kind !== "item" || !isHolder(from) || !isHolder(to) || from.id === to.id || item.id === to.id) {
        throw invalid("Inventory transfer requires a distinct eligible item and two eligible holders.");
      }
      if (activeFact(base, item.id, "inventory:holder")?.value !== from.id) throw unclear("The item is no longer held by the source.");
      readPlacement(from.id);
      readPlacement(to.id);
      if (roomOf(from.id) !== roomOf(to.id)) throw missing("Transfer between scenes is unsupported.");
      if (intent.mode === "PLAY") {
        const source = rootHolder(from.id);
        const takesFromScene = source === playerRoom && rootHolder(to.id) === base.player;
        if (roomOf(from.id) !== playerRoom || (source !== base.player && !takesFromScene)) {
          throw missing("Play transfers require the player to take, drop, or hand off the item.");
        }
      }
      if (item.container) read(item.id, "inventory:contents");
      if (base.facts.some(({ field, value, until }) => field === "inventory:holder" && value === item.id && until === null)) {
        throw missing("Moving a nonempty container is unsupported.");
      }
      assign(item.id, "inventory:holder", to.id);
      change(item.id);
      break;
    }
    case "speech.record": {
      if (intent.mode !== "PLAY" || !playerRoom) throw missing("Speech requires a player in an eligible overlay scene.");
      const listeners = listenersAt(base.player, playerRoom, intent.revision);
      read(base.player);
      read(playerRoom, "identity:occupants");
      listeners.forEach((listener) => read(listener));
      event = { ...eventBase, kind: "speech", speaker: base.player, room: playerRoom, text: operation.text, listeners };
      break;
    }
    case "observation.record": {
      const { observer, subject, field } = operation;
      lookup(observer);
      lookup(subject);
      const room = observationRoom(observer, intent.revision);
      const fact = activeFact(base, subject, field);
      if (intent.mode !== "PLAY" || !room || !fact || !observable(fact, room, intent.revision)) {
        throw unclear("The requested fact is not observable by that character in the active scene.");
      }
      read(base.player);
      read(subject, field);
      readPlacement(subject);
      const target = relationshipTarget(field);
      if (target) readPlacement(target);
      event = { ...eventBase, kind: "observation", observer, room, subject, field, fact_source: fact.source };
      break;
    }
    case "belief.update": {
      const { character, evidence } = operation;
      lookup(character);
      const proof = events.get(evidence);
      if (intent.mode !== "PLAY" || !proof || proof.revision > snapshot.head.expected_revision ||
          (proof.kind !== "speech" || !proof.listeners.includes(character)) &&
          (proof.kind !== "observation" || proof.observer !== character)) {
        throw unclear("The character has no justified evidence for this belief.");
      }
      if (base.beliefs.some((belief) => belief.character === character && belief.evidence === evidence)) {
        throw unclear("The character already has this evidence.");
      }
      next.beliefs.push({ character, evidence, owner: "remix", visibility: "owner", evidence_status: "play_committed",
        source: id, from: intent.revision, until: null });
      change(character);
      break;
    }
    default: throw missing("The operation is outside the remix world slice.");
  }
  if (!event) throw invalid("A world write needs a provenance event.");
  if (next.version === "1.0.0") {
    if (event.kind === "rule.effect" || event.kind === "rule.installed" || event.kind === "offer.accepted") {
      throw invalid("Behavior events require the versioned registry.");
    }
    next.events.push(event);
  } else {
    next.events.push(event);
  }
  const effects = beforeAndAfter(before, projectWorld(next));
  const zones = new Map(before.map((entity) => [entity.id, entity]));
  const covered = new Set(effects.map(({ ref }) => ref.entity_id + "/" + ref.field));
  for (const { id, field } of reads) {
    const key = id + "/" + field;
    if (covered.has(key)) continue;
    const entity = zones.get(id);
    const surface = entity?.surfaces.find((candidate) => candidate.field === field);
    if (!entity || !surface) throw invalid("An operation read lacks a matching policy surface.");
    effects.push({ ref: { entity_id: id, field, change: "read" }, entity, surface });
    covered.add(key);
  }
  if (event.kind === "rule.effect") event.step.effects = effects.map(({ ref }) => ref);
  const parsed = World.safeParse(next);
  if (!parsed.success || !validWorld(parsed.data, intent.revision, snapshot.regions, snapshot.entities.map(({ id }) => id))) {
    throw invalid("The proposed world violates identity, placement, provenance, or size constraints.");
  }
  return { next: parsed.data, effects, action, event, policyOperation };
}

export function expandWorldDependencies(snapshot: ResolverSnapshot, effects: ResolvedEffect[]): ResolvedEffect[] {
  const declared = snapshot.world_dependencies ?? [];
  if (declared.length === 0 && effects.every(({ surface }) => surface.dependencies.length === 0)) return effects;
  const found = new Set(effects.map(({ ref }) => effectKey(ref)));
  const entities = new Map([...snapshot.entities, ...(snapshot.world ? projectWorld(snapshot.world) : [])]
    .map((entity) => [entity.id, entity]));
  const pending = [...effects];
  for (const { ref, surface } of pending) {
    if (ref.change !== "write") continue;
    const dependencies = [...surface.dependencies, ...declared.flatMap(({ source, dependency }) =>
      effectKey(source) === effectKey(ref) ? [dependency] : [])];
    for (const dependency of dependencies) {
      const key = effectKey(dependency);
      if (found.has(key)) continue;
      const entity = entities.get(dependency.entity_id);
      const target = entity?.surfaces.find(({ field }) => field === dependency.field);
      if (pending.length >= 512 || !entity || entity.existence !== "present" ||
          target?.coverage !== "complete" || target.fact.state !== "present") {
        throw missing("A world dependency lacks complete effect coverage.");
      }
      found.add(key);
      pending.push({ ref: dependency, entity, surface: target });
    }
  }
  return pending;
}

export function verifyWorldWrites(direct: ResolvedEffect[], effects: ResolvedEffect[]): void {
  const supported = new Set(direct.filter(({ surface }) => surface.owner === "remix").map(({ ref }) => effectKey(ref)));
  if (effects.some(({ ref }) => ref.change === "write" && !supported.has(effectKey(ref)))) {
    throw missing("A world operation needs a verified capability for an indirect write.");
  }
}

export function runWorldPlan(snapshot: ResolverSnapshot, plan: PlanInput,
  options: { check?: RuleCheck; budget?: TurnBudget | undefined } = {}) {
  if (!plan.world_mode) return undefined;
  if (!snapshot.world || plan.operations.length === 0 ||
      !plan.operations.every(({ operation }) => usesWorld(snapshot, operation))) {
    throw invalid("The validated plan does not belong to this remix world.");
  }
  if (plan.operations.length > 1 && plan.operations.some(({ operation }) => operation.kind === "offer.accept")) {
    throw invalid("An offer acceptance requires its own Play turn.");
  }
  let current = snapshot.world;
  const initial = snapshot.world;
  const revision = plan.head.expected_revision + 1;
  const mode = plan.world_mode;
  const events: WorldEvent[] = [];
  const ruleSteps: RuleStep[] = [];
  const notes: string[] = [];
  const queue: { event: WorldEvent; depth: number }[] = [];
  const seen = new Set<string>();
  let evaluations = 0;
  const deadline = options.budget ?? turnBudget();
  function budget(condition: boolean) {
    if (!condition || deadline.remaining() <= 0) {
      throw new WorldOperationError("ABORTED", "The isolated rule cascade exceeded its execution budget.");
    }
  }

  function apply(operation: Operation, depth: number, reads: ResolvedEffect[] = []) {
    budget(events.length < limits.operations && events.length < limits.events && depth <= ruleLimits.depth);
    const subject = { ...snapshot, world: current };
    const result = evaluateWorldOperation(subject, operation, { request: plan.request_id,
      proposal: plan.proposal_digest, revision, mode, index: events.length });
    if (!result.event) throw invalid("Execution did not produce a world event.");
    const { event } = result;
    const effects = expandWorldDependencies(subject,
      [...new Map([...reads, ...result.effects].map((effect) => [effectKey(effect.ref), effect])).values()]);
    if (operation.kind === "rule.effect") {
      if (event.kind !== "rule.effect") throw invalid("The consequence lost its causal event.");
      const origin = initial.events.find((entry) => entry.kind === "rule.installed" && entry.rule_id === event.step.rule_id);
      const action = origin?.kind === "rule.installed" && origin.mode === "PLAY" ? "generate.rule" : result.action;
      options.check?.(subject, result.policyOperation ?? operation,
        { effects, action, route: "remix", capability_ids: [] });
      verifyWorldWrites(result.effects, effects);
      event.step.effects = effects.map(({ ref }) => ref);
      const record = result.next.events.at(-1);
      if (record?.kind !== "rule.effect") throw invalid("The rule consequence is missing from the candidate.");
      record.step.effects = event.step.effects;
      ruleSteps.push(event.step);
      if (event.step.effect.kind === "offer.create") {
        const offer = result.next.version === "2.0.0" && result.next.offers.find(({ id }) => id === event.id);
        if (!offer) throw invalid("The offer is missing from its committed result.");
        const { id, item, giver, recipient } = offer;
        notes.push(canonicalJson({ kind: "offer.created", id, item, giver, recipient }));
      }
      if (result.policyOperation?.kind === "inventory.transfer") notes.push(canonicalJson(result.policyOperation));
    } else {
      verifyWorldWrites(result.effects, effects);
    }
    current = result.next;
    events.push(event);
    queue.push({ event, depth });
    return { ...result, effects };
  }

  for (const { operation, effects } of plan.operations) {
    const result = apply(operation, 0);
    if (effects && canonicalJson(effects.map(effectKey).sort()) !== canonicalJson(result.effects.map(({ ref }) => effectKey(ref)).sort())) {
      throw invalid("Execution differed from the validated remix-world footprint.");
    }
    if (result.event?.kind === "speech") {
      const { kind, speaker, text } = result.event;
      notes.push(canonicalJson({ kind, speaker, text }));
    } else if (operation.kind === "overlay.create") {
      notes.push(canonicalJson({ kind: operation.kind, entity: operation.entity, label: operation.label,
        entity_kind: operation.entity_kind, holder: operation.holder, room: operation.room }));
    } else if (operation.kind === "overlay.connect" || operation.kind === "inventory.transfer") {
      notes.push(canonicalJson(operation));
    }
  }

  if (mode === "PLAY" && initial.version === "2.0.0") {
    const rules = initial.rules.map(({ definition }) => definition).sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const { event, depth } of queue) {
      if (event.kind === "offer.accepted") {
        const offer = initial.offers.find(({ id }) => id === event.offer_id);
        const opened = initial.events.find(({ id }) => id === event.offer_id);
        if (!offer || opened?.kind !== "rule.effect") throw invalid("The offer has no registered source.");
        apply({ kind: "rule.effect", derived: { owner: offer.giver, cause: { event_id: event.id,
          rule_id: opened.step.rule_id, effect_index: 0, effect: { kind: "offer.transfer", offer_id: offer.id } } } }, depth + 1);
        continue;
      }
      if (event.kind !== "speech" && event.kind !== "observation" &&
          (event.kind !== "rule.effect" || event.step.effect.kind !== "offer.create")) continue;
      for (const rule of rules) {
        budget(++evaluations <= ruleLimits.evaluations);
        const key = canonicalJson([event.id, rule.id]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (current.version !== "2.0.0" || !observedBy(rule, event) ||
            worldView(current).observationRoom(rule.owner, revision) === undefined) continue;
        const before = current;
        const view = worldView(before);
        const predicateReads: ResolvedEffect[] = [];
        const projected = projectWorld(before);
        function readPredicate(id: string, field: string) {
          const entity = projected.find((entry) => entry.id === id);
          const surface = entity?.surfaces.find((entry) => entry.field === field);
          if (!entity || !surface) throw invalid("A predicate lacks a matching world surface.");
          predicateReads.push({ ref: { entity_id: id, field, change: "read" }, entity, surface });
        }
        readPredicate(before.player, "entity:record");
        readPredicate(rule.owner, "entity:record");
        readPredicate(rule.owner, event.kind === "speech" ? "dialogue:speech" :
          event.kind === "observation" ? "dialogue:observation" : "inventory:offers");
        if (!rule.conditions.every((condition) => {
          budget(++evaluations <= ruleLimits.evaluations);
          if (condition.kind === "speech.equals") return event.kind === "speech" && event.text === condition.text;
          if ("topic" in condition) {
            readPredicate(rule.owner, "characterization:beliefs");
            const known = before.beliefs.some((belief) => belief.character === rule.owner && belief.topic === condition.topic);
            return condition.kind === "topic.known" ? known : !known;
          }
          readPredicate(condition.item, "inventory:holder");
          if (condition.kind === "item.held") return view.holderAt(condition.item) === rule.owner;
          readPredicate(rule.owner, "inventory:offers");
          return offerEligible(before, view, rule.owner, condition.item, revision, readPredicate) &&
            !before.offers.some((offer) => offer.giver === rule.owner && offer.item === condition.item);
        })) continue;
        for (const [effect_index, effect] of rule.effects.entries()) {
          apply({ kind: "rule.effect", derived: { owner: rule.owner,
            cause: { event_id: event.id, rule_id: rule.id, effect_index, effect } } }, depth + 1, predicateReads);
        }
      }
    }
  }
  const facts = mode === "EDITOR" ? notes : notes.flatMap((note) => {
    const visible = visibleWorldNote(note, current, revision);
    return visible === undefined ? [] : [visible];
  });
  budget(Buffer.byteLength(JSON.stringify([[], facts])) <= limits.output_bytes &&
    Buffer.byteLength(canonicalJson(current)) <= limits.checkpoint_bytes);
  return { world: current, events, facts, ruleSteps };
}
