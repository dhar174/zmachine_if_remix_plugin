import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DirectiveBundle, canonicalDigest } from "../contracts.ts";
import { createFixtureExecutor, executeFixtureOverlay, fixtureImage } from "../fixture/synthetic-world.ts";
import { ResolverSnapshot } from "../policy/resolver-contracts.ts";
import type { Result } from "../ports.ts";
import { TurnImage, failure, limits, ok } from "../turn/contracts.ts";
import type { Access, TurnExecutor } from "../turn/contracts.ts";
import { checkpointView, nativeIdentity, nativePayload, nativeStory, startupRecord, validateCheckpoint } from "./checkpoint.ts";
import type { NativeInput } from "./checkpoint.ts";
import { nativeEffects, observe, projectEntities, publicProjection } from "./fixture-rules.ts";

const response = z.strictObject({
  identity: ResolverSnapshot.shape.native.unwrap().shape.identity,
  checkpoint: z.json(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  undo_depth: z.int().nonnegative(), opening: startupRecord.optional(),
});
type Response = z.infer<typeof response>;
type Request = { kind: "bootstrap" } | { kind: "verify"; checkpoint: Response["checkpoint"] } |
  { kind: "execute"; checkpoint: Response["checkpoint"]; input: NativeInput };
const aborted = () => failure("ABORTED", "The native candidate did not complete within its worker bounds.", "same_request");
const unsupported = () => failure("CAPABILITY_MISSING", "The pinned native checkpoint or transition could not be verified.");
const invalid = () => failure("VALIDATION_FAILED", "Invalid native fixture image.");

function worker(request: Request, signal: AbortSignal): Promise<Result<Response>> {
  const input = JSON.stringify(request);
  if (signal.aborted || Buffer.byteLength(input) > limits.checkpoint_bytes) return Promise.resolve(aborted());
  const script = new URL("worker" + extname(fileURLToPath(import.meta.url)), import.meta.url);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(script)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const stop = () => { failed = true; child.kill(); };
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", stop);
    child.stdin.on("error", stop);
    child.stdout.on("error", stop);
    child.stderr.on("error", stop);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > limits.checkpoint_bytes) stop();
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => { failed = true; });
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted || code === null || bytes > limits.checkpoint_bytes) { resolve(aborted()); return; }
      if (failed || code !== 0) { resolve(unsupported()); return; }
      try {
        const parsed = response.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        resolve(canonicalDigest(parsed.identity) === canonicalDigest(nativeIdentity()) ? ok(parsed) : unsupported());
      } catch { resolve(invalid()); }
    });
    child.stdin.end(input);
  });
}

async function verified(request: Request, signal: AbortSignal): Promise<Result<Response>> {
  const staged = await worker(request, signal);
  if (!staged.ok) return staged;
  const recovered = await worker({ kind: "verify", checkpoint: staged.value.checkpoint }, signal);
  if (!recovered.ok) return recovered;
  if (staged.value.fingerprint !== recovered.value.fingerprint ||
      recovered.value.undo_depth > staged.value.undo_depth ||
      canonicalDigest(staged.value.checkpoint) !== canonicalDigest(recovered.value.checkpoint)) return unsupported();
  return staged;
}

export async function openNativeFixture(owner: Access["owner_id"]): Promise<Result<TurnImage>> {
  const staged = await verified({ kind: "bootstrap" }, AbortSignal.timeout(limits.turn_ms));
  if (!staged.ok) return staged;
  const opening = staged.value.opening;
  if (!opening) return invalid();
  const { checkpoint } = staged.value;
  const view = checkpointView(checkpoint);
  const base = fixtureImage(owner);
  const { history, applicability } = base.snapshot;
  const policy = DirectiveBundle.parse({ ...base.snapshot.policy, story_sha256: nativeStory,
    sources: [{ id: "fixture-bootstrap", origin: "initial", text: "Pinned Z5 fixture seeded setup." }] });
  const entities = [...base.snapshot.entities.filter(({ origin }) => origin === "remix"), ...projectEntities(view)];
  const native = { checkpoint, opening };
  const payload_sha256 = canonicalDigest(native);
  return ok(TurnImage.parse({
    ...base, native,
    checkpoint: {
      ...base.checkpoint, ...staged.value.identity,
      native_state: { pending_input: view.pending, payload_sha256, payload_ref: "blob:" + payload_sha256 },
      remix_state_ref: "blob:" + canonicalDigest(entities), policy_ref: "blob:" + canonicalDigest({ policy, history, applicability }),
      clocks: { ...base.checkpoint.clocks, native: opening.time_cost },
    },
    snapshot: { ...base.snapshot, story_sha256: nativeStory, policy, entities },
  }));
}

export function nativeContext(image: TurnImage, draft: boolean) {
  const { checkpoint, opening } = nativePayload.parse(image.native);
  return { version: "1.0.0" as const, opening, projection: draft ? null : publicProjection(checkpointView(checkpoint)) };
}

