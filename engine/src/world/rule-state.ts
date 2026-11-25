import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { BehaviorWorld, World, WorldEvent, worldView } from "./model.ts";
import type { RuleDefinition } from "./rule-contracts.ts";

export function ruleReferences(rule: RuleDefinition): { id: string; kind?: "character" | "item" }[] {
  const refs: ReturnType<typeof ruleReferences> = [{ id: rule.owner, kind: "character" }];
  if (rule.when.kind === "observation") refs.push({ id: rule.when.subject });
  if (rule.when.kind === "offer.created") refs.push({ id: rule.when.item, kind: "item" });
  for (const condition of rule.conditions) {
    if ("item" in condition) refs.push({ id: condition.item, kind: "item" });
  }
  for (const effect of rule.effects) {
    if (effect.kind === "offer.create") refs.push({ id: effect.item, kind: "item" });
    if (effect.kind === "relationship.adjust") refs.push({ id: effect.target, kind: "character" });
  }
  return refs;
}

export function validDefinition(world: World, rule: RuleDefinition, view: ReturnType<typeof worldView>, revision: number): boolean {
  if (rule.when.kind === "observation") {
    const { subject, field } = rule.when;
    if (!world.facts.some((fact) => fact.subject === subject && fact.field === field && fact.visibility === "player" &&
        fact.from <= revision && (fact.until === null || revision < fact.until))) return false;
  }
  return rule.owner !== world.player && ruleReferences(rule).every(({ id, kind }) => {
    const entity = view.entities.get(id);
    return entity && (!kind || entity.kind === kind) && view.presentAt(entity, revision);
  }) && rule.effects.every((effect) => {
    if (effect.kind === "belief.record") return rule.when.kind !== "offer.created";
    if (effect.kind === "relationship.adjust") return effect.target !== rule.owner;
    return true;
  }) && rule.conditions.every((condition) => condition.kind !== "speech.equals" || rule.when.kind === "speech");
}

export function acyclicRules(rules: readonly RuleDefinition[]): boolean {
  const edges = new Map<string, Set<string>>();
  for (const { when, effects } of rules) {
    if (when.kind !== "offer.created") continue;
    const outputs = edges.get(when.item) ?? new Set<string>();
    for (const effect of effects) {
      if (effect.kind === "offer.create") outputs.add(effect.item);
    }
    edges.set(when.item, outputs);
  }
  const walking = new Set<string>();
  const complete = new Set<string>();
  function visit(item: string): boolean {
    if (walking.has(item)) return false;
    if (complete.has(item)) return true;
    walking.add(item);
    for (const output of edges.get(item) ?? []) {
      if (!visit(output)) return false;
    }
    walking.delete(item);
    complete.add(item);
    return true;
  }
  return [...edges.keys()].every(visit);
}

export function observedBy(rule: RuleDefinition, event: WorldEvent): boolean {
  if (rule.when.kind === "speech") return event.kind === "speech" && event.listeners.includes(rule.owner);
  if (rule.when.kind === "observation") {
    return event.kind === "observation" && event.observer === rule.owner &&
      event.subject === rule.when.subject && event.field === rule.when.field;
  }
  return event.kind === "rule.effect" && event.step.effect.kind === "offer.create" &&
    event.step.effect.item === rule.when.item && event.subject === rule.owner;
}

export function offerEligible(world: World, view: ReturnType<typeof worldView>, giver: string, item: string, at: number,
  read?: (id: string, field: string) => void) {
  const entity = view.entities.get(item);
  if (entity?.kind !== "item") return false;
  read?.(world.player, "entity:record");
  read?.(giver, "entity:record");
  read?.(item, "entity:record");
  read?.(item, "inventory:holder");
  if (entity.container) read?.(item, "inventory:contents");
  return view.holderAt(item, at) === giver && view.observationRoom(giver, at) !== undefined &&
    (!entity.container || !world.facts.some((fact) => fact.field === "inventory:holder" && fact.value === item &&
      fact.from <= at && (fact.until === null || at < fact.until)));
}

