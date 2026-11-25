
import { z } from "zod";
import { canonicalJson } from "../contracts.ts";
import type { CanonicalValue, Json } from "../contracts.ts";
import type { TurnImage } from "../turn/contracts.ts";
import { remixStateRef, validWorld } from "./model.ts";

const same = (left: CanonicalValue, right: CanonicalValue) => canonicalJson(left) === canonicalJson(right);
const prefix = <T extends CanonicalValue>(old: T[], next: T[]) => same(old, next.slice(0, old.length));

// These are the current native and legacy fixture events that can accompany
// an unchanged world. A world-changing turn uses the overlay route exclusively.
const legacyEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("assignment"), field: z.string() }),
  z.strictObject({ kind: z.literal("inventory_transfer"), item: z.string() }),
  z.strictObject({ kind: z.literal("native_attempt"), counter: z.int().nonnegative(), draw: z.int().nonnegative() }),
  z.strictObject({ kind: z.literal("native_timer"), event: z.literal("chime"), turn: z.int().nonnegative() }),
  z.strictObject({ kind: z.literal("native_ending"), outcome: z.literal("won") }),
]);

export function worldTransitionValid(previous: TurnImage | undefined, image: TurnImage,
  rows: readonly Json[], request: string | undefined): boolean {
  const world = image.snapshot.world;
  const prior = previous?.snapshot.world;
  if (!world) return !prior;
  if (previous && !prior) return false;
  const { checkpoint, snapshot } = image;
  const revision = checkpoint.revision;
  if (checkpoint.remix_state_ref !== remixStateRef(snapshot.entities, world) ||
      !validWorld(world, revision, snapshot.regions, snapshot.entities.map(({ id }) => id))) return false;
  if (!prior) return world.version === "1.0.0" && world.events.length === 1 &&
    rows.every((row) => legacyEvent.safeParse(row).success);
  if (!prefix(prior.events, world.events) ||
      !same(previous?.snapshot.world_dependencies ?? [], snapshot.world_dependencies ?? [])) return false;
  const delta = world.events.slice(prior.events.length);
  if (delta.length === 0) return same(prior, world) && rows.every((row) => legacyEvent.safeParse(row).success);
  if (!request || !same(delta, [...rows]) ||
      delta.some((entry) => entry.kind === "seed" || entry.revision !== revision || entry.request !== request)) return false;

  if (world.player !== prior.player ||
      !prefix(prior.entities, world.entities) || !prefix(prior.exits, world.exits) ||
      !prefix(prior.beliefs, world.beliefs) || world.facts.length < prior.facts.length) return false;
  const newFacts = world.facts.slice(prior.facts.length);
  for (const [index, entry] of prior.facts.entries()) {
    const next = world.facts[index];
    if (!next || !same(entry, { ...next, until: entry.until })) return false;
    if (entry.until !== next.until &&
        (entry.until !== null || next.until !== revision ||
          !newFacts.some((fact) => fact.subject === entry.subject && fact.field === entry.field && fact.from === revision))) return false;
  }
  if (world.version === "1.0.0" && prior.version === "2.0.0") return false;
  if (world.version === "2.0.0") {
    const priorRules = prior.version === "2.0.0" ? prior.rules : [];
    const priorOffers = prior.version === "2.0.0" ? prior.offers : [];
    if (!prefix(priorRules, world.rules) || world.offers.length < priorOffers.length) return false;
    const steps = delta.filter((event) => event.kind === "rule.effect");
    const index = new Map(delta.map(({ id }, position) => [id, position]));
    let previousCause = -1;
    let previousRule = "";
    const counts = new Map<string, { length: number; actual: number }>();
    for (const { step } of steps) {
      const cause = index.get(step.event_id);
      if (cause === undefined || cause < previousCause || cause === previousCause && step.rule_id < previousRule) return false;
      previousCause = cause;
      previousRule = step.rule_id;
      if (step.effect.kind === "offer.transfer") continue;
      const length = priorRules.find(({ definition }) => definition.id === step.rule_id)?.definition.effects.length;
      if (length === undefined) return false;
      counts.set(canonicalJson([step.event_id, step.rule_id]), { length, actual: step.effect_index + 1 });
    }
    if (delta.slice(delta.length - steps.length).some(({ kind }) => kind !== "rule.effect") ||
        [...counts.values()].some(({ length, actual }) => length !== actual)) return false;
    const installs = delta.filter((event) => event.kind === "rule.installed");
    if (world.version !== prior.version && !installs.length ||
        !same(installs.map(({ id }) => id), world.rules.slice(priorRules.length).map(({ source }) => source))) return false;
    const offers = delta.filter((event) => event.kind === "rule.effect" && event.step.effect.kind === "offer.create");
    if (!same(offers.map(({ id }) => id), world.offers.slice(priorOffers.length).map(({ id }) => id)) ||
        world.offers.slice(priorOffers.length).some(({ consumed_by }) => consumed_by !== null)) return false;
    const acceptances = delta.filter((event) => event.kind === "offer.accepted");
    const transfers = delta.flatMap((event) => event.kind === "rule.effect" && event.step.effect.kind === "offer.transfer"
      ? [{ id: event.id, cause: event.step.event_id, offer_id: event.step.effect.offer_id }] : []);
    if (acceptances.length !== transfers.length ||
        !same(acceptances.map(({ id, offer_id }) => [id, offer_id]), transfers.map(({ cause, offer_id }) => [cause, offer_id]))) return false;
    const consumed = new Map(transfers.map(({ id, offer_id }) => [offer_id, id]));
    if (consumed.size !== transfers.length || priorOffers.some((offer, index) => {
      const next = world.offers[index];
      const newConsumption = consumed.get(offer.id);
      return !next || (offer.consumed_by !== null && newConsumption !== undefined) ||
        !same(next, { ...offer, consumed_by: newConsumption ?? offer.consumed_by });
    }) || transfers.some(({ offer_id }) => !priorOffers.some(({ id }) => id === offer_id))) return false;
  }
  const sources = new Set(delta.map(({ id }) => id));
  return [...world.entities.slice(prior.entities.length), ...world.exits.slice(prior.exits.length),
    ...world.beliefs.slice(prior.beliefs.length), ...newFacts].every(({ source }) => sources.has(source));
}
