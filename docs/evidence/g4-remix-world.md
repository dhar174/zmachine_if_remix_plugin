
# G4-A persistent remix world

[Issue #23](https://github.com/dhar174/zmachine_if_remix_plugin/issues/23) covers a deterministic engine slice. The fixture supplies a player, two rooms in separately scoped regions, two guards with the same name, and a pair of facts with different visibility.

## Ownership and operations

The versioned world is stored once in the committed turn image. It contains stable remix IDs, registered room regions, directed exits, character placements, item holders, relationships, objective facts, individual beliefs, and events. The engine derives contents from item holder links. A transfer changes one canonical placement and declares the item, both affected inventories, and the holder and container preconditions to the policy resolver. Both endpoints of a connection participate in policy checks. World operations use IDs throughout and the engine rejects ambiguous, missing, stale, or unfamiliar targets.

The existing coordinator prepares a candidate against the current revision, resolves complete effects against active policy, and publishes the image, events, and receipt in one SQLite transaction. World proposals may omit declared effects. The resolver derives them and verifies any explicit declaration. Preparation also replays the independent operations on an isolated copy. Candidate execution recomputes the state and footprint from the same immutable revision. Each retry is scoped to the original request, payload, and generation. Editor authoring uses the existing exact approval and generates a one-time transition. Creation permissions are prospective. Explicit invariants continue to apply after approved assignments.

The native VM retains authority over its state and clock. The world may coexist with adapter projections. Its writes use only registered remix IDs and holdings. Cross-owner transfers and native connections require their own verified capability. Play inventory commands cover taking from eligible scene holders, dropping, and handing off from player holdings in the same scene. The slice supports nested placement with a maximum of 16 item links in a chain. Moving a nonempty container, moving characters between rooms, and deleting records are outside the slice. A dependent operation uses a subsequent subturn under the existing resolver rule. Independent changes can share one atomic candidate.

## Provenance and fictional knowledge

Facts have an owning subsystem, a stable source event, an inclusive starting revision, an optional exclusive ending revision, visibility, and evidence status. One-time assignments and Play outcomes retain their distinct source types. The registered interpersonal facts are current directed relationships between two characters. Speech is attributed verbatim to the fixture player, with listeners derived from placements at the event revision. An observation records the exact visible fact version available to its observer. An individual belief requires an earlier observation or attributed statement the character heard.

Play inspection is limited to the fixture scene and its outgoing exits. Both endpoints of a relationship must be present in that scene for Play inspection or observation. An observation requires the player and observer to share a room at the recorded revision, including when validating persisted history. Authorized Editor inspection can also read off-scene facts and attributed belief evidence. Queries keep clocks and revisions unchanged. Play receipt views preserve recovery metadata and withhold owner-only fields. The receipt view checks the producing checkpoint, its lineage parent, and the ordered event rows. For a turn with new world events, each narration note must match a visible result at the committed revision. When the transition cannot be verified, the view withholds narration notes. Verified native and legacy turns retain their prose and withhold structured world notes. Rule execution, native extension entry, reader disclosure, broader model context and narration evaluation, and live host behavior are downstream work.

World-bearing images use an explicit payload version and bind it into the existing combined remix-state digest. Legacy images retain their original hash and shape. World events keep stable IDs in the payload and receipt event bodies. External receipt event IDs must be unique across a signed portable history. Portable relocation assigns fresh storage row IDs and preserves world IDs and historical references. The save, restore, and portable lineage paths verify each parent-to-child transition. Restore and turns without world events preserve the entire parent world. A world change must preserve existing records and historical values, and its new events must match the receipt rows in order.

## Deterministic acceptance evidence

| Case | Engine fixture assertion |
| --- | --- |
| A01 and A36 | “We are old friends” records speech. A nearby listener can acquire an attributed belief. The absent guard cannot use the event, and the pre-existing relationship stays unchanged. An observation recorded before a fact edit still points to that earlier version after the edit. |
| A02 and A03 | An Editor-granted key stays dropped. In a separate fixture path, an explicit possession invariant rejects the same action. |
| A06 | An approved generation denial preserves the already created guard and rejects a new guard. |
| A19 | Duplicate room and character labels preserve distinct IDs. Connections and inspections select exact IDs, and an unresolved display label is rejected. |
| A30 | A denied endpoint rejects a bundle. An injected publication fault leaves the prior checkpoint intact for both creation and a combined policy and typed fact change. Identical concurrent retries publish one result. Two different proposals against one head publish one winner. The fixture also exercises cancellation, approval revocation, expiry, restart fencing, orphan collection, and recovery after publication. |
| Ownership, visibility, and integrity | Wrong holders, dangling references, containment cycles, unsupported native effects, hidden observations, corrupt references, and mismatched event bodies are rejected. A successful independent batch, a rejected fill-and-move batch, handoff, theft denial, and the 16-link boundary exercise the transfer rules. Authorized inspection keeps time and revision unchanged in both modes. Play receipt lookup and replay exercise owner redaction and off-scene disclosure limits. |
| Serialization and compatibility | Canonical serialization, SQLite reopen, existing combined restore, and signed portable encode, decode, and relocation preserve world IDs and facts. Regression cases reject a rewritten fact in a restore or native checkpoint, extra world-turn event rows, and stale or future observation evidence. A fresh generation can reuse a request ID for one new commit, while previous approvals remain stale. The redistributable seeded Z5 fixture exercises private import into a fresh SQLite store and continued native and remix turns. Legacy hashes and unsupported versions have separate tests. |

The world regression entry point is [world.test.ts](../../engine/tests/world.test.ts), with the [serialized sample](../../engine/tests/fixtures/generated-world.v1.json). Run the following from `engine` on the pinned toolchain.

```text
npm run build
npm run typecheck
npm run lint
npm run test:schema
npm test
```
