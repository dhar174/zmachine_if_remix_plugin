# State ownership, native bridge, and persistence

**Proposed contract v0.2.** No native adapter or save round trip has been implemented or verified by this documentation change.

## 1. Original canon is not a fully recovered database

The original story bytes are immutable input. The running VM owns native execution state. Descriptions, objects, routines, and globals can be inspected, but their story meaning is only partially observable without an adapter or source. A bytecode parser is not a universal extractor of every character personality, puzzle dependency, or plot rule.

The Z-machine specification defines writable dynamic memory, structured object links, and execution/input operations; it does not provide universal semantic names for a game's globals or guarantee that moving one object updates every story-specific invariant. See [references S1-S3](../REFERENCES.md).

Keep unknown fields unknown. Do not label all root objects as rooms or all objects as physical things. Duplicate names require IDs. The archived binary audit is not evidence that this architecture can run, alter, or restore that story.

## 2. Canonical session state

A combined committed revision references:

| State family | Required contents |
| --- | --- |
| Identity | Story digest, runtime build, adapter build, contract/schema versions |
| VM checkpoint | Dynamic memory, instruction/continuation state, stacks/frames, pending input, relevant I/O, sound/timer state where supported, controlled RNG |
| Remix world | Entities, locations, connections, field values, knowledge/beliefs, relationships, bounded rules, scheduled events |
| Policy | Active policy revision, source clauses, explicit protections, amendment lineage |
| History | Events, causality, receipts, branch parent, stored model proposals and approved generated content |
| Clocks | Native timing evidence, overlay logical time, bridge clock policy, recorded random outcomes |

Security/session authorization lives outside historical game state. Restore invalidates existing editor leases and approval tokens rather than restoring their previous validity. The active input mode returns to Play after restore unless the user separately reauthorizes Editor.

Use stable namespaced identity such as `native:<story-digest>:<object-id>` and `remix:<uuid>`. Adapters may expose readable aliases, but aliases cannot be used as ambiguous mutation targets.

## 3. Facts, beliefs, and evidence

A fact record has subject, predicate, value, owning subsystem, provenance event, applicable revision interval, visibility, and evidence status. Evidence may be `native_observed`, `adapter_verified`, `editor_committed`, `play_committed`, or `unresolved`. An LLM inference alone is not a committed world fact.

A character's belief is a fact about that character, not automatically an objective truth. “The player told the guard they were invited” can establish the speech event and possibly a guard belief without establishing a real invitation. NPC knowledge is based on visibility and communication, not the full model context.

Native observations at later revisions update mutable state through validated transitions. An old editor assignment does not continually override newer gameplay. Persistent invariants are evaluated separately from ordinary state values.

Retrieve only the current scene, relevant policy, visible facts, and necessary prior events for ordinary Play. A summary or embedding index is a cache, not the authoritative state store. Stable fact/event IDs must survive summary refresh and model migration.

## 4. Ownership and takeover

Each mutable field or behavioral surface has one owner: native VM, remix engine, or a named adapter-mediated projection. Avoid two independent writers to the same character's location, inventory, attitude, or conversation state.

A takeover declares entity/surface, coverage, active revision, native suppression/interception mechanism, synchronization policy, and return conditions. Rendering alternate dialogue is insufficient when the original routine also moves an object or triggers a scene. Likewise, masking a native lock in prose while the parser still enforces it is not a successful unlock.

For the first bridge, prefer a narrow, tested capability over a universal takeover. Any partial coverage must be disclosed and scoped. Return `CAPABILITY_MISSING` when the requested complete effect is outside verified coverage; do not quietly offer an incoherent “best effort” and call it done.

## 5. Capability manifest

An adapter capability record names its exact story/runtime digest, supported operation, required input boundary, preconditions, permitted read/write sets, known dependent fields, effect reporting, inverse/checkpoint strategy, and test evidence.

Examples of distinct capabilities are native line input, native character input, read-only object projection, moving one eligible non-player native item, and a supported extension-anchor transition. A native player teleport is not just object reparenting. A capability for one story release does not automatically apply to another.

Direct mutation tools do not expose arbitrary byte addresses, raw property writes, shell commands, or dynamically evaluated code to the model. A protected scope with insufficient effect coverage cannot be edited safely merely because the raw bytes are writable.

## 6. Native-to-remix transitions

Entering a wholly added location pauses the native interpreter at a supported input boundary and stores an anchor/capsule describing return semantics. The remix world owns the player's overlay position while that scene is active. Returning is an explicit adapter-supported transition to a coherent native location and state.

Default for the first extension: native execution and native timers remain paused while the player is in the extension. Overlay logical time can advance independently. The UI/chat receipt discloses this difference. There is no hidden “catch up ten native turns” on return.

A future synchronized-time bridge must define how native timed input, daemons, NPC behavior, and overlay events align. It is a separate capability, not an assumed effect of emitting `WAIT`.

## 7. Persistence transaction

Treat the committed session head in the durable store as authoritative. Execute on a candidate VM/world state restored from the prior checkpoint, not directly on an irreplaceable live singleton.

