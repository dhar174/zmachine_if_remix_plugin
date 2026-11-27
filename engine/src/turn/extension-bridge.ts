import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { Json } from "../contracts.ts";
import { checkpointView, nativeIdentity, nativePayload, nativeStory, objects, validateCheckpoint } from "../native/checkpoint.ts";
import { World, worldView } from "../world/model.ts";
import { pedestalAnchor, pedestalRegion } from "./bridge-contracts.ts";
import type { BridgeAction, BridgeReceipt, BridgeState } from "./bridge-contracts.ts";
import type { ResolverProposal } from "../policy/resolver-contracts.ts";
import type { TurnImage } from "./contracts.ts";
import type { z } from "zod";

type ProducingTurn = Pick<ResolverProposal, "generation_id" | "request_id">;
export const extensionPlayer = "remix:player";
export const extensionRoomId = (turn: ProducingTurn) =>
  "remix:extension-" + canonicalDigest([turn.generation_id, turn.request_id]);

function hasPedestalBuild({ checkpoint }: TurnImage): boolean {
  if (checkpoint.story_sha256 !== nativeStory) return false;
  const identity = nativeIdentity();
  return checkpoint.runtime_build === identity.runtime_build && checkpoint.adapter_build === identity.adapter_build &&
    checkpoint.checkpoint_format === identity.checkpoint_format;
}

export function atPedestal(image: TurnImage): boolean {
  try {
    if (!hasPedestalBuild(image) || image.checkpoint.native_state.pending_input.kind !== "line") return false;
    const { checkpoint } = nativePayload.parse(image.native);
    validateCheckpoint(checkpoint);
    const view = checkpointView(checkpoint);
    return view.room === objects.vault && view.pending.kind === "line" &&
      !view.locked && view.open && view.dead === 0 && view.turns === image.checkpoint.clocks.native;
  } catch {
    return false;
  }
}

export function bridgeImageValid(image: TurnImage): boolean {
  const { checkpoint, snapshot, native } = image;
  const bridge = checkpoint.bridge;
  if (!bridge) return true;
  if (!hasPedestalBuild(image) || !snapshot.world || !snapshot.regions.includes(pedestalRegion)) return false;
  const { entities, roomOf } = worldView(snapshot.world);
  const room = entities.get(bridge.room_id);
  if (room?.kind !== "location" || room.region !== pedestalRegion || snapshot.world.player !== extensionPlayer ||
      roomOf(extensionPlayer) !== bridge.room_id ||
      snapshot.world.entities.some((entity) => entity.kind === "location" && entity.id !== bridge.room_id) ||
      snapshot.world.exits.length !== 0) return false;
  if (bridge.owner === "native") return checkpoint.clocks.policy === "native_running";
  return checkpoint.clocks.policy === "native_paused" && atPedestal(image) &&
    bridge.capsule.native_tick === checkpoint.clocks.native &&
    bridge.capsule.payload_sha256 === checkpoint.native_state.payload_sha256 &&
    bridge.capsule.payload_sha256 === canonicalDigest(native);
}

export function bridgeContext(image: TurnImage): { at_anchor: boolean; bridge?: BridgeState | undefined } {
  return { at_anchor: atPedestal(image), bridge: image.checkpoint.bridge };
}

export function bridgeActionAllowed(context: ReturnType<typeof bridgeContext> | undefined,
  hasWorld: boolean, action: BridgeAction): boolean {
  if (!context?.at_anchor || action.anchor_id !== pedestalAnchor) return false;
  const { bridge } = context;
  switch (action.kind) {
    case "bridge.author": return bridge === undefined && !hasWorld;
    case "bridge.enter": return bridge?.owner === "native" && bridge.room_id === action.room_id;
    case "bridge.return": return bridge?.owner === "remix";
  }
}

type Transition = { bridge: BridgeState; world: World; events: Json[] };

