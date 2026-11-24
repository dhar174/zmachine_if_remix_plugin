import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CombinedCheckpoint, HeadExpectation, canonicalDigest, canonicalJson } from "../contracts.ts";
import { DurableReceipt, TurnImage } from "../turn/contracts.ts";
import type { Access } from "../turn/contracts.ts";
import { digest, publicHead } from "./session-contracts.ts";

export const portableBytes = 16 * 1024 * 1024;
export const portableHistoryLimit = 128;
export const importedSession = z.strictObject({ status: z.literal("IMPORTED"), head: publicHead });
export const uploadPurpose = z.enum(["open", "combined"]);
export type UploadPurpose = z.infer<typeof uploadPurpose>;
const checkpointId = CombinedCheckpoint.shape.checkpoint_id;
export const portableEntry = z.strictObject({
  image: TurnImage, parent: checkpointId.nullable(), origin: publicHead.nullable(),
  receipt: DurableReceipt.nullable(), events: z.array(z.json()).max(32),
});
export type PortableEntry = z.infer<typeof portableEntry>;
const contents = z.strictObject({
  version: z.literal("1.0.0"), kind: z.literal("zmachine-combined"),
  history: z.array(portableEntry).min(1).max(portableHistoryLimit),
});
const transfer = z.strictObject({ contents, digest, mac: digest });

function signature(checksum: string, key: Buffer) {
  return createHmac("sha256", key).update("zirp:combined:1.0.0:").update(checksum).digest("hex");
}

export function encodePortable(history: PortableEntry[], key: Buffer): Buffer | undefined {
  const payload = contents.safeParse({ version: "1.0.0", kind: "zmachine-combined", history });
  if (!payload.success) return;
  const checksum = canonicalDigest(payload.data);
  const bytes = Buffer.from(canonicalJson({ contents: payload.data, digest: checksum, mac: signature(checksum, key) }));
  return bytes.length <= portableBytes ? bytes : undefined;
}

export function decodePortable(bytes: Buffer, owner: Access["owner_id"], key: Buffer): PortableEntry[] | undefined {
  if (bytes.length > portableBytes) return;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const outer = z.strictObject({ contents: z.unknown(), digest, mac: digest }).parse(JSON.parse(raw) as unknown);
    if (!timingSafeEqual(Buffer.from(outer.mac, "hex"), Buffer.from(signature(outer.digest, key), "hex"))) return;
    const { contents: payload } = transfer.parse(outer);
    if (canonicalDigest(payload) !== outer.digest) return;
    const seen = new Set<string>();
    const root = payload.history[0]?.image.snapshot.head;
    const story = payload.history[0]?.image.checkpoint.story_sha256;
    let previous: PortableEntry | undefined;
    for (const entry of payload.history) {
      const { checkpoint, snapshot } = entry.image;
      const head = snapshot.head;
      if (seen.has(checkpoint.checkpoint_id) || head.owner_id !== owner || head.session_id !== root?.session_id ||
          head.branch_id !== root.branch_id || checkpoint.story_sha256 !== story ||
          entry.parent !== (previous?.image.checkpoint.checkpoint_id ?? null) ||
          (previous && checkpoint.revision <= previous.image.checkpoint.revision)) return;
      if (entry.origin && (!previous || canonicalDigest(entry.origin) !==
          canonicalDigest(publicHead.strip().parse(previous.image.snapshot.head)))) return;
      const receipt = entry.receipt?.receipt;
      if (receipt) {
        if (entry.origin || receipt.post_checkpoint !== checkpoint.checkpoint_id ||
            (entry.parent && receipt.pre_checkpoint !== entry.parent) || receipt.owner_id !== owner ||
            receipt.session_id !== head.session_id || receipt.branch_id !== head.branch_id ||
            receipt.generation_id !== head.generation_id || receipt.revision !== checkpoint.revision ||
            receipt.policy_revision !== checkpoint.policy_revision ||
            entry.receipt?.recovery.checkpoint !== checkpoint.checkpoint_id ||
            new Set(receipt.event_ids).size !== entry.events.length ||
            receipt.event_ids.length !== entry.events.length) return;
      } else if (entry.events.length || (previous && !entry.origin)) return;
      seen.add(checkpoint.checkpoint_id);
      previous = entry;
    }
    return payload.history;
  } catch { return undefined; }
}

export function relocatePortable(history: PortableEntry[]) {
  const scope = { session_id: "session:" + randomUUID(), branch_id: "branch:" + randomUUID() };
  const renamed = (prefix: string) => {
    const ids = new Map<string, string>();
    return (id: string) => {
      const result = ids.get(id) ?? prefix + ":" + randomUUID();
      ids.set(id, result);
      return result;
    };
  };
  const generation = renamed("generation");
  const checkpointIdFor = renamed("checkpoint");
  const eventId = renamed("event");
  const entries = history.map(({ image, parent, origin, receipt: record, events }): PortableEntry => {
    const head = HeadExpectation.parse({ ...image.snapshot.head, ...scope,
      generation_id: generation(image.snapshot.head.generation_id) });
    const checkpoint = CombinedCheckpoint.parse({ ...image.checkpoint, ...scope, generation_id: head.generation_id,
      checkpoint_id: checkpointIdFor(image.checkpoint.checkpoint_id), history_ref: "history:" + randomUUID() });
    const receipt = record && DurableReceipt.parse({ ...record, receipt: { ...record.receipt, ...scope,
      generation_id: head.generation_id, event_ids: record.receipt.event_ids.map(eventId),
      pre_checkpoint: checkpointIdFor(record.receipt.pre_checkpoint), post_checkpoint: checkpoint.checkpoint_id },
      recovery: { ...record.recovery, checkpoint: checkpoint.checkpoint_id } });
    return { image: { ...image, checkpoint, snapshot: { ...image.snapshot, head } }, receipt, events,
      parent: parent === null ? null : checkpointId.parse(checkpointIdFor(parent)),
      origin: origin && publicHead.parse({ ...origin, ...scope, generation_id: generation(origin.generation_id) }) };
  });
  const last = entries.at(-1);
  if (!last) throw new Error("Empty portable history.");
  const { checkpoint, snapshot } = last.image;
  const generation_id = "generation:" + randomUUID();
  const imported = TurnImage.parse({
    ...last.image,
    amendment: null,
    checkpoint: { ...checkpoint, checkpoint_id: "checkpoint:" + randomUUID(), revision: checkpoint.revision + 1,
      generation_id, history_ref: "history:" + randomUUID() },
    snapshot: { ...snapshot, mode: "PLAY", head: { ...snapshot.head, expected_revision: checkpoint.revision + 1, generation_id } },
  });
  return { entries, imported, parent: checkpoint.checkpoint_id, origin: publicHead.strip().parse(snapshot.head) };
}
