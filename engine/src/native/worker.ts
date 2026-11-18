import { z } from "zod";
import { canonicalDigest } from "../contracts.ts";
import { limits } from "../turn/contracts.ts";
import { capture, checkpointView, fingerprint, nativeIdentity, openStory, restore, send, storyBytes } from "./checkpoint.ts";
import { nativeEffects, resolveInput } from "./fixture-rules.ts";

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
  const request = requests.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
  const identity = nativeIdentity();
  const story = storyBytes();
  const adapter = request.kind === "bootstrap" ? openStory(story) : restore(request.checkpoint, story);
  let opening;
  if (request.kind === "bootstrap") {
    const first = adapter.start();
    if (!clean(first) || first.status !== "waiting_for_line_input" || !first.delta.includes("[F01:startup=7]")) {
      throw new Error("Unqualified native opening.");
    }
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
  } else if (request.kind === "execute") {
    const covered = nativeEffects(checkpointView(request.checkpoint), request.input);
    if (!covered.ok) throw new Error("Unsupported candidate input.");
    const step = send(adapter, resolveInput(request.input));
    if (!clean(step)) throw new Error("VM execution error or output limit.");
  }
  const checkpoint = capture(adapter);
  const view = checkpointView(checkpoint);
  if (request.kind === "verify" && canonicalDigest(checkpoint) !== canonicalDigest(request.checkpoint)) {
    throw new Error("Fresh-process checkpoint recapture differs.");
  }
  if (opening && (view.startup !== 7 || view.turns !== 1 || view.pending.kind !== "line")) {
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
