import { writeSync } from "node:fs";
import { z } from "zod";
import { OwnerId } from "../src/contracts.ts";
import { saveId } from "../src/fixture/recovery-contracts.ts";
import { target } from "../src/fixture/session-contracts.ts";
import { createFixtureExecutor } from "../src/fixture/synthetic-world.ts";
import { createNativeFixtureExecutor } from "../src/native/executor.ts";
import { TurnService } from "../src/turn/service.ts";
import { take } from "./turn-fixture.ts";

const [, , path, stop, profile, args] = process.argv;
if (!path || !args || (profile !== "synthetic" && profile !== "native-z5")) throw new Error("Missing restore child arguments.");
const input = z.object({ target, save_id: saveId }).parse(JSON.parse(args));
const executor = profile === "native-z5" ? createNativeFixtureExecutor() : createFixtureExecutor();
const service = new TurnService(path, executor, Date.now, (point) => {
  if (point !== stop) return;
  writeSync(1, JSON.stringify({ point }) + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}, profile);
try {
  const owner = OwnerId.parse("owner:fixture");
  const pending = take(await service.recovery.restore(owner, input.target, input.save_id, true));
  if (pending.status !== "NEEDS_BROWSER_CONTROL") throw new Error("Expected a new restore approval.");
  const { digest } = take(service.recovery.review(owner, pending.id));
  take(service.recovery.review(owner, pending.id, digest));
  writeSync(1, JSON.stringify({ approval: pending.id }) + "\n");
  take(await service.recovery.restore(owner, input.target, input.save_id, true));
} finally { service.close(); }
