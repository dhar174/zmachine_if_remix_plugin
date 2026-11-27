import { z } from "zod";
import { canonicalJson } from "../contracts.ts";

import type { Json } from "../contracts.ts";
import type { EntityProjection } from "../policy/resolver-contracts.ts";
import { isHolder, relationshipTarget, worldView } from "./model.ts";
import type { World } from "./model.ts";

type Surface = EntityProjection["surfaces"][number];

function surface(field: string, domain: Surface["domain"], value: Json | undefined, evidence_id: string,
  direct_assignment = false): Surface {
  return { field, owner: "remix", domain, direct_assignment, risk: "consequential", coverage: "complete", dependencies: [],
    fact: value === undefined ? { state: "absent", evidence_id } : { state: "present", value, evidence_id } };
}

export function projectWorld(world: World): EntityProjection[] {
  const { entities, roomOf } = worldView(world);
  const regions = (id: string) => {
    const room = entities.get(roomOf(id) ?? "");
    return room?.kind === "location" ? [room.region] : null;
  };
  return [
    ...world.entities.map((entity): EntityProjection => {
      const { id, source } = entity;
      const surfaces = [surface("entity:record", "identity", entity, source)];
      if (entity.kind === "location") {
        surfaces.push(surface("topology:exits", "topology", world.exits.filter(({ from, to }) => from === id || to === id)
          .map(({ id }) => id).sort(), source));
        surfaces.push(surface("identity:occupants", "identity", world.entities
          .filter((candidate) => candidate.kind === "character" && candidate.room === id).map(({ id }) => id).sort(), source));
      }
      if (isHolder(entity)) {
        const contents = world.facts.filter((fact) => fact.field === "inventory:holder" && fact.until === null && fact.value === id)
          .map(({ subject }) => subject).sort();
        surfaces.push(surface("inventory:contents", "inventory", contents, source));
      }
      for (const fact of world.facts.filter(({ subject, until }) => subject === id && until === null)) {
        const domain = fact.field === "inventory:holder" ? "inventory" : relationshipTarget(fact.field) ? "characterization" : "presentation";
        surfaces.push(surface(fact.field, domain, fact.value, fact.source, domain !== "inventory"));
      }
      const incoming = world.facts.filter(({ field, until }) => until === null && relationshipTarget(field) === id)
        .map(({ subject, value }) => ({ subject, value })).sort((a, b) => a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
      if (incoming.length > 0) surfaces.push(surface("relationship:incoming", "characterization", incoming, source));
      if (entity.kind === "character") {
        const speech = world.events.filter((event) => event.kind === "speech" && (event.speaker === id || event.listeners.includes(id)))
          .map(({ id }) => id);
        const observations = world.events.filter((event) => event.kind === "observation" && event.observer === id).map(({ id }) => id);
        const beliefs = world.beliefs.filter(({ character }) => character === id).map(({ source }) => source);
        if (world.version === "2.0.0") {
          surfaces.push(surface("behavior:rules", "characterization", world.rules
            .filter(({ definition }) => definition.owner === id).map(({ definition }) => definition.id), source),
          surface("inventory:offers", "inventory", world.offers
            .filter(({ giver, recipient }) => giver === id || recipient === id), source));
        }
        surfaces.push(surface("dialogue:speech", "dialogue", speech, source),
          surface("dialogue:observation", "dialogue", observations, source),
          surface("characterization:beliefs", "characterization", beliefs, source));
      }
      return { id, origin: "remix", region_ids: regions(id), existence: "present", evidence_id: source, surfaces, takeover_surfaces: null };
    }),
    ...world.exits.map((exit): EntityProjection => ({
      id: exit.id, origin: "remix", region_ids: regions(exit.from), existence: "present", evidence_id: exit.source,
      surfaces: [surface("topology:connection", "topology", exit, exit.source)], takeover_surfaces: null,
    })),
  ];
}

/** Current explicit inspection. Historical and model-context selection are separate. */
export function worldTargetVisible(world: World, target: string, revision: number): boolean {
  const { roomOf } = worldView(world);
  const scene = roomOf(world.player, revision);
  const exit = world.exits.find(({ id }) => id === target);
  return scene !== undefined && (exit ? exit.from === scene : roomOf(target, revision) === scene);
}

export function worldInspection(world: World, target: string, editor: boolean, revision: number): { field: string; value: Json }[] {
  const { roomOf, observable } = worldView(world);
  const scene = roomOf(world.player, revision);
  if (!editor && !worldTargetVisible(world, target, revision)) return [];
  const facts: { field: string; value: Json }[] = world.facts.filter((fact) => fact.subject === target && fact.until === null &&
    (editor || scene !== undefined && observable(fact, scene, revision))).map((fact) => ({ field: fact.field, value: fact }));
  const row = projectWorld(world).find(({ id }) => id === target);
  if (!row) return [];
  if (editor) {
    const knowledge = world.beliefs.filter(({ character }) => character === target).map((belief) => ({
      belief, evidence: world.events.find(({ id }) => id === belief.evidence) ?? null,
    }));
    if (knowledge.length > 0) facts.push({ field: "characterization:beliefs", value: knowledge });
    if (world.version === "2.0.0") {
      const rules = world.rules.filter(({ definition }) => definition.owner === target);
      if (rules.length > 0) facts.push({ field: "behavior:rules", value: rules });
    }
  }
  const structural = row.surfaces.flatMap(({ field, fact }) => {
    if (fact.state !== "present") return [];
    if (field === "topology:exits") {
      return [{ field, value: world.exits.filter(({ from }) => from === target) }];
    }
    return ["entity:record", "inventory:contents", "topology:connection"].includes(field) ? [{ field, value: fact.value }] : [];
  });
  return [...structural, ...facts];
}

export function ownedByWorld(world: World, id: string): boolean {
  return world.entities.some((record) => record.id === id) || world.exits.some((record) => record.id === id);
}


const worldNote = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("offer.created"), id: z.string(), item: z.string(),
    giver: z.string(), recipient: z.string() }),
  z.strictObject({ kind: z.literal("speech"), speaker: z.string(), text: z.string() }),
  z.strictObject({ kind: z.literal("overlay.create"), entity: z.string(), entity_kind: z.enum(["location", "character", "item"]),
    label: z.string(), room: z.string().optional(), holder: z.string().optional() }),
  z.strictObject({ kind: z.literal("overlay.connect"), connection: z.string(), from: z.string(), to: z.string() }),
  z.strictObject({ kind: z.literal("inventory.transfer"), item: z.string(), from: z.string(), to: z.string() }),
]);

