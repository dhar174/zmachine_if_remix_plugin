import type { Json } from "../contracts.ts";
import { checkpointView, heidiStory } from "./checkpoint.ts";
import type { NativeInput } from "./checkpoint.ts";
import { nativeEffects, observe, projectEntities, publicProjection, resolveInput } from "./fixture-rules.ts";
import { heidiEffects, heidiEntities, heidiProjection, heidiView, observeHeidi } from "./heidi-rules.ts";

export const nativeView = (story: string, checkpoint: Json) =>
  story === heidiStory ? heidiView(checkpoint) : checkpointView(checkpoint);
export const nativeProjection = (story: string, checkpoint: Json) =>
  story === heidiStory ? heidiProjection(heidiView(checkpoint)) : publicProjection(checkpointView(checkpoint));
export const nativeEntities = (story: string, checkpoint: Json) =>
  story === heidiStory ? heidiEntities(heidiView(checkpoint)) : projectEntities(checkpointView(checkpoint));
export const coveredInput = (story: string, checkpoint: Json, input: NativeInput) =>
  story === heidiStory ? heidiEffects(heidiView(checkpoint), input) : nativeEffects(checkpointView(checkpoint), input);
export const interpreterInput = (story: string, input: NativeInput) => story === heidiStory ? input : resolveInput(input);
export const observeNative = (story: string, before: Json, after: Json, input: NativeInput) =>
  story === heidiStory ? observeHeidi(heidiView(before), heidiView(after), input)
    : observe(checkpointView(before), checkpointView(after), input);
