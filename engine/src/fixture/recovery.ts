import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HeadExpectation, canonicalDigest, canonicalJson } from "../contracts.ts";
import type { Authority } from "../auth/authority.ts";
import type { Result } from "../ports.ts";
import { fixtureStory } from "./synthetic-world.ts";
import { isNativeStory } from "../native/checkpoint.ts";
import { TurnImage, conflict, failure, invalid, limits, ok, stale } from "../turn/contracts.ts";
import type { Access, FaultPoint, TurnExecutor } from "../turn/contracts.ts";
import { validateImage } from "../turn/execution.ts";
import { branchKey } from "../turn/sqlite-turns.ts";
import type { TurnStore } from "../turn/sqlite-turns.ts";
import { publicHead, target } from "./session-contracts.ts";
import { restoreResult, saveResult, savedSession } from "./recovery-contracts.ts";
import type { RestoreIntent, RestoreResult, SavedSession } from "./recovery-contracts.ts";

type Target = z.infer<typeof target>;
type Owner = Access["owner_id"];
type RestoreResponse = RestoreResult | { status: "NEEDS_BROWSER_CONTROL"; id: string };
type Atomic = <T>(run: () => Result<T>) => Result<T>;
type Claimed = { intent: RestoreIntent; image: TurnImage; claim: string };

const approvalLifetime = 300_000;
const unavailable = () => failure("ABORTED", "Session recovery did not finish. Retry the same request to check its outcome.", "same_request");
const noBrowser = () => failure("NEEDS_APPROVAL", "Authenticated browser control is unavailable.");
const unsupported = () => failure("CAPABILITY_MISSING", "This fixture checkpoint cannot be completely restored.");
const corrupt = () => failure("VALIDATION_FAILED", "The saved checkpoint or its history is invalid or incompatible.");
const publicView = publicHead.strip();
const recoveryHead = HeadExpectation.strip();
const fullHead = (owner_id: Owner, request: Target) => recoveryHead.parse({ ...request, owner_id });
const keyFor = (operation: "save" | "restore", owner: Owner, request: Target) =>
  canonicalJson([operation, owner, request.session_id, request.branch_id, request.generation_id, request.request_id]);

export class FixtureRecovery {
  private readonly inFlight = new Map<string, { digest: string; promise: Promise<Result<RestoreResponse>> }>();

  private readonly store: TurnStore;
  private readonly authority: Authority;
  private readonly executor: TurnExecutor;
  private readonly profile: "synthetic" | "native-z5";
  private readonly atomic: Atomic;
  private readonly clock: () => number;
  private readonly fault: (point: FaultPoint) => void;

  constructor(store: TurnStore, authority: Authority, executor: TurnExecutor, profile: "synthetic" | "native-z5",
    atomic: Atomic, clock: () => number, fault: (point: FaultPoint) => void) {
    this.store = store;
    this.authority = authority;
    this.executor = executor;
    this.profile = profile;
    this.atomic = atomic;
    this.clock = clock;
    this.fault = fault;
  }

  private live(owner: Owner, request: Target): Result<TurnImage> {
    const head = fullHead(owner, request);
    if (this.store.fixtureRecord("session", branchKey(head)) !== true) return invalid();
    const image = this.store.head(head);
    if (!image) return failure("NEEDS_APPROVAL", "Activate the fixture before saving or restoring.");
    if (canonicalDigest(image.snapshot.head) !== canonicalDigest(head)) return stale();
    const story = image.checkpoint.story_sha256;
    if (story !== fixtureStory && (!isNativeStory(story) || this.profile !== "native-z5")) return unsupported();
    return ok(image);
  }

  private validate(image: TurnImage): Result<void> {
    if (image.checkpoint.native_state.pending_input.kind === "halted" ||
        (isNativeStory(image.checkpoint.story_sha256) && !this.executor.recreateNative)) return unsupported();
    try {
      const valid = validateImage(image, this.executor);
      if (!valid.ok) return valid;
      return this.store.checkpointHistoryValid(image) ? ok(undefined) : corrupt();
    } catch {
      return corrupt();
    }
  }

