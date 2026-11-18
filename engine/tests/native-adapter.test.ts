import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { canonicalDigest } from "../src/contracts.ts";
import { nativeStory } from "../src/native/checkpoint.ts";

const worker = fileURLToPath(new URL("../src/native/worker.ts", import.meta.url));
const run = (request: unknown) => spawnSync(process.execPath, [worker], {
  input: JSON.stringify(request), encoding: "utf8", timeout: 5_000, maxBuffer: 1_048_576, windowsHide: true,
});
const response = z.object({
  identity: z.object({ story_sha256: z.literal(nativeStory) }),
  checkpoint: z.object({ identity: z.object({ storySha256: z.string() }).passthrough() }).passthrough(),
  fingerprint: z.string(),
});

void test("native worker requires clean recovery and rejects a mismatched checkpoint before producing output", () => {
  const seeded = run({ kind: "bootstrap" });
  assert.equal(seeded.error, undefined);
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.equal(seeded.stderr, "");
  const original = response.parse(JSON.parse(seeded.stdout));
  const digest = canonicalDigest(z.json().parse(original.checkpoint));
  const wrongStory = structuredClone(original.checkpoint);
  wrongStory.identity.storySha256 = "0".repeat(64);
  const rejected = run({ kind: "verify", checkpoint: wrongStory });
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.signal, null);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr.trim(), "E_STORY");

  const wrongInput = run({ kind: "execute", checkpoint: original.checkpoint, input: { kind: "character", value: "b" } });
  assert.equal(wrongInput.error, undefined);
  assert.equal(wrongInput.status, 1);
  assert.equal(wrongInput.stdout, "");
  assert.equal(wrongInput.stderr.trim(), "E_NATIVE");

  const restored = run({ kind: "verify", checkpoint: original.checkpoint });
  assert.equal(restored.error, undefined);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stderr, "");
  const replay = response.parse(JSON.parse(restored.stdout));
  assert.equal(replay.fingerprint, original.fingerprint);
  assert.equal(canonicalDigest(z.json().parse(replay.checkpoint)), digest);
});
