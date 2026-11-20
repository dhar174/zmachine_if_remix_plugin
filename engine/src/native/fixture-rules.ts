import { canonicalDigest } from "../contracts.ts";
import type { EffectRef, EntityProjection } from "../policy/resolver-contracts.ts";
import { failure, ok } from "../turn/contracts.ts";
import { entityId, objects } from "./checkpoint.ts";
import type { NativeInput, checkpointView } from "./checkpoint.ts";

export type View = ReturnType<typeof checkpointView>;
const fixtureState = "native:fixture";
const fields = {
  room: "topology:location", holder: "inventory:holder", locked: "progression:locked", open: "progression:open",
  moved: "progression:key-moved", visited: "progression:visited", startup: "progression:startup",
  turns: "progression:turns", timers: "progression:timers", dead: "progression:ending",
  seed: "progression:rng", pending: "progression:pending-input",
} as const;
type Field = keyof typeof fields;
const always = ["turns"] as const;
const commands = {
  look: always, inventory: always, north: ["turns", "room", "visited"], south: ["turns", "room", "visited"],
  "take brass key": ["turns", "holder", "moved"], "drop brass key": ["turns", "holder"], "take stone panel": always,
  "examine red token": always, "examine blue token": always,
  "unlock vault door with brass key": ["turns", "holder", "moved", "locked"], "open vault door": ["turns", "open"],
  menu: ["pending"], roll: ["turns", "seed"],
} satisfies Record<string, readonly Field[]>;
type Command = keyof typeof commands;
const objectCommands = new Map<string, Command>([
  ["take " + entityId(objects.key), "take brass key"],
  ["drop " + entityId(objects.key), "drop brass key"],
  ["take " + entityId(objects.panel), "take stone panel"],
  ["examine " + entityId(objects.red), "examine red token"],
  ["examine " + entityId(objects.blue), "examine blue token"],
  ["unlock " + entityId(objects.door) + " with " + entityId(objects.key), "unlock vault door with brass key"],
  ["open " + entityId(objects.door), "open vault door"],
]);
export function resolveInput(input: NativeInput): NativeInput {
  return input.kind === "line" ? { kind: "line", text: objectCommands.get(input.text) ?? input.text } : input;
}
const menuChoice = /^[abq]$/iu;
const ambiguous = /^(?:examine|inspect|take) (?:the )?(?:brass )?tokens?$/iu;
const entityScope: Partial<Record<Command, (view: View) => boolean>> = {
  "take brass key": ({ room, holder }) => holder === room || holder === objects.player,
  "drop brass key": ({ room, holder }) => holder === room || holder === objects.player,
  "take stone panel": ({ room }) => room === objects.chamber,
  "examine red token": ({ room }) => room === objects.gallery,
  "examine blue token": ({ room }) => room === objects.gallery,
  "open vault door": ({ room }) => room !== objects.chamber,
  "unlock vault door with brass key": ({ room, holder }) =>
    room !== objects.chamber && (holder === room || holder === objects.player),
};

function surfaceId(field: Field) {
  if (field === "holder" || field === "moved") return entityId(objects.key);
  if (field === "locked" || field === "open") return entityId(objects.door);
  if (field === "room") return entityId(objects.player);
  return fixtureState;
}

const effect = (field: Field): EffectRef => ({ entity_id: surfaceId(field), field: fields[field], change: "write" });
const fieldNames = Object.keys(fields) as Field[];
export function nativeEffects(view: View, input: NativeInput) {
  input = resolveInput(input);
  if (view.pending.kind !== input.kind) return failure("CAPABILITY_MISSING", "Input does not match the native prompt.");
  if (input.kind === "character") return menuChoice.test(input.value) ? ok([effect("turns"), effect("pending")]) :
    failure("NEEDS_CLARIFICATION", "The native menu accepts a, b, or q.");
  if (ambiguous.test(input.text) && view.room === objects.gallery) {
    return failure("NEEDS_CLARIFICATION", "Which brass token do you mean, the red token or the blue token?");
  }
  if (/^(?:save|restore|undo|restart|\/?reset)\b/iu.test(input.text.trim())) {
    return failure("CAPABILITY_MISSING", "Native save, restore, undo, and restart are blocked. Use the combined session tools.");
  }
  if (!Object.hasOwn(commands, input.text)) return failure("CAPABILITY_MISSING", "The line is outside the qualified fixture commands.");
  const command = input.text as Command;
  if (entityScope[command]?.(view) === false) {
    return failure("NEEDS_CLARIFICATION", "The intended entity is unobserved in the current scope.");
  }
  if (input.text.length > (view.maxlen ?? 0)) return failure("CAPABILITY_MISSING", "The line exceeds the native input buffer.");
  return ok(commands[command].map(effect));
}

const names = {
  [objects.chamber]: "Probe Chamber", [objects.gallery]: "Token Gallery", [objects.vault]: "Records Vault",
  [objects.key]: "brass key", [objects.panel]: "stone panel", [objects.red]: "brass token",
  [objects.blue]: "brass token", [objects.door]: "vault door", [objects.pedestal]: "basalt pedestal",
};
const descriptions = { [objects.red]: "red token", [objects.blue]: "blue token" };
export function publicProjection(view: View) {
  const { room, holder } = view;
  const visible: (keyof typeof names)[] = room === objects.chamber ? [objects.panel] :
    room === objects.gallery ? [objects.red, objects.blue, objects.door] : [objects.door, objects.pedestal];
  if (holder === room || holder === objects.player) visible.push(objects.key);
  const label = (number: keyof typeof names) => ({
    id: entityId(number), name: names[number], qualifier: descriptions[number as keyof typeof descriptions] ?? null,
  });
  return {
    room: label(room), inventory: holder === objects.player ? [label(objects.key)] : [],
    visible: visible.map(label),
    status_line: view.grid,
  };
}

