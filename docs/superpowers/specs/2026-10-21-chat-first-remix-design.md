# Chat-first remix engine: design v0.2

**Date:** 2026-10-21  
**Status:** proposed architecture for review; documentation only  
**Repository baseline inspected:** `f4e019743f4026b4ceb82668164b7c36759b2b68`  
**Supersedes:** browser-first and optional-AI product choices in [v0.1](../../design_draft_v0.1.md), not its historical observations.

## 1. Purpose and confirmed requirements

The player uses a chatbot such as ChatGPT as the primary interface to a real original game plus a persistent, AI-created remix. AI interprets natural language, authors allowed extensions, performs character dialogue, and narrates committed results. Engine code makes those changes consistent, inspectable, reversible, and durable.

The following are user-specified requirements, not newly invented preferences:

- **R1: Faithful by default.** Original fiction and mechanics remain in force except where an explicit user directive changes them or grants bounded generation permission. Faithfulness does not freeze ordinary game state.
- **R2: Initial directive.** Loading a game includes an initial user prompt describing what may change, what must not change, and whether, where, and when spontaneous content is allowed.
- **R3: Two input modes.** Play is in-character action/choice interpretation; Editor is out-of-character world and rule direction. Explicit mode changes can occur during the session.
- **R4: Persistent user direction.** The initial directive and subsequent editor amendments govern later play; established authorized additions persist.
- **R5: AI-first interface.** Chat is the intended interface; skills and executable components cooperate behind it. AI is part of the first integrated demo.
- **R6: Real state, not parallel narration.** Original and added mechanics must agree with what the player is told happened.

Success is a coherent, saved remix of a playable original, not merely a language model reciting its own imagined version. A user can ask why an action failed and receive rule/evidence references without hidden chain-of-thought.

## 2. Alternatives and recommendation

| Approach | Strength | Failure or trade-off |
| --- | --- | --- |
| Transcript-only game master | Fast creative prototype | Does not establish native state changes or dependable continuity; rejected for the core product |
| Entire story reconstructed in a new engine | Potentially complete authorial control | Requires substantial reconstruction and behavioral regression; not the first milestone |
| **Native VM + persistent remix world + policy-aware coordinator** | Preserves authored execution while extending it; testable edits | Requires explicit ownership, adapter capabilities, and complete snapshots; recommended |

Use skills for model-facing workflow instructions and an MCP service for stateful execution. A bundled script-only runner may be a development harness in an execution-capable host, but packaging scripts is not proof that every chatbot can run a persistent process. See [plugin contract](../../architecture/plugin-contract.md) and [external references](../../REFERENCES.md).

## 3. Proposed components

**Conversation adapter and skills.** Interpret explicit mode selection, preserve user wording, request bounded context, propose structured actions, and narrate verified outcomes. Do not silently upgrade an in-fiction claim to an editor instruction.

**Directive compiler.** Convert initial/editor text into a proposed policy amendment, a one-time world patch, presentation preferences, and unresolved clauses. Keep source text and clause-to-rule provenance. Show an intelligible interpretation before activating it.

**Policy evaluator.** Apply executable permissions and invariants to complete proposed effects. Separate mechanically decidable checks from semantic judgments requiring evidence or review. A schema alone cannot prove fidelity to personality or plot.

**Turn coordinator.** Own session revisions, mode leases, policy revisions, proposal staging, idempotency, transaction commit, time advancement, and structured receipts. It is the sole commit boundary.

**Native VM and story adapter.** Execute authored code; expose only tested, versioned capabilities and observations. A story adapter is keyed by the exact story digest. Native object IDs and numbered flags do not automatically reveal semantic purpose.

**Remix world.** Store added entities, relationships, knowledge, dialogue events, rules, and connections. User-approved AI-generated content persists here unless a tested native bridge is required.

**Durable session store.** Store combined checkpoints and immutable revision/event references. A live VM is a recoverable working process, not a separate permanent source of truth.

**Optional components.** Maps, inventories, approval panels, and a future standalone client are secondary surfaces. No first-build requirement for a large visual player.

## 4. Three distinctions that prevent incoherence

### Policy is not state

A permission says what may be invented or changed. A state assignment says what is true now. An invariant says what must remain true. A preference says how to present the result. These are not interchangeable.

“Give me a key” is a one-time assignment. Dropping it later is valid play. “The key must always remain in my possession” is a continuing constraint that may conflict with dropping it. “Protect the original lock puzzle” preserves mechanics, not a permanently locked door after the player finds the intended key.

### Authority is not storage ownership