export function bridgeTransition(image: TurnImage, turn: ProducingTurn, proposal: string, mode: "PLAY" | "EDITOR",
  action: BridgeAction): Transition | undefined {
  const { checkpoint, snapshot } = image;
  const prior = checkpoint.bridge;
  if (!bridgeImageValid(image) || !bridgeActionAllowed(bridgeContext(image), !!snapshot.world, action) ||
      mode !== (action.kind === "bridge.author" ? "EDITOR" : "PLAY") ||
      (prior === undefined && checkpoint.clocks.policy !== "native_running")) return;
  const revision = checkpoint.revision + 1;
  const request = turn.request_id;
  const eventBase = { revision, request, proposal };
  const eventId = (index: number) => "world-event:" + canonicalDigest([turn.generation_id, request, revision, index]);
  let bridge: BridgeState;
  let world = snapshot.world;
  let capsule_id: string | null = null;
  if (action.kind === "bridge.author") {
    const room_id = extensionRoomId(turn);
    const initial = { ...eventBase, id: eventId(0), kind: "seed" as const };
    const room = { ...eventBase, id: eventId(1), kind: "change" as const, mode: "EDITOR" as const, subject: room_id };
    const player = { ...room, id: eventId(2), subject: extensionPlayer };
    world = World.parse({
      version: "1.0.0", player: extensionPlayer,
      entities: [
        { id: room_id, label: action.label, kind: "location", region: pedestalRegion, source: room.id },
        { id: extensionPlayer, label: "Player", kind: "character", room: room_id, source: player.id },
      ],
      facts: [{ subject: room_id, field: "world:description", value: action.description, source: room.id, from: revision,
        until: null, owner: "remix", visibility: "player", evidence: "editor_committed" }],
      events: [{ id: initial.id, revision, kind: initial.kind }, room, player], exits: [], beliefs: [],
    });
    bridge = { version: "1.0.0", anchor_id: pedestalAnchor, room_id, owner: "native" };
  } else if (action.kind === "bridge.enter" && prior?.owner === "native") {
    const payload_sha256 = checkpoint.native_state.payload_sha256;
    capsule_id = "capsule:" + canonicalDigest([proposal, payload_sha256]);
    bridge = { ...prior, owner: "remix", capsule: {
      id: capsule_id, payload_sha256, pending: "line", native_tick: checkpoint.clocks.native,
    } };
  } else if (action.kind === "bridge.return" && prior?.owner === "remix") {
    const { capsule, ...placement } = prior;
    capsule_id = capsule.id;
    bridge = { ...placement, owner: "native" };
  } else return;
  if (!world) return;
  return { bridge, world, events: [{ ...eventBase, kind: action.kind, anchor_id: pedestalAnchor,
    room_id: bridge.room_id, capsule_id }] };
}

export function publicBridge(bridge: BridgeState) {
  const { version, anchor_id, room_id, owner } = bridge;
  return { version, anchor_id, room_id, owner,
    ...(bridge.owner === "remix" ? {
      native_pending: "line" as const, native_location: "Records Vault" as const, capsule_id: bridge.capsule.id,
    } : {}) };
}

export function bridgeReceipt(before: TurnImage | undefined, after: TurnImage, transition?: BridgeAction["kind"]):
  z.infer<typeof BridgeReceipt> | undefined {
  const next = after.checkpoint.bridge;
  if (!next || !before) return;
  const previous = before.checkpoint.bridge;
  return {
    scene: { ...publicBridge(next),
      ...(transition === "bridge.return" && previous?.owner === "remix" ? { capsule_id: previous.capsule.id } : {}) },
    transition, previous_owner: previous?.owner ?? "native",
    clocks: { native: after.checkpoint.clocks.native, overlay: after.checkpoint.clocks.overlay,
      native_delta: after.checkpoint.clocks.native - before.checkpoint.clocks.native,
      overlay_delta: after.checkpoint.clocks.overlay - before.checkpoint.clocks.overlay },
  };
}

export function sameFrozenNative(before: TurnImage, after: TurnImage): boolean {
  return canonicalJson(before.native) === canonicalJson(after.native) &&
    canonicalJson(before.checkpoint.native_state) === canonicalJson(after.checkpoint.native_state) &&
    before.checkpoint.clocks.native === after.checkpoint.clocks.native &&
    before.checkpoint.story_sha256 === after.checkpoint.story_sha256 &&
    before.checkpoint.runtime_build === after.checkpoint.runtime_build &&
    before.checkpoint.adapter_build === after.checkpoint.adapter_build &&
    before.checkpoint.checkpoint_format === after.checkpoint.checkpoint_format;
}
