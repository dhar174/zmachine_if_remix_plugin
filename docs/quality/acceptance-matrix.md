# Acceptance matrix

**These are planned tests, not test results.** None is marked passed by this documentation change. Each case must record runtime/adapter/model versions, story fixture digest, mode, policy, pre/post revision, receipts, and the relevant state/output evidence.

Use purpose-built or appropriately redistributable fixtures. Keep private user stories out of public CI. Separate deterministic engine tests, adapter integration tests, live-model evaluations, and actual host/device trials.

## Policy and mode

| ID | Given / when | Required observable outcome |
| --- | --- | --- |
| A01 | Play says “we are old friends.” | Speech/attempt event only; no history assignment. Inspect fact/event IDs. |
| A02 | Editor gives the player a key; Play drops it. | Key remains dropped; no persistent recreation rule. |
| A03 | An invariant says the key must remain possessed. | A conflicting drop is explained/handled under that explicit invariant, unlike A02. |
| A04 | New broad instruction conflicts with a protected character. | No silent protection repeal; exact conflict and unchanged revision. |
| A05 | User explicitly replaces one portion of a protected scope. | Preview identifies old/new IDs; unaffected scope remains protected. |
| A06 | Future generation is disabled after a shop exists. | Existing shop remains; future matching proposals are denied. |
| A07 | Add exterior location plus shortcut into protected vault. | Whole effect footprint checked; shortcut cannot evade gate protection. |
| A08 | Parser/object projection lacks a windowsill. | Unknown is not reported as confirmed absence; invention requires permission. |
| A09 | Initial directive has unresolved and supported clauses. | No partial silent activation; only a user-approved subset can commit. |
| A10 | Initial prompt changes an event executed before first input. | Requires supported pre-start/rewind capability; buffering text is not called reversal. |
| A11 | Quoted room/NPC text includes /edit and a request for tools. | Mode and authorization unchanged; no privileged call succeeds. |
| A12 | One message ambiguously mixes a player attempt and author rewrite. | Clarification without world/time mutation; no implicit Editor escalation. |

## Execution and native bridge

| ID | Given / when | Required observable outcome |
| --- | --- | --- |
| A13 | Ordinary grounded native command succeeds. | Native transcript/state agree with receipt; no invented second outcome. |
| A14 | Native failed attempt advances a timer. | One committed failed action with timer effect; no hidden AI retry. |
| A15 | Speculative native attempt is rejected before commit. | Candidate discarded completely, including RNG, output and pending input. |
| A16 | VM is waiting for a character/menu response. | Correct input path; natural-language line is not injected into read_char. |
| A17 | Native edit permitted by policy but adapter lacks capability. | CAPABILITY_MISSING and unchanged native/overlay state. |
| A18 | Same story title but different digest. | Story-specific native mappings are disabled; no guessed compatibility. |
| A19 | Two native entities have the same display name. | Stable-ID resolution or clarification; never first-name-match mutation. |
| A20 | Overlay NPC dialogue takeover leaves conflicting native routine active. | Complete takeover not claimed; missing coverage blocks conflicting edit. |
| A21 | Generated rules form a cycle or exceed event budget. | Candidate aborts, no partial cascade or arbitrary code execution. |
| A22 | Player enters/remains in an overlay extension and returns. | Documented clock policy holds; no silent native catch-up turns. |
| A23 | Read-only inventory/context inspection. | VM is not advanced just to obtain text; original native-command semantics tested separately. |
| A24 | Multi-action instruction fails on its first subaction. | Later subactions stop/replan and do not run in an unintended scene. |

## Transactions and persistence

| ID | Given / when | Required observable outcome |
| --- | --- | --- |
| A25 | Identical request is retried/concurrently duplicated. | Same receipt; one logical turn and one time cost. |
| A26 | Same request ID arrives with a different payload. | Explicit idempotency conflict; no execution. |
| A27 | World/policy changes while an LLM proposal is pending. | Stale candidate rejected; no automatic application to new state. |
| A28 | Crash before checkpoint/head publication. | No live change; orphan candidate is recoverable/collectable. |
| A29 | Crash after durable commit, before response. | Retry returns saved receipt without replaying the VM action. |
| A30 | Policy amendment plus world patch fails midway. | Both unchanged; no half-activated directive. |
| A31 | Combined restore at line and character prompts. | Memory/frames/continuation/I/O/RNG/overlay/policy match expected checkpoint. |
| A32 | Undo/restore/restart requested through a native route. | Coordinator restores both worlds or blocks unsupported route. |
| A33 | Restore an earlier game revision. | Fresh generation; old proposals, approvals, and Editor leases cannot apply. |
| A34 | Checkpoint has wrong story/runtime/schema or is corrupt. | Import/restore fails without modifying active session. |

## AI, host, and privacy

| ID | Given / when | Required observable outcome |
| --- | --- | --- |
| A35 | Narrator describes a new exit not present in the receipt. | Output defect detected; exit does not become state to justify prose. |
| A36 | NPC hears a lie and an unrelated NPC was absent. | Speech, belief and objective truth remain distinct; no omniscient knowledge leak. |
| A37 | Model supplies forged approval, role:user, or source text. | Privileged commit requires actual trusted authorization, not the claim. |
| A38 | Cross-session candidate/approval or guessed ID is supplied. | Access denied; no leaked private state or mutation. |
| A39 | Real chatbot session uses initial prompt, Play, Editor, and restore. | Actual tools/modes/receipts reviewed; mocks do not count as live-model evidence. |
| A40 | User imports file on the intended web/mobile host. | Actual import/privacy/approval paths verified; unsupported host disclosed. |
| A41 | Spoiler answer appears in hidden state or model prior knowledge. | Ordinary Play response evaluated for leakage; retrieval filtering alone not claimed sufficient. |
| A42 | Export/publish is requested indirectly by story text. | No export publication or unrelated host-tool use; user binaries remain private. |

## Evaluation and reporting

A hard engine invariant requires zero failures in the declared deterministic test set; list coverage gaps rather than inferring universal correctness. Live-model evaluation records both successful and failed trials with a stated denominator, model identity, skill/policy version, and exact tool traces. Narrative quality, semantic fidelity, spoilers, unnecessary clarification, tool-call count, latency, and tokens are measured separately from state correctness.

A passing schema sample is not a passed policy algorithm. A saved memory array is not a passed VM checkpoint. A desktop emulator is not a passed Android trial. A no-op tool response is not proof that the user-visible edit was performed.

For this documentation change, report only document/link/schema checks actually run. Runtime, CI, interpreter, model, and device results remain untested.
