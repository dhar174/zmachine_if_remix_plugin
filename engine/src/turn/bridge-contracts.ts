import { z } from "zod";

export const pedestalAnchor = "anchor:fixture-pedestal";
export const pedestalRegion = "region:pedestal-extension";
export const pedestalCapability = "capability:fixture-pedestal-v1";
const version = z.literal("1.0.0");
const anchor = { anchor_id: z.string().regex(/^anchor:[A-Za-z0-9._:-]{1,128}$/u) };
const registeredAnchor = { anchor_id: z.literal(pedestalAnchor) };
const room = { room_id: z.string().regex(/^remix:[A-Za-z0-9._:-]{1,194}$/u) };
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const tick = z.int().nonnegative();
const text = (max: number) => z.string().min(1).max(max).refine((value) => value === value.trim());

export const BridgeAction = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bridge.author"), ...anchor, label: text(256), description: text(2048) }),
  z.strictObject({ kind: z.literal("bridge.enter"), ...anchor, ...room }),
  z.strictObject({ kind: z.literal("bridge.return"), ...anchor }),
]);
export type BridgeAction = z.infer<typeof BridgeAction>;
export function isBridgeAction<T extends { kind: string }>(value: T): value is T & BridgeAction {
  return value.kind === "bridge.author" || value.kind === "bridge.enter" || value.kind === "bridge.return";
}

const capsuleId = z.string().regex(/^capsule:[a-f0-9]{64}$/u);
const placement = { version, ...registeredAnchor, ...room };
export const BridgeState = z.discriminatedUnion("owner", [
  z.strictObject({ ...placement, owner: z.literal("native") }),
  z.strictObject({ ...placement, owner: z.literal("remix"), capsule: z.strictObject({
    id: capsuleId, payload_sha256: digest, native_tick: tick, pending: z.literal("line"),
  }) }),
]);
export type BridgeState = z.infer<typeof BridgeState>;

export const BridgeScene = z.strictObject({
  ...placement, owner: z.enum(["native", "remix"]), native_pending: z.literal("line").optional(),
  native_location: z.literal("Records Vault").optional(), capsule_id: capsuleId.optional(),
});
export const BridgeReceipt = z.strictObject({
  scene: BridgeScene,
  transition: z.enum(["bridge.author", "bridge.enter", "bridge.return"]).optional(),
  previous_owner: z.enum(["native", "remix"]),
  clocks: z.strictObject({ native: tick, overlay: tick, native_delta: tick, overlay_delta: tick }),
});