/** Revalidate structured narration against the revision that produced it. */
export function visibleWorldNote(text: string, world: World | undefined, revision: number): string | undefined {
  if (!world) return;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return; }
  const parsed = worldNote.safeParse(raw);
  if (!parsed.success) return;
  const note = parsed.data;
  const { entities, events, roomOf } = worldView(world);
  const scene = roomOf(world.player, revision);
  if (!scene) return;
  const createdAt = (source: string) => events.get(source)?.revision === revision;
  switch (note.kind) {
    case "offer.created": {
      const offer = world.version === "2.0.0" && world.offers.find(({ id }) => id === note.id);
      if (!offer || !createdAt(offer.id) || offer.item !== note.item || offer.giver !== note.giver ||
          offer.recipient !== note.recipient || offer.recipient !== world.player ||
          roomOf(offer.giver, revision) !== scene || roomOf(offer.item, revision) !== scene) return;
      break;
    }
    case "speech":
      if (!world.events.some((event) => event.kind === "speech" && event.revision === revision && event.room === scene &&
          event.speaker === note.speaker && event.text === note.text)) return;
      break;
    case "overlay.create": {
      const entity = entities.get(note.entity);
      if (!entity || entity.kind === "location" || entity.kind !== note.entity_kind || entity.label !== note.label ||
          !createdAt(entity.source) || roomOf(entity.id, revision) !== scene ||
          (entity.kind === "character" ? note.room !== entity.room || note.holder !== undefined :
            note.room !== undefined || !world.facts.some((fact) => fact.subject === entity.id &&
              fact.field === "inventory:holder" && fact.from === revision && fact.value === note.holder))) return;
      break;
    }
    case "overlay.connect":
      if (!world.exits.some((exit) => exit.id === note.connection && exit.from === scene && exit.from === note.from &&
          exit.to === note.to && createdAt(exit.source))) return;
      break;
    case "inventory.transfer": {
      if ([note.item, note.from, note.to].some((id) => roomOf(id, revision) !== scene)) return;
      const placements = world.facts.filter((fact) => fact.subject === note.item && fact.field === "inventory:holder");
      if (!placements.some((fact) => fact.until === revision && fact.value === note.from) ||
          !placements.some((fact) => fact.from === revision && fact.value === note.to)) return;
      break;
    }
  }
  return canonicalJson(note);
}
