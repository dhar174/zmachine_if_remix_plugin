
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
export function worldInspection(world: World, target: string, editor: boolean): { field: string; value: Json }[] {
  const facts: { field: string; value: Json }[] = world.facts.filter(({ subject, until, visibility }) => subject === target && until === null &&
    (visibility === "player" || editor)).map((fact) => ({ field: fact.field, value: fact }));
  const row = projectWorld(world).find(({ id }) => id === target);
  if (!row) return [];
  if (editor) {
    const knowledge = world.beliefs.filter(({ character }) => character === target).map((belief) => ({
      belief, evidence: world.events.find(({ id }) => id === belief.evidence) ?? null,
    }));
    if (knowledge.length > 0) facts.push({ field: "characterization:beliefs", value: knowledge });
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