1. Read head and clone/restore an isolated candidate at a supported boundary.
2. Validate and execute the proposed turn with instruction/event/time budgets.
3. Serialize the complete candidate checkpoint; verify its restoration contract.
4. Persist immutable checkpoint blobs durably. In a split blob/database design, ensure the blobs are durable before publishing references.
5. In one database transaction, compare expected head/policy generation, append event/receipt metadata, and publish the new head and idempotency result.
6. Reconstruct or swap any cached live VM from the committed head.

An orphaned candidate blob after a pre-commit crash is safe to collect. Publishing an event record before its VM snapshot exists is not. A process crash after publication must recover from the committed head and return the saved receipt without replaying the action.

The implementation must demonstrate this ordering; “we use event sourcing” alone is not proof of atomicity across a VM and external storage.

## 8. Undo, restore, and branches

Restoring a combined checkpoint restores native state, remix state, policy, generated content, and game clocks together. It creates a new head/generation with a historical parent/reference rather than rewriting published receipts. Idempotency keys are scoped to branch/session generation and cannot collide with a restored history.

Native `SAVE`, `RESTORE`, `UNDO`, and restart requests must be intercepted or coordinated so they do not restore just half the world. Block unsupported native restore paths rather than permitting silent desynchronization. A native-only exported save is explicitly labeled native-only and does not promise remix interoperability.

Exact reconstruction uses stored committed data and recorded RNG behavior. Regenerating LLM text is a new branch, not deterministic replay. Interpreter host randomness must be captured, injected, or recorded; memory-only snapshots do not establish this.

Past transcript messages may remain visible in a chatbot after undo. Mark the active branch/revision and stale events. Engine rollback cannot erase already seen spoilers or recover forgotten context without consulting saved state.

## 9. Import, export, privacy, and failure

Import validates story identity and structural limits before executing it in a restricted worker/process with no unnecessary network/filesystem access. A worker is an isolation mechanism to evaluate, not a complete security proof. Enforce CPU/instruction, memory, output, file-size, and wall-time budgets, plus parser error handling.

Session exports include schema/runtime/adapter versions and story digest. Exclude full story bytes by default. Save data may still contain game text and user content; it is not a content-free patch. Never publish exports or user binaries to the project repository without a separate explicit rights-aware request.

Wrong story hash, incompatible runtime, corrupt checkpoint, unsupported pending input, and migration failure must leave the active session unchanged. Migration uses a new tested revision/copy, never in-place blind reinterpretation.

Opening text can execute before the first prompt. Initial world changes requiring pre-intro control are unsupported until a pre-start hook is verified. Buffered output does not reverse hidden effects.

## 10. State ownership refinements after D01–D37

See the [approved decisions](../decisions/decision-register.md) and [reconciliation](../decisions/contract-reconciliation.md). These are data-model requirements, not claims that the VM/adapter already exposes the required hooks.

**Presentation versus authoritative native data (D11–D13, D18–D19).** Unified inventory and progress are read projections across native and remix entities. One field has exactly one writer unless a tested bridge declares atomic synchronization. Store original output verbatim with input-kind/scene/revision metadata, alongside clearly attributable user-visible AI prose. No overlay flashlight/narration can set an unmapped original puzzle flag or native score.

**Actor knowledge, goals and autonomy (D16–D17, D20–D26).** Distinguish verified objective event, character observation, speech claim, belief, reader disclosure, relationships and quest commitment. A policy-authorized offscreen NPC uses bounded committed-time events with explicit actor and witnesses, never omniscience or idle wall-clock updates. Quest lead/offer/active/accepted statuses, deadlines, generated puzzle outcomes and deterministic/recorded RNG belong in versioned overlay state only when implemented. The original game owns its authored timers/RNG/progression. Native clock remains paused in overlay scenes by default (D07).

**Native terminal states (D14–D15).** A true original VM ending or death is part of its checkpoint and immutable causal event history. Any policy-authorized continuing epilogue/aftermath is overlay-owned with native execution halted, not a retroactive rewrite. A suspected dead-end is not automatically a terminal state.

**Concurrency and portability (D27–D28).** Combined checkpoints, runtime/story hashes, branch/generation IDs, policy, event receipts and source-provenance must survive a change of chat/model. Unauthorized or stale clients cannot mutate a branch; enforce revision/CAS at commit and keep authorizations outside restorable game state. Do not silently re-run a candidate after a competing commit.

**Future cross-world identity (D29–D37).** Branch merging preserves independently executed native histories; cross-game imports create fresh destination remix IDs with source provenance and dependency closure. Copies are independent by default; explicit moves and linked identities require separate validated capabilities. Synchronized facts retain distinct originating event time, destination receipt time, objective-evidence versus belief labels, and source branch/generation. A source rollback flags dependencies but does not delete already committed destination history. Suspend/unlink halts future sync; private data deletion follows separate authenticated retention requirements. Sharing across owners is opt-in and redacted. None of these features should be assumed available for the first single-story release; D38 remains unapproved.
