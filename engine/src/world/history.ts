
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
  if (!prior) return world.events.length === 1 && rows.every((row) => legacyEvent.safeParse(row).success);
  if (!prefix(prior.events, world.events)) return false;
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
  const sources = new Set(delta.map(({ id }) => id));
  return [...world.entities.slice(prior.entities.length), ...world.exits.slice(prior.exits.length),
    ...world.beliefs.slice(prior.beliefs.length), ...newFacts].every(({ source }) => sources.has(source));
}