  save(owner: Owner, request: Target): Result<z.infer<typeof saveResult>> {
    return this.atomic(() => {
      const id = keyFor("save", owner, request);
      const digest = canonicalDigest(request);
      const prior = this.store.recoveryRequest(id);
      if (prior && prior.digest !== digest) return conflict();
      if (prior?.result) return ok(saveResult.parse(prior.result));
      const current = this.live(owner, request);
      if (!current.ok) return current;
      const valid = this.validate(current.value);
      if (!valid.ok) return valid;
      const head = current.value.snapshot.head;
      const saved = savedSession.parse({ version: "1.0.0", save_id: "save:" + randomUUID(), head,
        checkpoint: current.value.checkpoint.checkpoint_id, digest: canonicalDigest(current.value) });
      const receipt = saveResult.parse({ status: "SAVED", save_id: saved.save_id, head: publicView.parse(head) });
      this.store.bindRecovery(id, digest);
      this.store.insertSave(saved);
      this.store.completeRecovery(id, null, receipt);
      return ok(receipt);
    });
  }

  private checkIntent(owner: Owner, intent: RestoreIntent): Result<TurnImage> {
    if (owner !== intent.save.head.owner_id) return invalid();
    if (intent.expires <= this.clock()) return failure("NEEDS_APPROVAL", "Restore approval expired. Request a fresh preview.");
    const current = this.live(owner, intent.target);
    if (!current.ok) return current;
    const epoch = this.authority.recoveryEpoch(owner, current.value.snapshot.head);
    if (!epoch.ok) return epoch;
    if (current.value.checkpoint.checkpoint_id !== intent.base ||
        canonicalDigest(current.value) !== intent.base_digest || epoch.value !== intent.epoch) return stale();
    const saved = this.store.savedSession(current.value.snapshot.head, intent.save.save_id);
    if (!saved || canonicalDigest(saved) !== canonicalDigest(intent.save)) return corrupt();
    return current;
  }

  private source(current: TurnImage, save: SavedSession): Result<TurnImage> {
    try {
      const image = this.store.savedImage(save);
      if (!image || image.checkpoint.revision > current.checkpoint.revision ||
          image.checkpoint.story_sha256 !== current.checkpoint.story_sha256 ||
          image.checkpoint.runtime_build !== current.checkpoint.runtime_build ||
          image.checkpoint.adapter_build !== current.checkpoint.adapter_build ||
          image.checkpoint.checkpoint_format !== current.checkpoint.checkpoint_format ||
          image.snapshot.version !== current.snapshot.version ||
          image.snapshot.policy.version !== current.snapshot.policy.version) return corrupt();
      const valid = this.validate(image);
      return valid.ok ? ok(image) : valid;
    } catch {
      return corrupt();
    }
  }

  review(owner: Owner, id: string, confirmation?: string): Result<{
    digest: string; save_id: string; current: z.infer<typeof publicHead>; saved: z.infer<typeof publicHead>;
    current_clocks: TurnImage["checkpoint"]["clocks"]; saved_clocks: TurnImage["checkpoint"]["clocks"];
    pending: TurnImage["checkpoint"]["native_state"]["pending_input"]["kind"];
  }> {
    return this.atomic(() => {
      const key = this.store.restoreKey(id);
      if (!key) return invalid();
      const intent = this.store.recoveryRequest(key)?.intent;
      if (!intent) return invalid();
      const current = this.checkIntent(owner, intent);
      if (!current.ok) return current;
      const digest = canonicalDigest(intent);
      if (confirmation !== undefined && confirmation !== digest) return invalid();
      const saved = this.source(current.value, intent.save);
      if (!saved.ok) return saved;
      if (confirmation !== undefined) this.store.approveRestore(key);
      return ok({ digest, save_id: intent.save.save_id, current: publicView.parse(current.value.snapshot.head),
        saved: publicView.parse(intent.save.head), current_clocks: current.value.checkpoint.clocks,
        saved_clocks: saved.value.checkpoint.clocks, pending: saved.value.checkpoint.native_state.pending_input.kind });
    });
  }

