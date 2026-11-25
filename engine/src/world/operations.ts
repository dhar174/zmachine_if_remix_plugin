
import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { EffectPlan, EffectRef, EntityProjection, PolicyAction, ResolverOperation, ResolverSnapshot } from "../policy/resolver-contracts.ts";
import { World, activeFact, eligibleFact, isHolder, relationshipTarget, validWorld, worldView } from "./model.ts";
import type { WorldEvent } from "./model.ts";
import { ownedByWorld, projectWorld, visibleWorldNote, worldInspection, worldTargetVisible } from "./projection.ts";

type PlanInput = Pick<EffectPlan, "operations" | "head" | "proposal_digest" | "request_id" | "world_mode">;
type Intent = { request: string; proposal: string; revision: number; index: number; mode: ResolverSnapshot["mode"] };
type Surface = EntityProjection["surfaces"][number];

export class WorldOperationError extends Error {
  readonly status: "CAPABILITY_MISSING" | "NEEDS_CLARIFICATION" | "VALIDATION_FAILED";

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

export function evaluateWorldOperation(snapshot: ResolverSnapshot, operation: ResolverOperation, intent: Intent) {
  if (!snapshot.world) throw missing("The session has no registered remix world.");
  const base = snapshot.world;
  const next = structuredClone(base);
  const id = "world-event:" + canonicalDigest([snapshot.head.generation_id, intent.request, intent.revision, intent.index]);
  const eventBase = { id, revision: intent.revision, request: intent.request, proposal: intent.proposal };
  const before = projectWorld(base);
  let action: PolicyAction | null = null;
  let event: WorldEvent | undefined;
  const reads: { id: string; field: string }[] = [];
  const { entities, events, listenersAt, observable, observationRoom, roomOf, rootHolder } = worldView(base);
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
  switch (operation.kind) {
    case "inspect.entity": {
      const entity = before.find(({ id }) => id === operation.entity_id);
      const editor = intent.mode === "EDITOR";
      if (!entity || !editor && !worldTargetVisible(base, operation.entity_id, intent.revision)) {
        throw unclear("The target is not available for inspection.");
      }
      const visible = new Set(worldInspection(base, entity.id, editor, intent.revision).map(({ field }) => field));
      const effects = entity.surfaces.filter(({ field }) => visible.has(field))
        .map((surface) => ({ ref: { entity_id: entity.id, field: surface.field, change: "read" as const }, entity, surface }));
      return { next: base, effects, action, event };
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
  next.events.push(event);
  const parsed = World.safeParse(next);
  if (!parsed.success || !validWorld(parsed.data, intent.revision, snapshot.regions, snapshot.entities.map(({ id }) => id))) {
    throw invalid("The proposed world violates identity, placement, provenance, or size constraints.");
  }
  const effects = beforeAndAfter(before, projectWorld(parsed.data));
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
  return { next: parsed.data, effects, action, event };
}

export function runWorldPlan(snapshot: ResolverSnapshot, plan: PlanInput) {
  if (!plan.world_mode) return undefined;
  if (!snapshot.world || plan.operations.length === 0 || !plan.operations.every(({ operation }) => usesWorld(snapshot, operation))) {
    throw invalid("The validated plan does not belong to this remix world.");
  }
  let current = snapshot.world;
  const events: WorldEvent[] = [];
  const notes: string[] = [];
  for (const [index, { operation, effects }] of plan.operations.entries()) {
    const result = evaluateWorldOperation({ ...snapshot, world: current }, operation, {
      request: plan.request_id, proposal: plan.proposal_digest, revision: plan.head.expected_revision + 1, index, mode: plan.world_mode,
    });
    const keys = (refs: readonly { entity_id: string; field: string; change: string }[]) =>
      refs.map(({ entity_id, field, change }) => canonicalJson([entity_id, field, change])).sort();
    if (!result.event || canonicalJson(keys(effects)) !== canonicalJson(keys(result.effects.map(({ ref }) => ref)))) {
      throw invalid("Execution differed from the validated remix-world footprint.");
    }
    current = result.next;
    events.push(result.event);
    if (result.event.kind === "speech") {
      const { kind, speaker, text } = result.event;
      notes.push(canonicalJson({ kind, speaker, text }));
    } else if (operation.kind === "overlay.create") {
      notes.push(canonicalJson({ kind: operation.kind, entity: operation.entity, label: operation.label,
        entity_kind: operation.entity_kind, holder: operation.holder, room: operation.room }));
    } else if (operation.kind === "overlay.connect" || operation.kind === "inventory.transfer") {
      notes.push(canonicalJson(operation));
    }
  }
  const facts = plan.world_mode === "EDITOR" ? notes : notes.flatMap((note) => {
    const visible = visibleWorldNote(note, current, plan.head.expected_revision + 1);
    return visible === undefined ? [] : [visible];
  });
  return { world: current, events, facts };
}
