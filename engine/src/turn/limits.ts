import { performance } from "node:perf_hooks";

export const limits = Object.freeze({ operations: 32, events: 32, output_bytes: 65_536, checkpoint_bytes: 1_048_576, turn_ms: 5_000 });

export type TurnBudget = { remaining: () => number };

export function turnBudget(now = () => performance.now()): TurnBudget {
  const deadline = now() + limits.turn_ms;
  return { remaining: () => Math.max(0, deadline - now()) };
}
