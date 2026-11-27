import { z } from "zod";
import { TurnProposal } from "../contracts.ts";

const overlayId = z.string().regex(/^remix:[A-Za-z0-9._:-]+$/u).max(200);
const behaviorId = z.string().regex(/^behavior:[A-Za-z0-9._:-]+$/u).max(200);
const topicId = z.string().regex(/^topic:[A-Za-z0-9._:-]+$/u).max(200);
export const worldEventId = z.string().regex(/^world-event:[A-Za-z0-9._:-]+$/u).max(256);
const text = z.string().min(1).max(2048);
export const RuleCondition = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("speech.equals"), text }),
  z.strictObject({ kind: z.enum(["topic.unknown", "topic.known"]), topic: topicId }),
  z.strictObject({ kind: z.enum(["item.held", "offer.eligible"]), item: overlayId }),
]);
export const RuleEffect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("belief.record"), topic: topicId }),
  z.strictObject({ kind: z.literal("offer.create"), item: overlayId }),
  z.strictObject({ kind: z.literal("relationship.adjust"), target: overlayId, step: z.union([z.literal(-1), z.literal(1)]) }),
]);
export const RuleDefinition = z.strictObject({
  version: z.literal("1.0.0"),
  id: behaviorId,
  owner: overlayId,
  when: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("speech") }),
    z.strictObject({ kind: z.literal("observation"), subject: overlayId, field: z.string().min(1).max(256) }),
    z.strictObject({ kind: z.literal("offer.created"), item: overlayId }),
  ]),
  conditions: z.array(RuleCondition).max(8),
  effects: z.array(RuleEffect).min(1).max(8),
});
export type RuleDefinition = z.infer<typeof RuleDefinition>;
export type RuleEffect = z.infer<typeof RuleEffect>;

export const RuleInstall = z.strictObject({ kind: z.literal("rule.install"), rule: RuleDefinition });
export const OfferAccept = z.strictObject({ kind: z.literal("offer.accept"), offer_id: worldEventId });
export const Offer = z.strictObject({ id: worldEventId, item: overlayId, giver: overlayId, recipient: overlayId,
  consumed_by: worldEventId.nullable() });

export const RuleCause = z.strictObject({ rule_id: behaviorId, event_id: worldEventId, effect_index: z.int().min(0).max(7),
  effect: z.union([RuleEffect, z.strictObject({ kind: z.literal("offer.transfer"), offer_id: worldEventId })]) });
export type RuleCause = z.infer<typeof RuleCause>;
export const RuleStep = RuleCause.extend({ result_id: worldEventId,
  effects: z.array(TurnProposal.shape.known_effects.element).max(512) });
export type RuleStep = z.infer<typeof RuleStep>;
export const ruleLimits = Object.freeze({ rules: 32, depth: 8, evaluations: 128 });
