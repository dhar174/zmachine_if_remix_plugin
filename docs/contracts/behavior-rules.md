# Declarative behavior rules v1

Use a typed `rule.install` turn to register an immutable rule on the current overlay world. A rule refers to a non-player overlay character and existing overlay entities by stable ID. The character must witness a matching event in the active scene. Definitions have their own version field. The containing world payload moves from version `1.0.0` to `2.0.0` on its first rule installation. Older payloads retain their serialized representation and digest.

```json
{
  "version": "1.0.0",
  "id": "behavior:market-gossip",
  "owner": "remix:guard",
  "when": { "kind": "speech" },
  "conditions": [
    { "kind": "speech.equals", "text": "We are old friends." },
    { "kind": "topic.unknown", "topic": "topic:old-friends" },
    { "kind": "offer.eligible", "item": "remix:market-token" }
  ],
  "effects": [
    { "kind": "belief.record", "topic": "topic:old-friends" },
    { "kind": "offer.create", "item": "remix:market-token" }
  ]
}
```

| Position | Registered kinds and parameters |
| --- | --- |
| Event selector | `speech` matches player speech the rule owner heard. `observation` matches an observation by the owner and takes `subject` and `field`. `offer.created` takes an `item` and matches a prior step by this owner in the current candidate. |
| Condition | `speech.equals` takes literal `text`. `topic.unknown` and `topic.known` take a `topic` and query the owner's attributed beliefs. `item.held` and `offer.eligible` take an `item`. Eligibility requires direct possession, player co-location, an empty item if it is a container, and no previous offer for the same giver, recipient, and item. |
| Effect | `belief.record` takes a `topic` and records the triggering speech or observation as evidence. `offer.create` takes an `item` and records a pending offer to the player. `relationship.adjust` takes a `target` and a `step` of `1` or `-1` over the existing acquaintance and friend values. Both characters must be in the scene. Invalid or out-of-range adjustments abort the candidate. |
| Acceptance | The player sends one `offer.accept` with the `offer_id` in a later turn. That event runs the registry's `offer.transfer` consequence with the original rule and offer IDs. The consequence rechecks possession, participants, placement, and policy, then moves the item and records consumption. |

Schemas are closed. Every definition has up to eight ordered conditions and one to eight ordered effects. IDs use `behavior:`, `topic:`, and `remix:` namespaces. The registry accepts up to 32 definitions per world. Editor authoring uses exact browser approval. Play generation requires a matching `generate.rule` allowance when a rule is installed and when its consequences run. Both paths use the current protections and follow declared dependencies for initial actions and rule-generated effects. Consequence records include the actor, selector, and predicate reads used during dispatch. The registry accepts only its typed data and operations. The rule can record the player's statement as a character's belief while objective facts retain independent provenance.

The coordinator starts with roots in proposal order. It processes their consequences breadth-first, orders matching rules by ID, and applies a rule's effects in definition order. It checks an event and rule pair at most once. Installation rejects cycles in the graph of item-offer triggers and effects. Root operations and all descendants share 32 operations, 32 events, 64 KiB of output and facts, 1 MiB of checkpoint bytes, and the five-second execution deadline. The deadline covers preparation for execution, rule execution, revalidation, and publication as one commit. Rules also have a limit of eight causal levels below a root and 128 dispatch or condition evaluations. Failed conditions count against that evaluation limit. The v1 operations make zero random draws. Budget exhaustion aborts the entire candidate.

The committed event for each consequence carries the rule ID, cause and result event IDs, effect index, typed effect, and actual footprint. A Play receipt shows public offer and transfer outcomes grounded in that receipt's producing checkpoint. An authorized Editor can inspect causal steps, definitions, and character belief evidence. Exact retries resolve to the saved receipt. To validate a version 2 transition, the store uses the digest-verified typed proposal and its original generation, plus the previous world to recompute the expected state and effect records without changing the active world. Combined save and portable history preserve both pending and consumed offers. A restore reinstates the saved offer state and starts a new request generation.

[Fixture MCP actions](../../plugin/references/fixture-mcp.v1.md) · [Rule contracts](../../engine/src/world/rule-contracts.ts)
