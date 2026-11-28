
import { z } from "zod";
import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { CanonicalValue, Json } from "../contracts.ts";
import type { DurableReceipt, TurnImage } from "../turn/contracts.ts";
import type { TurnBudget } from "../turn/limits.ts";
import { operationTime, proposalOperations } from "../policy/resolver-contracts.ts";
import type { ResolverProposal } from "../policy/resolver-contracts.ts";
import { remixStateRef, validWorld } from "./model.ts";
import { runWorldPlan, WorldOperationError } from "./operations.ts";
import { isBridgeAction, pedestalRegion } from "../turn/bridge-contracts.ts";
import { bridgeImageValid, bridgeReceipt, bridgeTransition, sameFrozenNative } from "../turn/extension-bridge.ts";

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

type WorldTurn = { proposal: ResolverProposal; mode: "PLAY" | "EDITOR"; durableDigest?: string | undefined };

export function receiptWorldTurn(record: DurableReceipt | null | undefined, durableDigest?: string): WorldTurn | undefined {
  if (record?.world_proposal) {
    return { proposal: record.world_proposal, mode: record.receipt.visibility === "owner" ? "EDITOR" : "PLAY", durableDigest };
  }
}

export function worldTransitionValid(previous: TurnImage | undefined, image: TurnImage,
  rows: readonly Json[], request: DurableReceipt["receipt"]["request_id"] | undefined, turn?: WorldTurn, budget?: TurnBudget): boolean {
  const world = image.snapshot.world;
  const prior = previous?.snapshot.world;
  const nextBridge = image.checkpoint.bridge;
  const priorBridge = previous?.checkpoint.bridge;
  const operations = turn?.proposal.operations;
  const action = operations?.[0];
  if (image.snapshot.extension_anchor || !bridgeImageValid(image)) return false;
  if (action && isBridgeAction(action)) {
    if (!previous || !turn || !nextBridge || !world || operations?.length !== 1 || !request ||
        turn.proposal.amendment || image.amendment || (budget && budget.remaining() <= 0)) return false;
    const { proposal, mode, durableDigest } = turn;
    const { head } = previous.snapshot;
    const digest = canonicalDigest(proposal);
    const old = previous.checkpoint;
    const next = image.checkpoint;
    if (proposal.owner_id !== head.owner_id || proposal.mode !== mode || proposal.request_id !== request ||
        proposal.expected_revision !== old.revision || proposal.expected_policy_revision !== old.policy_revision ||
        next.revision !== old.revision + 1 || next.policy_revision !== old.policy_revision ||
        next.policy_ref !== old.policy_ref || next.clocks.overlay !== old.clocks.overlay ||
        !sameFrozenNative(previous, image) || !same(previous.snapshot.entities, image.snapshot.entities) ||
        !same(previous.snapshot.policy, image.snapshot.policy) || !same(previous.snapshot.history, image.snapshot.history) ||
        !same(previous.snapshot.applicability, image.snapshot.applicability) ||
        !same(previous.snapshot.world_dependencies ?? [], image.snapshot.world_dependencies ?? [])) return false;
    if (durableDigest !== undefined && (digest !== durableDigest || proposal.session_id !== head.session_id ||
        proposal.branch_id !== head.branch_id || proposal.generation_id !== head.generation_id)) return false;
    const regions = action.kind === "bridge.author" && !previous.snapshot.regions.includes(pedestalRegion)
      ? [...previous.snapshot.regions, pedestalRegion] : previous.snapshot.regions;
    const replay = bridgeTransition(previous, proposal, digest, mode, action);
    return replay !== undefined && same(replay.bridge, nextBridge) && same(replay.world, world) &&
      same(replay.events, [...rows]) && same(image.snapshot.regions, regions) &&
      image.checkpoint.remix_state_ref === remixStateRef(image.snapshot.entities, world) &&
      validWorld(world, next.revision, regions, image.snapshot.entities.map(({ id }) => id)) &&
      (!budget || budget.remaining() > 0);
  }
  if (operations?.some(isBridgeAction) || rows.some((row) =>
    row !== null && typeof row === "object" && !Array.isArray(row) && typeof row.kind === "string" && isBridgeAction({ kind: row.kind }))) return false;
  if (!same(priorBridge ?? null, nextBridge ?? null)) return false;
  const paused = priorBridge?.owner === "remix";
  const overlayDelta = previous ? image.checkpoint.clocks.overlay - previous.checkpoint.clocks.overlay : 0;
  if (priorBridge && previous) {
    if (paused ? !sameFrozenNative(previous, image) : overlayDelta !== 0) return false;
  }
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
  if (delta.length === 0) return turn === undefined && same(prior, world) && (!paused || overlayDelta === 0) && rows.every((row) => {
    const parsed = legacyEvent.safeParse(row);
    return parsed.success && (!paused || parsed.data.kind === "assignment");
  });
  if (!request || priorBridge?.owner === "native" || !same(delta, [...rows]) ||
      delta.some((entry) => entry.kind === "seed" || entry.revision !== revision || entry.request !== request)) return false;

  if (world.version === "2.0.0" || paused) {
    const first = delta[0];
    if (!turn || !previous || !first || first.kind === "seed" || previous.checkpoint.revision + 1 !== revision) return false;
    const { proposal, mode, durableDigest } = turn;
    const { head } = previous.snapshot;
    const digest = canonicalDigest(proposal);
    if (proposal.owner_id !== head.owner_id || proposal.mode !== mode || proposal.request_id !== request ||
        proposal.expected_revision !== head.expected_revision || proposal.expected_policy_revision !== head.expected_policy_revision ||
        !same(proposal.amendment?.compiled ?? null, image.amendment) || digest !== first.proposal) return false;
    if (durableDigest !== undefined && (digest !== durableDigest || proposal.session_id !== head.session_id ||
        proposal.branch_id !== head.branch_id || proposal.generation_id !== head.generation_id)) return false;
    const planned = proposalOperations(proposal);
    if (paused) {
      const time = operationTime(mode, planned);
      if (time === "native" || overlayDelta !== (time === "overlay" ? 1 : 0)) return false;
    }
    // Portable relocation changes storage scope. Recompute fictional event IDs using the original producing generation.
    const originalHead = { ...head, generation_id: proposal.generation_id };
    try {
      const replay = runWorldPlan({ ...previous.snapshot, head: originalHead }, {
        head: originalHead, world_mode: mode, request_id: request, proposal_digest: digest,
        operations: planned.map((operation) => ({ operation })),
      }, { budget });
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

export function persistedTransitionValid(previous: TurnImage | undefined, image: TurnImage,
  rows: readonly Json[], record: DurableReceipt | null | undefined, durableDigest?: string): boolean {
  if (!worldTransitionValid(previous, image, rows, record?.receipt.request_id, receiptWorldTurn(record, durableDigest))) return false;
  if (!record) return !image.checkpoint.bridge || previous !== undefined && sameFrozenNative(previous, image) &&
    previous.checkpoint.clocks.overlay === image.checkpoint.clocks.overlay;
  const first = record.world_proposal?.operations[0];
  const transition = first && isBridgeAction(first) ? first.kind : undefined;
  const expected = bridgeReceipt(previous, image, transition);
  if (!same(expected ?? null, record.bridge ?? null)) return false;
  if (!expected) return true;
  return record.receipt.time_cost === expected.clocks.native_delta + expected.clocks.overlay_delta &&
    (previous?.checkpoint.bridge?.owner !== "remix" || record.receipt.native_output.length === 0) &&
    (!transition || record.receipt.native_output.length === 0 && record.receipt.narration_facts.length === 0 &&
      record.receipt.in_fiction_result === "success");
}