User direction can be more authoritative than the original fiction without magically making an unmapped native global safe to edit. Permission and implementation capability are separate gates. Every mutable field has one owning subsystem or an explicit tested synchronization contract.

### Unknown is not false

A parser rejection is evidence about that command, not a universal proof about the fictional world. An object not found by inspection may still exist in descriptions or code. The engine must distinguish confirmed absence, unobserved facts, unmapped state, and contradictions. It may not invent a missing detail unless policy permits doing so.

## 5. Input modes versus execution routes

There are exactly two user-facing input modes: **Play** and **Editor**. Read-only help, policy explanation, and inspection are queries rather than a third gameplay mode.

Internal execution routes are orthogonal: **native**, **remix**, or **bridged**. Editor can modify an overlay entity or a verified native field; Play can exercise native or remix mechanics. Do not reuse v0.1's “Original/Hybrid/Extension” labels as input modes.

Explicit `/play`, `/edit`, and one-turn `/edit ...` syntax are proposed conveniences, not installed commands. Ambiguous mixed input requests clarification without world/time changes. Quoted dialogue containing those strings is fiction, not control input. The server must not trust the model's claim about message origin as authentication.

## 6. Initial-load behavior

Validate the chosen story, disclose the processing location, and establish a private session. At a supported initialization/input boundary, compile the initial directive and stage requested initial world changes. Activate a coherent policy and state revision together; then begin Play.

Some story code may execute before the first input prompt. The product must disclose this. A request to alter an already-executed opening event needs a tested pre-start hook or supported rewind/retcon; it must not be labeled applied merely because later narration can be changed. Raw startup output can be buffered until the directive is resolved, but buffering text does not undo VM effects.

A user may choose “keep everything original” and receive a strict preservation policy. Unresolved clauses remain visible and inactive; no permissive interpretation is silently chosen.

## 7. Main loop

```text
Capture mode + user request + base revision
 -> fetch bounded state and policy context
 -> AI proposes intent and any permitted additions
 -> resolve identities, scope, authority, capability, and semantic uncertainty
 -> validate full effects, then stage in an isolated candidate state
 -> run one native/remix logical turn with bounded event processing
 -> verify postconditions and policy effects
 -> persist one combined revision or discard the candidate
 -> return a committed receipt for grounded narration
```

Every step is expanded in [turn resolution](../../architecture/turn-resolution.md). No model latency is spent holding a world-state lock. State is checked again at commit. Multi-action player instructions execute as explicit sequential subturns, with later actions reinterpreted against newly committed state.

## 8. Creative scope

AI may infer intent without permission to invent successful outcomes. Where authorized, it can create rooms, items, characters, dialogue, and bounded declarative behavior. Reusable rules combine events, predicates, and supported effects; they do not execute generated JavaScript, Python, shell commands, or arbitrary native memory writes.

Consequential invented details must enter state through a proposal. A newly mentioned unlocked exit, promise, remembered relationship, or usable tool is not mere atmospheric prose. Cosmetic phrasing can be flexible within policy but cannot silently alter affordances.

There is no general solution promised for every compiled story's hidden semantics. Unmapped critical effects return an explicit capability limitation, not fabricated success.

## 9. Safety, privacy, and reliability boundaries

Story text and model proposals are untrusted. Authentication, user approvals, mode capabilities, sandboxing, and operation budgets are enforced outside narrative text. The engine has no routine need for the host's email, financial, or unrelated filesystem tools.

Hosted operation changes the earlier local-only assumption. Story import, content sent to a model, private storage, retention, and deletion must be explained. User story files and saved adventures are not public repository fixtures. Use purpose-built or redistributable test stories.

Combined undo/restore includes native VM state, remix state, policy, RNG, input continuations, and event history. Restore must invalidate old proposals and editor leases; it cannot resurrect a past security authorization. Previously displayed spoilers cannot be removed from the user's or model's memory by rolling back engine state.

## 10. Scope, review status, and next gate

This change writes design documents, a proposed policy schema, examples, and acceptance gates only. It does not install an interpreter, create a plugin manifest, implement skills/tools, deploy services, publish the uploaded game, or claim runtime tests.

The first integrated demo must include real model-driven play and editing, a normal native turn, one persistent generated extension, an explicit allowed editor change, and verified combined restore. Deterministic component tests precede that demo but are not substitutes for it.

Review the policy semantics and algorithm before turning [roadmap gates](../../ROADMAP.md) into implementation tasks. Runtime selection, trusted approval transport, and native capability coverage remain explicit decision gates, with recommendations in [ADR-0001](../../decisions/0001-chat-first-authority.md).