const inputOf = (operation: Parameters<TurnExecutor["project"]>[1]["operations"][number] | undefined): NativeInput | null =>
  operation?.kind === "native.line" ? { kind: "line", text: operation.text } :
    operation?.kind === "native.character" ? { kind: "character", value: operation.value } : null;

export function createNativeFixtureExecutor(): TurnExecutor {
  const synthetic = createFixtureExecutor();
  return {
    project(image, proposal) {
      if (image.checkpoint.story_sha256 !== nativeStory) return synthetic.project(image, proposal);
      const operation = proposal.operations[0];
      const input = inputOf(operation);
      if (!operation || !input || proposal.operations.length !== 1) return ok(null);
      const pending = image.checkpoint.native_state.pending_input;
      const effects = nativeEffects(checkpointView(nativePayload.parse(image.native).checkpoint), input);
      if (!effects.ok) return effects;
      const identity = nativeIdentity();
      const capability = { id: "capability:z5-" + pending.kind, operation: operation.kind, boundary: pending,
        preconditions: [], effects: effects.value, coverage: "supported", evidence: ["evidence:z5-fixture"], recovery: "checkpoint" };
      return ok(ResolverSnapshot.shape.native.parse({ identity, pending,
        manifest: { version: "1.0.0", ...identity, capabilities: [capability] },
        bindings: [{ capability_id: capability.id, operation_digest: canonicalDigest(operation),
          preconditions: [], suppressed_surfaces: [] }],
      }));
    },
    async execute(image, plan, budget, signal) {
      if (image.checkpoint.story_sha256 !== nativeStory) return synthetic.execute(image, plan, budget, signal);
      if (plan.time !== "native") {
        const entities = image.snapshot.entities;
        const events = executeFixtureOverlay(entities, plan);
        return events.ok ? ok({ native: image.native, pending: image.checkpoint.native_state.pending_input,
          entities, effects: plan.operations.flatMap(({ effects }) => effects), time_cost: 0, outcome: "success",
          output: [], facts: [], events: events.value }) : events;
      }
      const input = inputOf(plan.operations[0]?.operation);
      if (!input || plan.operations.length !== 1) return unsupported();
      const payload = nativePayload.parse(image.native);
      const result = await verified({ kind: "execute", checkpoint: payload.checkpoint, input }, signal);
      if (!result.ok) return result;
      const before = checkpointView(payload.checkpoint);
      const after = checkpointView(result.value.checkpoint);
      const observed = observe(before, after, input);
      if (!observed.ok) return observed;
      const entities = [...image.snapshot.entities.filter(({ origin }) => origin === "remix"), ...projectEntities(after)];
      return ok({ ...observed.value, pending: after.pending, entities, facts: [],
        native: { ...payload, checkpoint: result.value.checkpoint } });
    },
    verifyNative(image, execution, plan) {
      if (image.checkpoint.story_sha256 !== nativeStory) return synthetic.verifyNative(image, execution, plan);
      const input = inputOf(plan.operations[0]?.operation);
      if (!input) return invalid();
      const old = nativePayload.parse(image.native);
      const next = nativePayload.parse(execution.native);
      const after = checkpointView(next.checkpoint);
      const observed = observe(checkpointView(old.checkpoint), after, input);
      if (!observed.ok) return observed;
      const { output, effects, events, time_cost, outcome } = execution;
      return canonicalDigest({ output: [...output], effects: [...effects], events: [...events], time_cost, outcome }) === canonicalDigest(observed.value) &&
        canonicalDigest(execution.pending) === canonicalDigest(after.pending) &&
        canonicalDigest(old.opening) === canonicalDigest(next.opening) && execution.facts.length === 0 ? ok(undefined) : invalid();
    },
    async recreateNative(image, signal) {
      const payload = nativePayload.safeParse(image.native);
      if (!payload.success || image.checkpoint.story_sha256 !== nativeStory) return invalid();
      const recovered = await worker({ kind: "verify", checkpoint: payload.data.checkpoint }, signal);
      if (!recovered.ok) return recovered;
      return canonicalDigest(recovered.value.checkpoint) === canonicalDigest(payload.data.checkpoint)
        ? ok(undefined) : invalid();
    },
    verifyRestore(image) {
      if (image.checkpoint.story_sha256 !== nativeStory) return synthetic.verifyRestore(image);
      // This synchronous hook checks persisted data. The two fresh workers
      // qualify execution and recapture before the service can publish it.
      try {
        const { checkpoint, snapshot } = image;
        const identity = nativeIdentity();
        const payload = nativePayload.parse(image.native);
        validateCheckpoint(payload.checkpoint);
        const view = checkpointView(payload.checkpoint);
        return Object.entries(identity).every(([key, value]) => checkpoint[key as keyof typeof identity] === value) &&
          view.startup === payload.opening.startup_counter && view.output.startsWith(payload.opening.output.join("")) &&
          view.turns === checkpoint.clocks.native && view.pending.kind === checkpoint.native_state.pending_input.kind &&
          canonicalDigest(projectEntities(view)) === canonicalDigest(snapshot.entities.filter(({ origin }) => origin === "native"))
          ? ok(undefined) : invalid();
      } catch { return invalid(); }
    },
  };
}
