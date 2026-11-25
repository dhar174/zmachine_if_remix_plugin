
import { z } from "zod";
import { canonicalDigest } from "../contracts.ts";
import type { CanonicalValue } from "../contracts.ts";
import { Offer, RuleDefinition, RuleStep, ruleLimits } from "./rule-contracts.ts";
import { validBehaviorState } from "./rule-state.ts";

const remixId = z.string().regex(/^remix:[A-Za-z0-9._:-]+$/).max(200);
const regionId = z.string().regex(/^region:[A-Za-z0-9._:-]+$/).max(256);
const eventId = z.string().regex(/^world-event:[A-Za-z0-9._:-]+$/).max(256);
const revision = z.int().nonnegative();
const label = z.string().min(1).max(256).refine((value) => value === value.trim());
const prose = z.string().min(1).max(2048);
const common = { id: remixId, label, source: eventId };
const entity = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("location"), region: regionId }),
  z.strictObject({ ...common, kind: z.literal("character"), room: remixId }),
  z.strictObject({ ...common, kind: z.literal("item"), container: z.boolean() }),
]);
const exit = z.strictObject({ id: remixId, from: remixId, to: remixId, source: eventId });
const validity = { from: revision, until: revision.nullable(), source: eventId, owner: z.literal("remix"),
  visibility: z.enum(["player", "owner"]), evidence: z.enum(["fixture", "editor_committed", "play_committed"]) };
const fieldName = z.string().regex(/^(inventory:holder|world:description|world:private_note|relationship:remix:[A-Za-z0-9._:-]+)$/).max(256);
const fact = z.strictObject({ ...validity, subject: remixId, field: fieldName, value: prose });
const belief = z.strictObject({ ...validity, visibility: z.literal("owner"), character: remixId, evidence: eventId, evidence_status: z.literal("play_committed") });
const request = { id: eventId, revision, request: z.string().regex(/^request:[A-Za-z0-9._:-]+$/).max(256),
  proposal: z.string().regex(/^[0-9a-f]{64}$/) };
const event = z.discriminatedUnion("kind", [
  z.strictObject({ id: eventId, revision, kind: z.literal("seed") }),
  z.strictObject({ ...request, kind: z.literal("change"), mode: z.enum(["PLAY", "EDITOR"]), subject: remixId }),
  z.strictObject({ ...request, kind: z.literal("speech"), speaker: remixId, room: remixId, text: prose, listeners: z.array(remixId).max(512) }),
  z.strictObject({ ...request, kind: z.literal("observation"), observer: remixId, room: remixId,
    subject: remixId, field: fieldName, fact_source: eventId }),
]);

const worldFields = {
  player: remixId,
  entities: z.array(entity).max(512),
  exits: z.array(exit).max(512),
  facts: z.array(fact).max(2048),
};
const behaviorEvent = z.discriminatedUnion("kind", [
  ...event.options,
z.strictObject({ ...request, kind: z.literal("rule.installed"), rule_id: RuleDefinition.shape.id,
    definition_digest: z.string().regex(/^[0-9a-f]{64}$/u), mode: z.enum(["PLAY", "EDITOR"]) }),
  z.strictObject({ ...request, kind: z.literal("offer.accepted"), offer_id: eventId }),
  z.strictObject({ ...request, kind: z.literal("rule.effect"), subject: remixId, step: RuleStep }),
]);

export const World = z.discriminatedUnion("version", [
  z.strictObject({ ...worldFields, version: z.literal("1.0.0"), beliefs: z.array(belief).max(1024),
    events: z.array(event).max(2048) }),
  z.strictObject({ ...worldFields, version: z.literal("2.0.0"),
    beliefs: z.array(belief.extend({ topic: z.string().regex(/^topic:[A-Za-z0-9._:-]+$/u).max(200).optional() })).max(1024),
    events: z.array(behaviorEvent).max(2048),
    rules: z.array(z.strictObject({ definition: RuleDefinition, source: eventId })).max(ruleLimits.rules),
    offers: z.array(Offer).max(512),
  }),
]);

export type World = z.infer<typeof World>;
export type BehaviorWorld = Extract<World, { version: "2.0.0" }>;
export type WorldEntity = World["entities"][number];
export type WorldEvent = World["events"][number];
export type WorldFact = World["facts"][number];
export type WorldBelief = World["beliefs"][number];

export function remixStateRef(entities: CanonicalValue, world: World | undefined): string {
  return "blob:" + canonicalDigest(world === undefined ? entities : { entities, world });
}

