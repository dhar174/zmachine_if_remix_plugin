import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PendingInput, canonicalDigest } from "../contracts.ts";
import type { Json } from "../contracts.ts";

export const nativeStory = "96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b";
export const runtimeRevision = "6ac63e6b61144d4353a168df16c4ad5c22526f88";
const runtimeBuild = "d225d898a0c93b7efc020549d16bda391561632c3cc5b06dc62119d498863454";
const codecBuild = "2fd2b4f6ffcd00759e8d73c76c09633f833595f47b3bb2d651e817494d36b736";
const storySize = 88_576;
export const heidiStory = "3b271bd00c0062a5fe9829094f2b85357fbe26d179a3e852eb4f749aed2fc6e7";
const heidiSize = 95_744;
export const isNativeStory = (digest: string | undefined): digest is string => digest === nativeStory || digest === heidiStory;
export const storyUploadBytes = 256 * 1024;

export function validateStoryBytes(bytes: Buffer): boolean {
  if ((bytes.length !== storySize && bytes.length !== heidiSize) || bytes[0] !== 5) return false;
  const word = (offset: number) => bytes.readUInt16BE(offset);
  const end = word(0x1a) * 4;
  const highMemory = word(0x04);
  const staticMemory = word(0x0e);
  const tables = [word(0x0a) + 126, word(0x0c) + 480];
  return end >= 64 && end <= bytes.length && bytes.subarray(end).every((byte) => byte === 0) &&
    staticMemory >= 64 && staticMemory <= highMemory && highMemory < end &&
    word(0x06) >= highMemory && word(0x06) < end && word(0x08) >= 64 && word(0x08) < end &&
    word(0x18) >= 64 && word(0x18) + 192 <= end &&
    word(0x0a) >= 64 && word(0x0c) >= 64 && tables.every((bound) => bound <= staticMemory) &&
    bytes.subarray(64, end).reduce((checksum, byte) => (checksum + byte) & 0xffff, 0) === word(0x1c) &&
    sha256(bytes) === (bytes.length === storySize ? nativeStory : heidiStory);
}
const checkout = new URL("../../../", import.meta.url);
const require = createRequire(checkout);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export type NativeInput = { kind: "line"; text: string } | { kind: "character"; value: string };
type ProbeInput = { kind: "line"; text: string } | { kind: "char"; key: string };
type ProbeStep = { status: string; delta: string; errors: unknown[]; unexpectedGlk: unknown[] };
type Adapter = { start(): ProbeStep; send(input: ProbeInput): ProbeStep;
  __g1bInternals(): { vm: { xorshift_seed: number } } };
type Codec = {
  captureCheckpoint(adapter: Adapter, identity: typeof expected): Json;
  restoreCheckpoint(envelope: Json, story: Buffer, identity: typeof expected): Adapter;
};
const expected = { storySha256: nativeStory, storySize, runtimeRevision };
const envelopeShape = z.object({
  boundary: z.object({ kind: z.enum(["line", "char", "halted"]) }),
  payload: z.object({
    quetzalB64: z.string(),
    rng: z.object({ seed: z.int() }),
    readData: z.json(),
    publishedOutput: z.object({ output: z.string(), gridOutput: z.string() }),
  }),
});
const lineContinuation = z.object({ bufaddr: z.int().nonnegative() });
export const startupRecord = z.union([
  z.strictObject({ command: z.literal("SEED 42"), output: z.array(z.string()).length(2),
    time_cost: z.int().nonnegative(), startup_counter: z.literal(7) }),
  z.strictObject({ command: z.null(), output: z.array(z.string()).length(1),
    time_cost: z.literal(0), startup_counter: z.null() }),
]);
export const nativePayload = z.strictObject({ checkpoint: z.json(), opening: startupRecord });
export type NativePayload = z.infer<typeof nativePayload>;

let localIdentity: ReturnType<typeof buildIdentity> | undefined;
function buildIdentity() {
  const { implementationIdentity } = require("./experiments/vm-checkpoint/lib/checkpoint-contract.js") as {
    implementationIdentity: () => { runtimeRevision: string; runtimeBuildSha256: string; adapterBuildSha256: string };
  };
  const probe = implementationIdentity();
  if (probe.runtimeRevision !== runtimeRevision || probe.runtimeBuildSha256 !== runtimeBuild ||
      probe.adapterBuildSha256 !== codecBuild) throw new Error("The pinned interpreter or checkpoint codec differs.");
  const ext = extname(fileURLToPath(import.meta.url));
  const modules = ["checkpoint", "worker", "executor", "fixture-rules", "heidi-rules", "profiles"].map((name) =>
    sha256(readFileSync(new URL(name + ext, import.meta.url))));
  return {
    story_sha256: nativeStory, runtime_build: runtimeBuild,
    adapter_build: canonicalDigest([codecBuild, modules]), checkpoint_format: "format:ifvms-v2",
  };
}
// Exact LF source and emitted identities for the compatible #21 adapter at
// f4f56ce. Its pinned runtime and codec are unchanged by the transport work.
export const priorFixtureAdapter = extname(fileURLToPath(import.meta.url)) === ".ts"
  ? "f231b969adf08e215249469e7210566154e0a080ea65b0a9c4ed5196b68a1557"
  : "70e18b5e5bf0124b1087956ef07bf04b42bbb9d338fbeeb5ffc2dfe3952b6311";

