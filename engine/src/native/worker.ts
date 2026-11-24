import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalDigest } from "../contracts.ts";
import { limits } from "../turn/contracts.ts";
import { capture, fingerprint, heidiStory, nativeIdentity, openStory, restore, send, storyBytes, validateStoryBytes } from "./checkpoint.ts";
import { coveredInput, interpreterInput, nativeView } from "./profiles.ts";

const requests = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bootstrap") }),
  z.strictObject({ kind: z.literal("verify"), checkpoint: z.json() }),
  z.strictObject({ kind: z.literal("execute"), checkpoint: z.json(), input: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("line"), text: z.string() }),
    z.strictObject({ kind: z.literal("character"), value: z.string() }),
  ]) }),
]);

const clean = (step: ReturnType<typeof send>) => step.status !== "error" &&
  step.errors.length === 0 && step.unexpectedGlk.length === 0 && Buffer.byteLength(step.delta) <= limits.output_bytes;

async function main() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > limits.checkpoint_bytes) throw new Error("Oversized worker request.");
    chunks.push(chunk);
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const transport = z.strictObject({ request: requests, story: z.string().optional() }).parse(
    typeof input === "object" && input !== null && "request" in input ? input : { request: input },
  );
  const { request } = transport;
  const story = transport.story === undefined ? storyBytes() : Buffer.from(transport.story, "base64");
  if (!validateStoryBytes(story)) throw new Error("Unqualified story bytes.");
  const digest = createHash("sha256").update(story).digest("hex");
  const identity = nativeIdentity(digest);
  if (digest === heidiStory) {
    // Inform uses randomness during initialization. Recreate the startup
    // stream before every bootstrap and before the codec starts its fresh VM.
    let seed = 42;
    Math.random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
  }
  const adapter = request.kind === "bootstrap" ? openStory(story) : restore(request.checkpoint, story);
  let opening;
  if (request.kind === "bootstrap") {
    const first = adapter.start();
    if (!clean(first) || first.status !== "waiting_for_line_input") throw new Error("Unsupported opening boundary.");
    if (digest === heidiStory) {
      if (!first.delta.includes("In front of a cottage")) throw new Error("Unqualified Heidi opening.");
      // Switch to the codec-supported VM stream without injecting a parser turn.
      adapter.__g1bInternals().vm.xorshift_seed = 42;
      opening = { command: null, output: [first.delta], startup_counter: null };
    } else {
      if (!first.delta.includes("[F01:startup=7]")) throw new Error("Unqualified native opening.");
      try {
        capture(adapter);
        throw new Error("Expected unseeded capture to be refused.");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "E_RNG") throw error;
      }
      const seed = send(adapter, { kind: "line", text: "seed 42" });
      if (!clean(seed) || seed.status !== "waiting_for_line_input" || !seed.delta.includes("[F08:seed=42]")) {
        throw new Error("Unqualified fixture setup.");
      }
      opening = { command: "SEED 42", output: [first.delta, seed.delta], startup_counter: 7 };
    }
  } else if (request.kind === "execute") {
    if (digest === heidiStory) {
      Math.random = () => { throw new Error("Unseeded continuation is outside Heidi qualification."); };
    }
    const covered = coveredInput(digest, request.checkpoint, request.input);
    if (!covered.ok) throw new Error("Unsupported candidate input.");
    const step = send(adapter, interpreterInput(digest, request.input));
    if (!clean(step)) throw new Error("VM execution error or output limit.");
  }
  const checkpoint = capture(adapter, digest);
  const view = nativeView(digest, checkpoint);
  if (request.kind === "verify" && canonicalDigest(checkpoint) !== canonicalDigest(request.checkpoint)) {
    throw new Error("Fresh-process checkpoint recapture differs.");
  }
  if (opening && (view.startup !== opening.startup_counter || view.turns !== (digest === heidiStory ? 0 : 1) || view.pending.kind !== "line")) {
    throw new Error("The seeded opening state differs from the fixture contract.");
  }
  const { undoDepth, ...machine } = fingerprint(adapter);
  const response = JSON.stringify({ identity, checkpoint, fingerprint: canonicalDigest(machine), undo_depth: undoDepth,
    ...(opening ? { opening: { ...opening, time_cost: view.turns } } : {}) });
  if (Buffer.byteLength(response) > limits.checkpoint_bytes) throw new Error("Oversized worker response.");
  process.stdout.write(response);
}

main().catch((error: unknown) => {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "E_NATIVE";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