export function projectEntities(view: View): EntityProjection[] {
  const result = new Map<string, EntityProjection>();
  for (const name of fieldNames) {
    const id = surfaceId(name);
    let entity = result.get(id);
    if (!entity) {
      entity = { id, origin: "native", region_ids: [], existence: "present", evidence_id: "evidence:z5-fixture",
        takeover_surfaces: null, surfaces: [] };
      result.set(id, entity);
    }
    const domain = name === "room" ? "topology" : name === "holder" ? "inventory" : "progression";
    entity.surfaces.push({ field: fields[name], owner: "native", domain, direct_assignment: false,
      risk: "consequential", coverage: "complete", dependencies: [],
      fact: { state: "present", value: view[name], evidence_id: "evidence:z5-fixture" } });
  }
  return [...result.values()];
}

// The pinned story supplies positive and negative observations for each qualified
// command. Changed world state, elapsed turns, and boundary are checked separately.
function storyOutcome(before: View, after: View, input: NativeInput, output: string): "success" | "failure" | null {
  if (input.kind === "character") {
    const choices = { a: "alpha", b: "beta", q: "quit" };
    const key = input.value.toLowerCase() as keyof typeof choices;
    return output.includes("[F07:menu-choice=" + choices[key] + "]") && after.pending.kind === "line" ? "success" : null;
  }
  switch (input.text) {
    case "menu": return output.includes("[F07:menu-open]") && after.pending.kind === "character" ? "success" : null;
    case "roll": return /\[F08:roll=[1-6]\]/u.test(output) && after.seed !== before.seed ? "success" : null;
    case "look": return /\[LOC:(chamber|gallery|vault)\]/u.test(output) ? "success" : null;
    case "inventory": return /You're carrying|You are carrying|You are empty-handed/u.test(output) ? "success" : null;
    case "north":
    case "south":
      return before.room !== after.room ||
        input.text === "south" && before.room === objects.vault && before.open && output.includes("[LOC:vault]") ? "success" :
        /You can't go that way|You can't, since the vault door is in the way/u.test(output) ? "failure" : null;
    case "take brass key":
      return before.holder !== objects.player && after.holder === objects.player && output.includes("Taken.") ? "success" :
        output.includes("You already have") && after.holder === objects.player ? "failure" : null;
    case "drop brass key":
      return before.holder === objects.player && after.holder === before.room && output.includes("Dropped.") ? "success" :
        output.includes("The brass key is already here.") ? "failure" : null;
    case "take stone panel": return output.includes("The stone panel is hardly portable.") ? "failure" : null;
    case "examine red token": return output.includes("[F09:token-id=RED object#32]") ? "success" : null;
    case "examine blue token": return output.includes("[F09:token-id=BLUE object#33]") ? "success" : null;
    case "unlock vault door with brass key":
      return before.locked && !after.locked && output.includes("[F10:door-unlocked]") ? "success" :
        /already unlocked|isn't locked|is unlocked at the moment/u.test(output) ? "failure" : null;
    case "open vault door":
      return !before.open && after.open && output.includes("[F10:door-opened]") ? "success" :
        /seems to be locked|already open/u.test(output) ? "failure" : null;
    default: return null;
  }
}

export function observe(before: View, after: View, input: NativeInput) {
  input = resolveInput(input);
  const covered = nativeEffects(before, input);
  if (!covered.ok) return covered;
  const invalid = () => failure("CAPABILITY_MISSING", "The observed fixture transition is outside verified effect coverage.");
  if (!after.output.startsWith(before.output)) return invalid();
  const output = after.output.slice(before.output.length);
  const outcome = storyOutcome(before, after, input, output);
  const menu = input.kind === "line" && input.text === "menu";
  const time_cost = after.turns - before.turns;
  const changed = fieldNames.filter((field) => canonicalDigest(before[field]) !== canonicalDigest(after[field]));
  const effects = changed.map(effect);
  const allowed = new Set(covered.value.map(({ field }) => field));
  const chime = output.includes("[F06:event=chime]");
  // On this story, the parser can take the key before checking an unlocked door.
  const tookKeyBeforeFailedUnlock = input.kind === "line" && input.text === "unlock vault door with brass key" &&
    !before.locked && !after.locked && before.holder === before.room && after.holder === objects.player &&
    after.moved && output.includes("(first taking the brass key)\n");
  const unexpectedFailureEffect = outcome === "failure" && changed.some((field) =>
    field !== "turns" && !(tookKeyBeforeFailedUnlock && (field === "holder" || field === "moved")));
  if (!outcome || after.pending.kind !== (menu ? "character" : "line") || time_cost !== (menu ? 0 : 1) ||
      (!menu && !output.includes("[F06:turn=" + after.turns + "]")) || chime !== (time_cost === 1 && after.turns === 3) ||
      effects.some(({ field }) => !allowed.has(field)) || unexpectedFailureEffect) return invalid();
  return ok({ outcome, time_cost, output: [output], effects,
    events: chime ? [{ kind: "native_timer", event: "chime", turn: after.turns }] : [] });
}
