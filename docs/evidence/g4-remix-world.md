
# G4-A persistent remix world

[Issue #23](https://github.com/dhar174/zmachine_if_remix_plugin/issues/23) covers a deterministic engine slice. The fixture supplies a player, two rooms in separately scoped regions, two guards with the same name, and a pair of facts with different visibility.

## Ownership and operations

The versioned world is stored once in the committed turn image. It contains stable remix IDs, registered room regions, directed exits, character placements, item holders, relationships, objective facts, individual beliefs, and events. The engine derives contents from item holder links. A transfer changes one canonical placement and declares the item and both affected inventories to the policy resolver. Both endpoints of a connection participate in policy checks. World operations use IDs throughout and the engine rejects ambiguous, missing, stale, or unfamiliar targets.

The existing coordinator prepares a candidate against the current revision, resolves complete effects against active policy, and publishes the image, events, and receipt in one SQLite transaction. World proposals may omit declared effects. The resolver derives them and verifies any explicit declaration. Candidate execution recomputes the state and footprint from the same immutable revision. Each retry is scoped to the original request, payload, and generation. Editor authoring uses the existing exact approval and generates a one-time transition. Creation permissions are prospective. Explicit invariants continue to apply after approved assignments.

The native VM retains authority over its state and clock. The world may coexist with adapter projections. Its writes use only registered remix IDs and holdings. Cross-owner transfers and native connections require their own verified capability. Play inventory commands cover taking from eligible scene holders, dropping, and handing off from player holdings in the same scene. The slice supports nested placement with a maximum of 16 item links in a chain. Moving a nonempty container, moving characters between rooms, and deleting records are outside the slice. A dependent operation uses a subsequent subturn under the existing resolver rule. Independent changes can share one atomic candidate.

## Provenance and fictional knowledge

Facts have an owning subsystem, a stable source event, an inclusive starting revision, an optional exclusive ending revision, visibility, and evidence status. One-time assignments and Play outcomes retain their distinct source types. Relationships are current directed facts with named endpoints and bounded values. Speech is attributed verbatim to the fixture player, with listeners derived from placements at that revision. An observation records the exact visible fact version available to its observer. An individual belief refers to the statement heard or fact revision observed. The relationship between the speaker and listener stays independent of the statement. The observer set also stays independent of reader disclosure.

Play inspection is limited to the fixture scene and its outgoing exits, and returns current visible facts. Explicit authorized Editor inspection can also read private facts and attributed belief evidence. Queries keep clocks and revisions unchanged. Public receipts carry only the committed visible results of supported scene actions. Rule execution, native extension entry, broader model context and narration evaluation, and live host behavior are downstream work.

World-bearing images use an explicit payload version and bind it into the existing combined remix-state digest. Legacy images retain their original hash and shape. World events keep stable IDs in the payload and receipt event bodies. Portable relocation can assign fresh storage row IDs while preserving world IDs and historical references. The existing save, restore, and portable lineage paths check that the applicable receipt records match the committed world event bodies.

## Deterministic acceptance evidence

| Case | Engine fixture assertion |
| --- | --- |
| A01 and A36 | “We are old friends” records speech. A nearby listener can acquire an attributed belief. The absent guard cannot use the event, and objective history is unchanged. A later observation still points to its original fact revision. |
| A02 and A03 | An Editor-granted key stays dropped. In a separate fixture path, an explicit possession invariant rejects the same action. |
| A06 | An approved generation denial preserves the already created guard and rejects a new guard. |
| A19 | Duplicate room and character labels preserve distinct IDs. A connection and inspection select exact IDs. |
| A30 | A denied endpoint rejects a bundle. An injected publication fault leaves the prior checkpoint intact for both creation and a combined policy and typed fact change. Identical concurrent retries publish one result. |
| Ownership, visibility, and integrity | Wrong holders, dangling references, containment cycles, unsupported native effects, hidden observations, corrupt references, and mismatched event bodies are rejected. Authorized inspection keeps time and revision unchanged. |
| Serialization and compatibility | Canonical serialization, SQLite reopen, existing combined restore, and signed portable encode, decode, and relocation preserve world IDs and facts. The fixture also exercises a native turn after restore and validates legacy hashes and unsupported versions. |

The world regression entry point is [world.test.ts](../../engine/tests/world.test.ts), with the [serialized sample](../../engine/tests/fixtures/generated-world.v1.json). Run the following from `engine` on the pinned toolchain.

```text
npm run build
npm run typecheck
npm run lint
npm run test:schema
npm test
```
