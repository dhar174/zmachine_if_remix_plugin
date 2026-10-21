# Z-Machine Remix Engine

**Design draft v0.1 | 2026-09-23 | Awaiting Charles's review**

This is a design specification, not an implemented player. The uploaded binary has been inspected read-only. No interpreter session, gameplay test, state mutation, AI integration, or deployment has been performed.

## 1. Intent and first-build boundary

Charles wants to play his uploaded Z-machine story inside a modern remix engine, with the freedom to attempt actions, change characters and objects, and extend the world beyond its original parser and authored situations. The existing LoreSight mobile experience has a scrolling problem, so this design targets a standalone browser player, not an alteration to LoreSight's widget.

The agreed direction is a real interpreter with a remix layer. Proposed defaults are local-first storage, a mobile-friendly interface, reversible edits, and an optional language-model connection. These defaults and the scope below are still subject to review.

Success means a playable original game with persistent, inspectable changes, rather than a chatbot improvising a parallel story while the underlying game remains unchanged. “Anything mode” means an extensible simulation with explicit capabilities; it does not promise that arbitrary requests already have working mechanics.

The first build is one vertical slice: import the supplied story, play normally, inspect its world, make one validated native-state edit, create and visit one overlay location, save the combined session, and restore or undo it. The optional model should propose exactly the same actions available through deterministic controls, not become a separate source of truth.

## 2. Verified input and remaining unknowns

The companion `binary-audit.json` records the full read-only inspection and extracted object metadata.

| Field | Observed value |
| --- | --- |
| Uploaded filename | `chix (2).z5` |
| Z-machine version | 5 |
| Release / serial | 2 / `991124` |
| Actual file size | 206,848 bytes |
| Header-declared story size | 206,788 bytes |
| Trailing bytes | 60; retain the original bytes unchanged |
| Header compiler marker | `6.15` |
| Stored and calculated checksum | Both `0x5363` |
| Dynamic memory extent | Bytes 0 through 16,706 |
| Object table / first entry | 266 / 392 |
| First property table | 3,262 |
| Inferred object count | 205 |
| Dictionary entries / entry width | 576 / 9 bytes |
| Globals table address | 13,772 |
| SHA-256 | `76ab21dcbdd7e257c4b05957a367f54a079263ffdac3ccf1143ed25db2ca4bc7` |

Object-count inference is specific to this file: 14-byte entries end exactly at the earliest property table. All parsed property lists and parent/child/sibling links were validated, including cycle checks. The Z-machine header does not provide a universal object-count field. The inspection recovered short names such as `Bar` (135), `Holly` (143), `Inside the Chevette` (161), `Before the Iron Gate` (183), and `gate` (184). Names are not unique: two different objects have the short name `Keegan`, and two are named `Cemetery`.

The 205 entries include hint-menu text and internal objects. They are not 205 rooms, characters, or independently usable gameplay entities. A root-level object is not automatically a room, and an attribute bit or global variable does not acquire a semantic name merely because it can be read.

Unknowns to resolve during implementation are the exact player/location bookkeeping, semantic flag and property mappings, scene and timer state, and which edits preserve useful progression. No complete source reconstruction or story-specific bridge has been verified. Do not infer these mappings from another Inform game or assume a source rebuild would retain the same IDs and addresses.

## 3. Options and selected direction

**Recommended: original VM plus a persistent remix world.** Keep normal commands and authored logic in the interpreter. Use a narrow, story-specific bridge for verified native edits. Store genuinely new entities and mechanics in an external world model. This preserves the original while leaving room for extension, but requires explicit handling of the boundary between the two systems.

**Transcript-only AI companion.** Cheapest to assemble, but invented outcomes would not necessarily affect inventory, gates, or later checks. It does not meet the core success criterion.

**Rebuild the entire story in a new engine.** Offers the most control, but requires reconstruction and regression testing of the existing game. It is not the first-build target. An eventual source-based port could use the same interface and remix world model.

## 4. Proposed components

### Browser application

Use TypeScript with a small DOM-based interface and a Vite build. A text adventure does not need a canvas or a 3D engine. Keep the simulation independent of the UI so that a later React interface or desktop shell does not require rewriting the game engine.

Provide four surfaces: Play, World Inspector, Remix, and Saves. The first mobile layout uses one primary document scroll, large touch targets, a sticky command composer, and an explicit jump-to-latest button. Preserve the reader's position when they scroll upward. Settings and inspectors replace the active view rather than becoming tiny nested scroll panes. CRT styling is optional; plain readable text and reduced motion are defaults.

Preserve interpreter output semantics, including its status/text-grid window and character-input prompts. A conversation menu must accept character input without routing it through a line-command parser.

### Interpreter adapter

The initial candidate is a pinned `ifvms.js` ZVM revision behind our own adapter. Its inspected source accepts Z-code versions 3, 4, 5, and 8, exposes runtime object operations, and implements save/restore and autosave machinery. Its API requires a Glk implementation. These are capabilities visible in source, not proof that this story or our planned bridge has passed integration tests.