export function nativeIdentity(story = nativeStory) {
  return { ...(localIdentity ??= buildIdentity()), story_sha256: story };
}

const identityFor = (story: string) => story === nativeStory ? expected : {
  storySha256: heidiStory, storySize: heidiSize, runtimeRevision,
};

function codec(): Codec {
  return require("./experiments/vm-checkpoint/lib/checkpoint-core.js") as Codec;
}

export function storyBytes() {
  const story = readFileSync(new URL("tests/fixtures/zmachine/fixture.z5", checkout));
  if (!validateStoryBytes(story)) {
    throw new Error("The bundled Z5 fixture differs from its pinned identity.");
  }
  return story;
}

export function capture(adapter: Adapter, story = nativeStory) {
  return codec().captureCheckpoint(adapter, identityFor(story));
}

export function restore(envelope: Json, story: Buffer) {
  return codec().restoreCheckpoint(envelope, story, identityFor(sha256(story)));
}

export function openStory(story: Buffer) {
  const { createIfvmsAdapter } = require("./experiments/vm-io/adapters/ifvms-adapter.js") as {
    createIfvmsAdapter: (bytes: Buffer) => Adapter;
  };
  return createIfvmsAdapter(Buffer.from(story));
}

export function validateCheckpoint(envelope: Json, story = nativeStory) {
  const { validateEnvelope } = require("./experiments/vm-checkpoint/lib/checkpoint-format.js") as {
    validateEnvelope: (value: Json, identity: typeof expected) => void;
  };
  validateEnvelope(envelope, identityFor(story));
}

export function fingerprint(adapter: Adapter) {
  const { machineFingerprint } = require("./experiments/vm-checkpoint/lib/fingerprint.js") as {
    machineFingerprint: (adapter: Adapter) => { undoDepth: number } & Record<string, Json>;
  };
  return machineFingerprint(adapter);
}

// These offsets and object numbers describe only the exact fixture above.
export const objects = {
  player: 21, chamber: 27, gallery: 28, vault: 29, key: 30, panel: 31, red: 32, blue: 33, door: 34, pedestal: 35,
} as const;
export const entityId = (object: number) => "native:object-" + object;

export function checkpointMemory(envelope: Json) {
  const { boundary, payload } = envelopeShape.parse(envelope);
  const { quetzalUmem } = require("./experiments/vm-checkpoint/lib/checkpoint-format.js") as {
    quetzalUmem: (value: string) => Buffer;
  };
  const memory = quetzalUmem(payload.quetzalB64);
  const globals = memory.readUInt16BE(12);
  const table = memory.readUInt16BE(10) + 126;
  const attr = (object: number, number: number) =>
    (memory.readUInt8(table + (object - 1) * 14 + Math.floor(number / 8)) & (0x80 >> (number % 8))) !== 0;
  const parent = (object: number) => memory.readUInt16BE(table + (object - 1) * 14 + 6);
  return {
    parent, attr, global: (number: number) => memory.readUInt16BE(globals + 2 * number),
    seed: payload.rng.seed, output: payload.publishedOutput.output, grid: payload.publishedOutput.gridOutput,
    pending: PendingInput.parse({ kind: boundary.kind === "char" ? "character" : boundary.kind }),
    maxlen: boundary.kind === "line" ? memory.readUInt8(lineContinuation.parse(payload.readData).bufaddr) : null,
  };
}

export function checkpointView(envelope: Json) {
  const { parent, attr, global, ...snapshot } = checkpointMemory(envelope);
  const room = parent(objects.player);
  const holder = parent(objects.key);
  if (room !== objects.chamber && room !== objects.gallery && room !== objects.vault ||
      parent(objects.panel) !== objects.chamber || parent(objects.red) !== objects.gallery ||
      parent(objects.blue) !== objects.gallery || parent(objects.pedestal) !== objects.vault) {
    throw new Error("Fixture object topology is outside the supported projection.");
  }
  return {
    room, holder, locked: attr(objects.door, 11), open: attr(objects.door, 14), moved: attr(objects.key, 12),
    visited: [objects.chamber, objects.gallery, objects.vault].filter((object) => attr(object, 24)),
    startup: global(157), turns: global(13), timers: global(17), dead: global(24), ...snapshot,
  };
}

export function send(adapter: Adapter, input: NativeInput) {
  return adapter.send(input.kind === "line" ? input : { kind: "char", key: input.value });
}