export function validBehaviorState(world: BehaviorWorld, view: ReturnType<typeof worldView>): boolean {
  const rules = new Map(world.rules.map((rule) => [rule.definition.id, rule]));
  const offers = new Map(world.offers.map((offer) => [offer.id, offer]));
  const order = new Map(world.events.map(({ id }, index) => [id, index]));
  const before = (left: string, right: string) => (order.get(left) ?? Infinity) < (order.get(right) ?? -1);
  if (rules.size !== world.rules.length || offers.size !== world.offers.length ||
      !acyclicRules(world.rules.map(({ definition }) => definition))) return false;
  for (const { definition, source } of world.rules) {
    const event = view.events.get(source);
    if (event?.kind !== "rule.installed" || event.rule_id !== definition.id || event.definition_digest !== canonicalDigest(definition) ||
        !validDefinition(world, definition, view, event.revision)) return false;
  }
  const topics = new Set<string>();
  for (const belief of world.beliefs) {
    if (belief.topic === undefined) continue;
    const key = canonicalJson([belief.character, belief.topic]);
    if (topics.has(key)) return false;
    topics.add(key);
  }
  const nextEffect = new Map<string, number>();
  for (const event of world.events) {
    if (event.kind === "rule.installed" && rules.get(event.rule_id)?.source !== event.id) return false;
    if (event.kind === "offer.accepted") {
      if (!before(event.offer_id, event.id) || view.events.get(event.offer_id)?.revision === event.revision) return false;
    }
    if (event.kind !== "rule.effect") continue;
    const { step } = event;
    const rule = rules.get(step.rule_id);
    const cause = view.events.get(step.event_id);
    if (!rule || !cause || cause.kind === "seed" || cause.request !== event.request || cause.proposal !== event.proposal ||
        cause.revision !== event.revision || !before(cause.id, event.id) || !before(rule.source, cause.id) ||
        view.events.get(rule.source)?.revision === event.revision || step.result_id !== event.id) return false;
    const key = canonicalJson([step.event_id, step.rule_id]);
    if (step.effect_index !== (nextEffect.get(key) ?? 0)) return false;
    nextEffect.set(key, step.effect_index + 1);
    const sourcedFacts = world.facts.filter(({ source }) => source === event.id);
    const sourcedBeliefs = world.beliefs.filter(({ source }) => source === event.id);
    const effect = step.effect;
    const uniqueEffects = new Set(step.effects.map(({ entity_id, field, change }) => canonicalJson([entity_id, field, change])));
    if (uniqueEffects.size !== step.effects.length) return false;
    if (effect.kind === "offer.transfer") {
      const offer = offers.get(effect.offer_id);
      const openedBy = view.events.get(effect.offer_id);
      if (cause.kind !== "offer.accepted" || cause.offer_id !== effect.offer_id || !offer ||
          openedBy?.kind !== "rule.effect" || openedBy.step.rule_id !== step.rule_id ||
          offer.consumed_by !== event.id || offer.item !== event.subject || sourcedBeliefs.length ||
          sourcedFacts.length !== 1 || sourcedFacts[0]?.field !== "inventory:holder" ||
          sourcedFacts[0].value !== world.player ||
          !offerEligible(world, view, offer.giver, offer.item, event.revision - 1)) return false;
      continue;
    }
    const declared = rule.definition.effects[step.effect_index];
    if (!declared || event.subject !== rule.definition.owner || !observedBy(rule.definition, cause) ||
        !view.observationRoom(rule.definition.owner, event.revision) ||
        rule.definition.conditions.some((condition) => condition.kind === "speech.equals" &&
          (cause.kind !== "speech" || cause.text !== condition.text)) ||
        canonicalJson(declared) !== canonicalJson(effect)) return false;
    switch (effect.kind) {
      case "belief.record":
        if (sourcedFacts.length || sourcedBeliefs.length !== 1 || sourcedBeliefs[0]?.topic !== effect.topic) return false;
        break;
      case "offer.create":
        if (sourcedFacts.length || sourcedBeliefs.length || offers.get(event.id)?.item !== effect.item) return false;
        break;
      case "relationship.adjust": {
        const field = "relationship:" + effect.target;
        const prior = world.facts.find((fact) => fact.subject === event.subject && fact.field === field && fact.until === event.revision);
        if (sourcedBeliefs.length || sourcedFacts.length !== 1 || sourcedFacts[0]?.field !== field ||
            !view.observationRoom(effect.target, event.revision) ||
            prior?.value !== (effect.step === 1 ? "acquaintance" : "friend") ||
            sourcedFacts[0].value !== (effect.step === 1 ? "friend" : "acquaintance")) return false;
        break;
      }
    }
  }
  const offered = new Set<string>();
  for (const offer of world.offers) {
    const creation = view.events.get(offer.id);
    if (creation?.kind !== "rule.effect" || creation.step.effect.kind !== "offer.create" ||
        creation.step.effect.item !== offer.item || creation.subject !== offer.giver ||
        offer.recipient !== world.player || !offerEligible(world, view, offer.giver, offer.item, creation.revision)) return false;
    const key = canonicalJson([offer.giver, offer.recipient, offer.item]);
    if (offered.has(key)) return false;
    offered.add(key);
    if (offer.consumed_by !== null) {
      const consumption = view.events.get(offer.consumed_by);
      if (!before(offer.id, offer.consumed_by) || consumption?.kind !== "rule.effect" ||
          consumption.step.effect.kind !== "offer.transfer" || consumption.step.effect.offer_id !== offer.id) return false;
    }
  }
  return true;
}