  restore(owner: Owner, request: Target, save_id: string, browserAvailable: boolean): Promise<Result<RestoreResponse>> {
    const id = keyFor("restore", owner, request);
    const digest = canonicalDigest({ target: request, save_id });
    const running = this.inFlight.get(id);
    if (running) return running.digest === digest ? running.promise : Promise.resolve(conflict());

    const start = this.atomic<RestoreResponse | Claimed>(() => {
      const prior = this.store.recoveryRequest(id);
      if (prior && prior.digest !== digest) return conflict();
      if (prior?.result) return ok(restoreResult.parse(prior.result));
      const current = this.live(owner, request);
      if (!current.ok) return current;
      if (!browserAvailable) return noBrowser();
      const head = current.value.snapshot.head;
      const saved = this.store.savedSession(head, save_id);
      if (!saved) return invalid();
      const valid = this.validate(current.value);
      if (!valid.ok) return valid;
      const source = this.source(current.value, saved);
      if (!source.ok) return source;
      const epoch = this.authority.recoveryEpoch(owner, head);
      if (!epoch.ok) return epoch;
      if (prior?.claim) return unavailable();
      const intent = prior?.intent;
      if (intent && intent.expires > this.clock() && intent.epoch === epoch.value) {
        const checked = this.checkIntent(owner, intent);
        if (!checked.ok) return checked;
        if (!prior.approved) return ok({ status: "NEEDS_BROWSER_CONTROL", id: intent.id });
        const claim = randomUUID();
        this.store.claimRestore(id, claim);
        return ok({ intent, image: source.value, claim });
      }
      const next = { id: "restore:" + randomUUID(), target: request, base: current.value.checkpoint.checkpoint_id,
        base_digest: canonicalDigest(current.value), save: saved, epoch: epoch.value, expires: this.clock() + approvalLifetime };
      this.store.bindRecovery(id, digest, next);
      return ok({ status: "NEEDS_BROWSER_CONTROL", id: next.id });
    });
    if (!start.ok) return Promise.resolve(start);
    if ("status" in start.value) return Promise.resolve(ok(start.value));
    const work = start.value;
    const promise = Promise.resolve().then(() => this.publish(owner, id, work))
      .catch(unavailable)
      .finally(() => {
        this.atomic(() => {
          if (this.store.recoveryRequest(id)?.claim === work.claim) this.store.claimRestore(id, null);
          return ok(undefined);
        });
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, { digest, promise });
    return promise;
  }

  private async publish(owner: Owner, id: string, { intent, image, claim }: Claimed): Promise<Result<RestoreResult>> {
    if (isNativeStory(image.checkpoint.story_sha256)) {
      const recreated = await this.executor.recreateNative?.(image, AbortSignal.timeout(limits.turn_ms));
      if (!recreated) return unsupported();
      if (!recreated.ok) return recreated;
    }
    const previous = fullHead(owner, intent.target);
    const generation_id = "generation:" + randomUUID();
    const revision = previous.expected_revision + 1;
    const candidate = TurnImage.parse({
      ...image,
      checkpoint: { ...image.checkpoint, generation_id, revision,
        checkpoint_id: "checkpoint:" + randomUUID(), history_ref: "history:" + randomUUID() },
      snapshot: { ...image.snapshot, mode: "PLAY",
        head: { ...image.snapshot.head, generation_id, expected_revision: revision } },
    });
    const valid = validateImage(candidate, this.executor);
    if (!valid.ok) return valid;
    const result = restoreResult.parse({
      status: "RESTORED", save_id: intent.save.save_id, request_id: intent.target.request_id,
      head: publicView.parse(candidate.snapshot.head), restored_from: publicView.parse(intent.save.head),
      previous_head: publicView.parse(previous),
    });
    const check = () => {
      const row = this.store.recoveryRequest(id);
      if (row?.claim !== claim || !row.approved || !row.intent || canonicalDigest(row.intent) !== canonicalDigest(intent)) {
        return unavailable();
      }
      return this.checkIntent(owner, intent);
    };
    this.fault("before_checkpoint");
    const staged = this.atomic(() => {
      const current = check();
      if (!current.ok) return current;
      this.store.insertCheckpoint(candidate, claim);
      return ok(undefined);
    });
    if (!staged.ok) return staged;
    this.fault("after_checkpoint");
    const committed = this.atomic(() => {
      const current = check();
      if (!current.ok) return current;
      const source = this.source(current.value, intent.save);
      if (!source.ok) return source;
      const fresh = this.authority.setHead(candidate.snapshot.head, "restore");
      if (!fresh.ok) return fresh;
      this.store.publishRestore(id, claim, intent, candidate, result);
      this.fault("before_commit");
      return ok(result);
    });
    if (committed.ok) this.fault("after_commit");
    return committed;
  }
}
