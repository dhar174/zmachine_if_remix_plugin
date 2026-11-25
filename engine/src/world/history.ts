
import { z } from "zod";
import { canonicalJson } from "../contracts.ts";
import type { CanonicalValue, Json } from "../contracts.ts";
import type { DurableReceipt, TurnImage } from "../turn/contracts.ts";
import type { TurnBudget } from "../turn/limits.ts";
import type { ResolverOperation } from "../policy/resolver-contracts.ts";
import { remixStateRef, validWorld } from "./model.ts";
import { runWorldPlan, WorldOperationError } from "./operations.ts";

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

type WorldTurn = { operations: readonly ResolverOperation[]; mode: "PLAY" | "EDITOR" };

export function receiptWorldTurn(record: DurableReceipt | null | undefined): WorldTurn | undefined {
  if (record?.world_operations) {
    return { operations: record.world_operations, mode: record.receipt.visibility === "owner" ? "EDITOR" : "PLAY" };
  }
}

export function worldTransitionValid(previous: TurnImage | undefined, image: TurnImage,
  rows: readonly Json[], request: DurableReceipt["receipt"]["request_id"] | undefined, turn?: WorldTurn, budget?: TurnBudget): boolean {
  const world = image.snapshot.world;
  const prior = previous?.snapshot.world;
  if (!world) return !prior && turn === undefined;
  if (previous && !prior) return false;
  const { checkpoint, snapshot } = image;
  const revision = checkpoint.revision;
  if (checkpoint.remix_state_ref !== remixStateRef(snapshot.entities, world) ||
      !validWorld(world, revision, snapshot.regions, snapshot.entities.map(({ id }) => id))) return false;
  if (!prior) return turn === undefined && world.version === "1.0.0" && world.events.length === 1 &&
    rows.every((row) => legacyEvent.safeParse(row).success);
  if (!prefix(prior.events, world.events) ||
      !same(previous?.snapshot.world_dependencies ?? [], snapshot.world_dependencies ?? [])) return false;
  const delta = world.events.slice(prior.events.length);
  if (delta.length === 0) return turn === undefined && same(prior, world) &&
    rows.every((row) => legacyEvent.safeParse(row).success);
  if (!request || !same(delta, [...rows]) ||
      delta.some((entry) => entry.kind === "seed" || entry.revision !== revision || entry.request !== request)) return false;

  if (world.version === "2.0.0") {
    const first = delta[0];
    if (!turn || !previous || !first || first.kind === "seed" || previous.checkpoint.revision + 1 !== revision) return false;
    // Portable import renames storage identities. Fictional event IDs remain bound to the recorded transition.
    try {
      const replay = runWorldPlan(previous.snapshot, {
        head: previous.snapshot.head, world_mode: turn.mode, request_id: request, proposal_digest: first.proposal,
        operations: turn.operations.map((operation) => ({ operation })),
      }, { budget, eventIds: delta.map(({ id }) => id) });
      return replay !== undefined && same(replay.events, delta) && same(replay.world, world);
    } catch (error) {
      if (error instanceof WorldOperationError) return false;
      throw error;
    }
  }
  if (prior.version === "2.0.0" || turn) return false;
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