export function activeFact(world: World, subject: string, field: string): WorldFact | undefined {
  return world.facts.find((fact) => fact.subject === subject && fact.field === field && fact.until === null);
}

export const relationshipTarget = (field: string): string | undefined =>
  field.startsWith("relationship:") ? field.slice("relationship:".length) : undefined;

export function eligibleFact(world: World, subject: string, field: string, value: string): boolean {
  if (field === "world:description" || field === "world:private_note") return true;
  const target = relationshipTarget(field);
  return target !== undefined && target !== subject &&
    world.entities.some(({ id, kind }) => id === subject && kind === "character") &&
    world.entities.some(({ id, kind }) => id === target && kind === "character") &&
    (value === "friend" || value === "acquaintance");
}

export function isHolder(entity: WorldEntity | undefined): boolean {
  return entity !== undefined && (entity.kind !== "item" || entity.container);
}

function containsRevision(fact: WorldFact, at: number) {
  return fact.from <= at && (fact.until === null || at < fact.until);
}

/** Rooms and characters are stationary in the first slice. Item ancestry is revision-specific. */
export function worldView(world: World) {
  const entities = new Map(world.entities.map((record) => [record.id, record]));
  const events = new Map(world.events.map((record) => [record.id, record]));
  const placements = new Map<string, WorldFact[]>();
  for (const fact of world.facts) {
    if (fact.field !== "inventory:holder") continue;
    const entries = placements.get(fact.subject) ?? [];
    entries.push(fact);
    placements.set(fact.subject, entries);
  }
  const presentAt = (entity: WorldEntity, at: number) => (events.get(entity.source)?.revision ?? Infinity) <= at;
  const holderAt = (item: string, at?: number) =>
    placements.get(item)?.find((fact) => at === undefined ? fact.until === null : containsRevision(fact, at))?.value;
  function rootHolder(id: string, at?: number): string | undefined {
    const seen = new Set<string>();
    let entity = entities.get(id);
    while (entity?.kind === "item") {
      if (seen.has(entity.id) || seen.size >= 16) return;
      seen.add(entity.id);
      entity = entities.get(holderAt(entity.id, at) ?? "");
    }
    return entity?.id;
  }
  function roomOf(id: string, at?: number): string | undefined {
    const entity = entities.get(rootHolder(id, at) ?? "");
    return entity?.kind === "character" ? entity.room : entity?.id;
  }
  function listenersAt(speaker: string, room: string, at: number): string[] {
    return world.entities.filter((entity) => entity.kind === "character" && entity.id !== speaker && entity.room === room &&
      presentAt(entity, at)).map(({ id }) => id).sort();
  }
  function observationRoom(observer: string, at: number): string | undefined {
    const player = entities.get(world.player);
    const witness = entities.get(observer);
    if (player?.kind === "character" && witness?.kind === "character" && player.room === witness.room &&
        presentAt(player, at) && presentAt(witness, at)) return player.room;
  }
  function observable(fact: WorldFact, room: string, at: number): boolean {
    const target = relationshipTarget(fact.field);
    return fact.visibility === "player" && roomOf(fact.subject, at) === room &&
      (target === undefined || roomOf(target, at) === room);
  }
return { entities, events, presentAt, holderAt, rootHolder, roomOf, listenersAt, observable, observationRoom };
}