Keep Glk I/O integration explicit. Do not treat a raw memory array as a complete player. Prefer an isolated worker with a message-based I/O adapter; the integration milestone must prove the full input/output and save lifecycle before the rest of the engine depends on it. Add a worker timeout and recovery path so an interpreter error cannot permanently freeze the interface. A worker is a responsiveness boundary, not a complete security guarantee.

Current Parchment uses a different stack, including AsyncGlk, Emglken, and Bocfel. It is a compatibility reference or fallback runtime candidate, not evidence that a modern Parchment instance exposes the old ZVM mutation methods. A fallback requires a new adapter and explicit revalidation.

### Story adapter

A `chix-r2-991124` adapter translates verified engine concepts to this exact binary's IDs and state. Enable it only when the full SHA-256 matches. A different release remains playable but must not silently receive these mappings.

Semantic mappings need evidence and tests. Unknown fields remain numbered, read-only data. Duplicate names are resolved with stable IDs and displayed context. Never choose the first string match automatically.

### Remix world

Store added rooms, items, characters, exits, descriptions, dialogue facts, and simple action rules in a serializable TypeScript model. Use separate namespaces: `native:<object-id>` for the compiled story and `remix:<uuid>` for added content.

The VM owns native memory and authored progression. The remix world owns added entities and mechanics. The session coordinator owns the committed combined revision, transactions, history, and the current control mode. The UI and model provider do not independently own gameplay facts.

### Optional model adapter

A model receives a bounded scene view, relevant established facts, and a list of supported actions. It returns a structured proposal. The session coordinator validates that proposal before it changes anything. Natural-language interpretation is optional; the engine remains playable and editable without a model.

A later local service can connect to Charles's chosen local model or configured provider. Provider selection is deliberately not a prerequisite for the first deterministic milestone. No API credentials are collected or embedded in this design package.

## 5. Control modes and action ownership

**Original mode:** send commands to the original interpreter; show unmodified native output. No overlay content or AI interpretations are silently injected.

**Hybrid mode:** run ordinary native actions in the VM, route explicit remix actions to the coordinator, and show added entities alongside native ones with source labels. For the first build, use an explicit Remix button or command prefix rather than guessing from a native rejection message.

**Extension scene:** when the player visits an overlay-only location, pause native execution at an input boundary. The remix world handles movement, examination, possession, and dialogue there. Returning to the anchor restores native control. Native timers do not silently advance while that VM is paused. The interface states this policy.

A native command that cannot represent an overlay entity must remain in the overlay action system or produce a clear unsupported-operation message. It must not be forwarded as though the compiled parser knew that entity. Cross-boundary transfer into native possession or progression requires a tested bridge capability.

Do not automatically run the VM and then ask an AI to reinterpret any output containing “cannot.” Such commands may have consumed a turn or altered hidden state. A future automatic fallback would need exact snapshots and reliable parser outcome instrumentation, not string matching alone.

## 6. Remix capabilities and honest limits

### Native editing

Start with object inspection and a validated `moveExistingObject` transaction for permitted non-player objects. Use the interpreter's object operations to update the parent/child/sibling structure, not a single parent-byte patch. Check bounds, containment cycles, object roles, and story-specific restrictions before committing.

Attribute changes and small property/global edits are available only through named, verified adapter capabilities. Player teleportation is not a generic reparent operation: location, visibility, scope, scene state, and library bookkeeping may also need updates. Do not expose it as supported until those changes have been established for this binary.

Structural validity is not proof that a puzzle remains solvable. Each edit displays either a tested story-specific capability or an explicit experimental warning. No raw arbitrary-memory-write or arbitrary-code-execution tool is given to the model.

### New content

New rooms, items, and NPCs are real overlay entities with persistent IDs, locations, properties, and supported actions. They are not silently appended to the compiled object table. For example, an authored remix can create a rooftop garden, connect it to the bar, and place a robot gardener there. This is an extension scene, not a claim that the original `.z5` now contains those objects.

The initial behavior vocabulary is deliberately small: inspect, move between connected overlay rooms, take/drop eligible overlay items, talk using stored facts, change descriptions, and create or remove overlay entities and exits. More elaborate mechanics require an explicit rule implementation. Adding a vehicle does not automatically implement a driving simulator.

### Narration

Keep three concepts separate: original output, committed remix events, and optional AI-generated narration. The engine prints a deterministic change summary for every mutation. Generated narration is supplementary and labeled; it must not be relied on as proof that a state change occurred.

Models may propose richer outcomes, but unsupported effects are not committed. Story text, character dialogue, imported descriptions, and model responses are untrusted data, not authority to change tools, reveal secrets, execute code, or contact external services.

## 7. Transaction, snapshot, and save rules

Only mutate native state while the interpreter is paused at a supported input boundary. Serialize commands and remix transactions through one coordinator. Each proposal carries the current session revision; stale proposals are rejected instead of being applied to a changed world.

A transaction captures the complete relevant state, validates its operations, applies them to a working state, verifies postconditions, and commits one revision. On failure restore the complete checkpoint and report the reason without inventing success text. Expose before/after values and one-click undo.

