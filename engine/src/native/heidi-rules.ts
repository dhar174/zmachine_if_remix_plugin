import { canonicalDigest } from "../contracts.ts";
import type { Json } from "../contracts.ts";
import type { EffectRef, EntityProjection } from "../policy/resolver-contracts.ts";
import { failure, ok } from "../turn/contracts.ts";
import { checkpointMemory, entityId } from "./checkpoint.ts";
import type { NativeInput } from "./checkpoint.ts";

const player = 21;
const bird = 28;
const nest = 30;
const names: Readonly<Record<number, string>> = {
  26: "In front of a cottage", 27: "Deep in the forest", 28: "baby bird", 29: "A forest clearing",
  30: "bird's nest", 31: "tall sycamore tree", 32: "At the top of the tree", 33: "wide firm bough",
};
const evidence = "evidence:heidi-z5";
const fields = {
  turns: ["native:heidi", "progression:turns", "progression"],
  dead: ["native:heidi", "progression:ending", "progression"],
  room: [entityId(player), "topology:location", "topology"],
  visited: ["native:heidi", "progression:visited", "progression"],
  birdHolder: [entityId(bird), "inventory:holder", "inventory"],
  nestHolder: [entityId(nest), "inventory:holder", "inventory"],
} as const;
type Field = keyof typeof fields;
const fieldNames = Object.keys(fields) as Field[];
const effect = (name: Field): EffectRef => ({ entity_id: fields[name][0], field: fields[name][1], change: "write" });

export function heidiView(envelope: Json) {
  const { parent, global, attr, ...state } = checkpointMemory(envelope);
  const room = parent(player);
  const birdHolder = parent(bird);
  const nestHolder = parent(nest);
  if (![26, 27, 29, 32].includes(room) || ![21, 27, 30].includes(birdHolder) ||
      ![21, 29, 33].includes(nestHolder) || parent(31) !== 29 || parent(33) !== 32) {
    throw new Error("Heidi's native topology is outside the qualified route.");
  }
  return { ...state, startup: null, turns: global(13), dead: global(24), room, birdHolder, nestHolder,
    visited: [26, 27, 29, 32].filter((object) => attr(object, 24)) };
}

type View = ReturnType<typeof heidiView>;
type Step = { command: string; changes: Partial<Pick<View, Field>>; output: string };
const walkthrough: readonly Step[] = [
  { command: "east", changes: { room: 27, visited: [26, 27] }, output: "Deep in the forest" },
  { command: "take bird", changes: { birdHolder: player }, output: "Taken." },
  { command: "northeast", changes: { room: 29, visited: [26, 27, 29] }, output: "A forest clearing" },
  { command: "put bird in nest", changes: { birdHolder: nest }, output: "You put the baby bird into the bird's nest." },
  { command: "take nest", changes: { nestHolder: player }, output: "Taken." },
  { command: "up", changes: { room: 32, visited: [26, 27, 29, 32] }, output: "At the top of the tree" },
  { command: "put nest on branch", changes: { nestHolder: 33, dead: 2 }, output: "You have won" },
];

const unsupported = () => failure("CAPABILITY_MISSING", "This input is outside Heidi's qualified Z5 play sequence.");
function stepFor(view: View, input: NativeInput) {
  const step = walkthrough[view.turns];
  return input.kind === "line" && view.pending.kind === "line" && view.dead === 0 &&
    input.text.length <= (view.maxlen ?? 0) && step?.command === input.text ? step : undefined;
}

export function heidiEffects(view: View, input: NativeInput) {
  const step = stepFor(view, input);
  return step ? ok(fieldNames.filter((name) => name === "turns" || Object.hasOwn(step.changes, name)).map(effect)) : unsupported();
}

export function observeHeidi(before: View, after: View, input: NativeInput) {
  const step = stepFor(before, input);
  if (!step || !after.output.startsWith(before.output) || after.turns !== before.turns + 1 ||
      after.pending.kind !== "line" || before.seed !== after.seed ||
      fieldNames.some((name) => name !== "turns" && canonicalDigest(after[name]) !== canonicalDigest(step.changes[name] ?? before[name]))) return unsupported();
  const output = after.output.slice(before.output.length);
  if (!output.includes(step.output)) return unsupported();
  return ok({ outcome: "success" as const, time_cost: 1, output: [output],
    effects: fieldNames.filter((name) => canonicalDigest(before[name]) !== canonicalDigest(after[name])).map(effect),
    events: after.dead === 2 ? [{ kind: "native_ending", outcome: "won" }] : [] });
}

export function heidiEntities(view: View): EntityProjection[] {
  const entities = new Map<string, EntityProjection>();
  for (const name of fieldNames) {
    const [id, field, domain] = fields[name];
    const entity = entities.get(id) ?? { id, origin: "native", region_ids: [], existence: "present",
      evidence_id: evidence, takeover_surfaces: null, surfaces: [] };
    entity.surfaces.push({ field, owner: "native", domain, direct_assignment: false, risk: "consequential",
      coverage: "complete", dependencies: [], fact: { state: "present", value: view[name], evidence_id: evidence } });
    entities.set(id, entity);
  }
  return [...entities.values()];
}

export function heidiProjection(view: View) {
  const label = (id: number) => ({ id: entityId(id), name: names[id] ?? "", qualifier: null });
  const movable = [[bird, view.birdHolder], [nest, view.nestHolder]] as const;
  const here = (holder: number) => holder === view.room || holder === 33 && view.room === 32;
  const visible = movable.filter(([, holder]) => here(holder) || holder === nest && here(view.nestHolder)).map(([id]) => label(id));
  if (view.room === 29) visible.push(label(31));
  if (view.room === 32) visible.push(label(33));
  return { room: label(view.room), inventory: movable.filter(([, holder]) => holder === player).map(([id]) => label(id)),
    visible, status_line: view.grid };
}