export function validWorld(world: World, revision: number, regions: readonly string[], otherIds: readonly string[]): boolean {
  const { entities, events, presentAt, roomOf, listenersAt, observable, observationRoom } = worldView(world);
  const ids = [...otherIds, ...world.entities.map(({ id }) => id), ...world.exits.map(({ id }) => id)];
  const seed = world.events[0];
  if (new Set(ids).size !== ids.length || events.size !== world.events.length || entities.get(world.player)?.kind !== "character" ||
      seed?.kind !== "seed" || world.events.slice(1).some((record, i) => record.kind === "seed" ||
        record.revision < (world.events[i]?.revision ?? Infinity))) return false;
  const bySource = (id: string, subject: string) => {
    const source = events.get(id);
    if (source?.kind === "seed" || ((source?.kind === "change" || source?.kind === "rule.effect") && source.subject === subject)) return source;
  };
  const atEntity = (id: string, at: number, kind?: WorldEntity["kind"]) => {
    const item = entities.get(id);
    return !!item && (!kind || item.kind === kind) && presentAt(item, at);
  };
  for (const item of world.entities) {
    const source = bySource(item.source, item.id);
    if (!source || source.kind === "rule.effect" || source.revision > revision ||
        (item.kind === "location" && !regions.includes(item.region)) ||
        (item.kind === "character" && !atEntity(item.room, source.revision, "location"))) return false;
  }
  const pairs = world.exits.map(({ from, to }) => from + "/" + to);
  if (new Set(pairs).size !== pairs.length || world.exits.some((exit) => {
    const source = bySource(exit.source, exit.id);
    return !source || source.kind === "rule.effect" || source.revision > revision || exit.from === exit.to ||
      !atEntity(exit.from, source.revision, "location") || !atEntity(exit.to, source.revision, "location");
  })) return false;

  const slots = new Map<string, WorldFact[]>();
  for (const fact of world.facts) {
    const source = bySource(fact.source, fact.subject);
    const target = relationshipTarget(fact.field);
    if (!source || source.revision !== fact.from || fact.from > revision ||
    fact.evidence !== (source.kind === "seed" ? "fixture" : source.kind === "change" && source.mode === "EDITOR" ? "editor_committed" : "play_committed") ||
        (fact.until !== null && (fact.until <= fact.from || fact.until > revision)) ||
        fact.visibility !== (fact.field === "world:private_note" ? "owner" : "player") ||
        !atEntity(fact.subject, fact.from) || (target !== undefined && !atEntity(target, fact.from))) return false;
    if (fact.field === "inventory:holder") {
      if (entities.get(fact.subject)?.kind !== "item" || !isHolder(entities.get(fact.value)) || !atEntity(fact.value, fact.from)) return false;
    } else if (!eligibleFact(world, fact.subject, fact.field, fact.value)) return false;
    const key = fact.subject + "/" + fact.field;
    const slot = slots.get(key) ?? [];
    slot.push(fact);
    slots.set(key, slot);
  }
  for (const slot of slots.values()) {
    slot.sort((a, b) => a.from - b.from);
    if (slot.some((entry, i) => entry.until !== (slot[i + 1]?.from ?? null))) return false;
  }
  for (const item of world.entities.filter(({ kind }) => kind === "item")) {
    if (slots.get(item.id + "/inventory:holder")?.[0]?.from !== events.get(item.source)?.revision || !roomOf(item.id)) return false;
  }
  // Every historical containment change must also terminate at a room.
  if (world.facts.some((fact) => fact.field === "inventory:holder" && !roomOf(fact.subject, fact.from))) return false;

  const changeSources = new Set([...world.entities, ...world.exits, ...world.facts, ...world.beliefs].map(({ source }) => source));
  for (const record of world.events) {
    if (record.revision > revision || record.kind === "change" && !changeSources.has(record.id)) return false;
    if (record.kind === "speech" && (record.speaker !== world.player ||
        !atEntity(record.speaker, record.revision, "character") || roomOf(record.speaker, record.revision) !== record.room ||
        record.listeners.join("/") !== listenersAt(record.speaker, record.room, record.revision).join("/"))) return false;
    if (record.kind === "observation") {
      const evidence = world.facts.find((fact) => fact.subject === record.subject && fact.field === record.field &&
        fact.source === record.fact_source && containsRevision(fact, record.revision));
      if (!evidence || observationRoom(record.observer, record.revision) !== record.room ||
          !observable(evidence, record.room, record.revision)) return false;
    }
  }
  const distinctBeliefs = new Set<string>();
  for (const entry of world.beliefs) {
    const proof = events.get(entry.evidence);
    const source = bySource(entry.source, entry.character);
    const topic = "topic" in entry ? entry.topic : undefined;
    const key = entry.character + "/" + entry.evidence + "/" + (topic ?? "");
    const attributed = source?.kind === "rule.effect" && source.step.effect.kind === "belief.record" &&
      source.step.effect.topic === topic && source.step.event_id === entry.evidence;
    const priorEvidence = source?.kind === "change" && source.mode === "PLAY" && topic === undefined &&
      proof !== undefined && proof.revision < entry.from;
    if (distinctBeliefs.has(key) || !proof || (!attributed && !priorEvidence) ||
        source?.revision !== entry.from || entry.until !== null ||
        (proof.kind !== "speech" || !proof.listeners.includes(entry.character)) &&
        (proof.kind !== "observation" || proof.observer !== entry.character)) return false;
    distinctBeliefs.add(key);
  }
  return world.version === "1.0.0" || validBehaviorState(world, worldView(world));
}