A checkpoint must include native dynamic memory, program counter, stacks and call frames, pending input/continuation, relevant I/O state, RNG state or recorded random outcomes, interpreter version, and the complete remix state and history revision. The inspected runtime uses `Math.random()` in one RNG mode; exact branching reproducibility requires explicitly capturing or replacing that randomness in the adapter. Copying only RAM, calling a save routine at an arbitrary instruction, or replaying commands without RNG control is insufficient.

Use the upstream autosave lifecycle as a starting point, with round-trip tests at both line and character prompts. Native UNDO and RESTORE must be coordinated with remix state; in hybrid mode they cannot silently restore only half the session. Restart and return-to-original are distinct actions with confirmations.

Store sessions locally, with explicit export/import. A portable remix session includes a schema version, exact story hash, runtime version, VM checkpoint, overlay state, committed action history, and transcript context. It excludes the complete original story by default; loading it requires the same story file. State exports can still contain game text and user-created content, so describe them as session data rather than claiming they are content-free patches.

A remix session is not a new universally playable `.z5`. Normal Z-machine save interoperability, where supported, covers only native state. The combined session requires this engine.

## 8. Privacy and deployment defaults

The user selects a local file. Do not automatically upload it, search personal files, publish a repository, or deploy the story to a third-party host. Keep the original bytes immutable. Distribute the engine separately from the supplied story; this is a packaging choice, not an assertion about redistribution rights.

Model features are opt-in and show what scene text or state will be transmitted and to which configured endpoint. Send only necessary context, never the entire binary by default. A future provider gateway keeps credentials server-side, restricts origins and endpoint configuration, and applies request size, timeout, and tool-call limits. It must not become an open proxy.

Initial delivery target: source package plus local browser runner. Public hosting, installation as a PWA, accounts, cloud saves, multiplayer, voice, image generation, and a full authoring studio are outside the first build.

## 9. Acceptance gates for the first playable build

1. **Interpreter baseline:** load this exact file, reach usable input, execute `LOOK` and `INVENTORY`, handle a real character/menu prompt, and capture a repeatable reference transcript. Check supported Z-machine conformance fixtures for the chosen runtime. Test invalid and truncated input without crashing the app.
2. **Inspector:** display the verified object count and IDs; distinguish duplicate names and internal objects; observe live state after native actions. Unknown semantic fields remain read-only.
3. **Native transaction:** relocate one permitted existing object, verify all relevant links and the observable native result, then undo it. Reject invalid IDs and containment cycles without partial changes. Treat puzzle-level consequences as unverified unless separately tested.
4. **Overlay round trip:** create a small connected extension, enter it, interact with an added entity, and return. Native state remains paused according to the documented policy. Never forward an overlay-only entity to the native parser as a native object.
5. **Combined persistence:** export, reload, and restore both worlds at line and character prompts. Compare memory, stacks, continuation, overlay state, and controlled RNG behavior. Reject the wrong story hash and incompatible runtime/schema versions. Verify native restore/undo cannot desynchronize hybrid state.
6. **Model proposal validation:** use fixtures for valid, malformed, ambiguous, stale, and unsupported proposals. Prove that narration alone cannot mutate state and that prompt-like story content cannot execute commands. Real model connectivity is reported separately from fixture tests.
7. **Mobile usability:** test a narrow portrait viewport, software keyboard resizing, touch scrolling, long transcripts, view switching, and reduced-motion settings. Do not claim an Android-device test from desktop emulation alone.

Implementation should prove gates 1 and 5 early. A beautiful interface is not a substitute for a correct interpreter and complete save boundary.

## 10. Review decision

Approve or adjust the following first-build scope: standalone, local-first hybrid player; real original-game execution; inspector; guarded native edits; persistent overlay locations/items/NPCs; combined undo/save; explicit action ownership; and an optional model adapter after deterministic behavior works.

The detailed implementation plan and execution choice follow approval of this written design. No product implementation is included in this package.

## References and evidence

Sources inspected on 2026-09-23. Source-code observations are not runtime test results. Pin exact upstream revisions during implementation rather than relying on moving branch URLs.

- Supplied binary, original file ID `file_00000000598881f4b10ad46c505e8b7c`; read-only measurements and per-object metadata: `../../../binary-audit.json`.
- Z-machine memory map: https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect01.html
- Z-machine object table: https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect12.html
- Z-machine globals and call state: https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect06.html
- ifvms.js project and license: https://github.com/curiousdannii/ifvms.js
- ZVM API, supported versions, memory and input lifecycle: https://raw.githubusercontent.com/curiousdannii/ifvms.js/master/src/zvm.js
- ZVM runtime object operations, RNG, save/restore and autosave state: https://raw.githubusercontent.com/curiousdannii/ifvms.js/master/src/zvm/runtime.js
- ZVM I/O implementation: https://raw.githubusercontent.com/curiousdannii/ifvms.js/master/src/zvm/io.js
- Current Parchment components and offline build options: https://github.com/curiousdannii/parchment
