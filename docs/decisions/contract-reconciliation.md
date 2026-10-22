# Contract reconciliation for approved Decisions 1–37

**Status:** documentation alignment proposed for review under [Issue #10](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10). This document defines how existing v0.2 contracts should be read alongside the [approved decision register](decision-register.md); it does not implement runtime behavior or select an interpreter.

## 1. Precedence and permissions

The game is faithful by default. Original authored mechanics operate normally unless an **explicit user directive** or a **user-authorized policy envelope** permits changes. Service authentication, privacy, immutable stored history, capability checks, and native adapter invariants are enforced regardless of what the fictional world says.

Separate directive classifications:
- **Assignment:** a one-time state patch that subsequent ordinary gameplay may change.
- **Invariant:** a continuing protected condition until explicitly superseded in relevant scope.
- **Permission / prohibition:** what new actions or generated effects may be proposed, where and on which trigger.
- **Preference:** narration/help/display guidance, not authority to make state changes.
- **Unresolved:** text/capability ambiguity that must remain inactive until explicitly accepted.

D01 establishes **guided partial acceptance**: produce an intelligible preview of the supported subset and ambiguous/unavailable clauses; propose interpretations of ambiguity. Commit an exact approved supported subset atomically with its initial state patch. Neither silently activate unresolved text nor discard it from the report. D02 authorizes the user to **selectively amend** protections through a human-legible change preview; the engine maintains exact superseded rule IDs and preserves unaffected scope. Don't require users to know the rule IDs.

**Conflict order:** authenticated user control and tested capabilities → active user policy / explicit protected invariants → verified original-game behavior for native-owned effects → committed world state → model interpretation or presentation. There is no unrestricted “newer sentence always wins.”

## 2. Initialization, world ownership and execution

D09 asks for the initial directive **before intentionally running native startup**. Non-executing story inspection may precede it. Some native initialization has side effects before first input; editing such an already-executed event is not a safe first-prompt patch. A verified prestart hook, full replay/retcon ability, or transparently explained poststart modification is required. Do not replace text and claim startup code never ran.

The coordinator alone stages and commits revisions. Play input is an attempted action; Editor input is a requested authorial change. D04 allows persistent /play and /edit plus one-turn /edit with a return to the preceding mode, using trusted mode authorization. Native, remix, and bridged are internal routes. D05 separates parser lack of recognition from established impossibility and from unknown. D06 applies risk-sensitive semantic review: allow defensible low-impact reversible developments under policy; escalate consequential uncertainty, never treat a model's “approved” field as authorization.

D11–D13 grant **one coherent presentation**, never two competing writers: original NPC routines, native object inventory and authored topology remain native-owned; added dialogue, knowledge, items, rooms and routes are remix-owned. Add compatible AI reactions and overlay affordances only within permitted scope. Native plot/flags/character control or original exits require exact-story tested synchronization capabilities; unsupported effects return CAPABILITY_MISSING. One tested native/overlay anchor is sufficient for the first slice.

D07 defaults to **native paused and overlay logical time advancing only on eligible committed overlay Play turns** during extension scenes. No silent catch-up, no idle-time or model-latency ticks. D16 offscreen NPC activity is policy-controlled and eligible-turn-based, not a continuously running service.

## 3. Evidence, narration, puzzles and character knowledge

D17 separates reader-visible narrated cutscenes from individual character knowledge; model-visible context is filtered to the selected authorized perspective. D18 retains exact native text/transcript/provenance even when policy allows stylistic AI enhancements; puzzle clues and directions must remain faithful. **Narration never creates usable items/exits, promises, score or puzzle success by itself.**

D19 maintains original scoring/quest flags separately from remix achievements. D20–D22 permit policy-scoped remix quests, tracking lead/offer/investigation/accepted obligation and turn-based deadlines distinctly. D23 allows creative alternative solutions to *remix-owned* puzzles only when registered mechanics can validate and commit consequences. D24 grants policy-selected deterministic/probabilistic/hybrid challenge outcomes with engine-owned recorded RNG. Original VM RNG and native scoring remain original-owned.

D25 lets the AI break a compound instruction into bounded validated subturns with independently committed receipts; pause on new choices, meaningful discoveries, failure, ambiguity or budget. Never silently complete a protected puzzle or make a promise. D26 governs progressively revealed hints under user-defined spoiler limits; help is not execution or an extra turn.

## 4. Terminal outcomes, history and persistence

D14–D15 distinguish true original-game endings or death from narrative speculation about failure. If policy permits, a remix-owned epilogue or aftermath may continue after native VM termination, but native execution is not fabricated. D08 historical retcons require dependency-aware, capability-backed branching and exact approval; **deferred** from the initial release.

D27 ensures state is independent of any model/chat: story hash, native execution checkpoint, policy lineage, remix world, clocks, NPC beliefs, branch-specific events and receipts. D28 permits multiple authorized clients to read/prepare, but publishes writes with one serialized revision/CAS boundary. A stale proposal must not be secretly re-run against a new world. Unknown runtime/storage/host mechanisms remain G1 evidence gates.

## 5. Deferred multiverse and sharing

D29–D37 form a **future extension family** rather than modifying the initial G0–G6 completion claim:
- D29 branch cherry-picking is selective and dependency-aware; never combine divergent raw VM stacks/memory.
- D30 cross-game import produces destination remix entities after dual policy and rights/privacy checks.
- D31 identities are independent copies by default; explicit move/link is capability-gated.
- D32 incompatible memories are kept with provenance; facts, speech, beliefs and feelings are not interchangeable.
- D33 sync is manual by default; event-driven only when explicitly allowed and implemented. No background sync.
- D34 destination receipt is prospective; historical backdating needs D08's tested retcon.
- D35 restoring the source does not erase previously committed destination history; flag and selectively repair invalid dependencies.
- D36 suspend/unlink prospectively, retain legitimate already-committed facts; private storage deletion remains an independent authenticated operation.
- D37 private-by-default selected-package sharing with distinct view, independent-import and narrow edit grants; recipients' copies are not the owner's live native VM.

D38 is **not** approved. No automatic publisher updates, retrospective recipient deletion, public gallery, or live distributed-world hosting may be inferred from D37.

## 6. Draft conflicts resolved by this reconciliation

| Previous document phrasing or gap | Resolution | Decision |
| --- | --- | --- |
| v0.1 browser-first / AI optional | Superseded by chat-first AI-native model with deterministic coordinator | R5, D27 |
| v0.2 says unresolved initial bundle stays uncommitted | **Unless** user approves precisely enumerated supported subset | D01 |
| v0.2 supersession requires internal IDs | IDs remain internal; user receives a natural-language scoped diff and explicit approval | D02 |
| v0.2 clock paused in extension | Keep as **default**; tested user-authorized clock alternatives allowed later | D07 |
| v0.2 general retcons deferred | Retcon concept approved, still unsupported in first playable slice | D08 |
| v0.2 does not specify end-game continuation | Add policy-controlled remix epilogue/death aftermath with true native terminal preserved | D14–D15 |
| v0.2 limited NPC simulation | Future turn-based autonomy permitted, but no wall-clock simulation | D16 |
| v0.2 does not specify native transcript augmentation | Preserve exact transcript and supplement/rewrite only with permission and clue safeguards | D18 |
| v0.2 lacks formal quest/scoring/RNG fields | New supplemental contracts / tests required; **do not pretend existing v0.2 JSON schema validates them** | D19–D26 |
| v0.2 single-session sharing assumptions | Cross-chat same-owner resumption and concurrency are core; cross-owner sharing is future | D27–D28, D37 |
| v0.2 scope says no multiplayer/cross-game | Still deferred despite approving advanced architecture | D29–D37 |

## 7. Remaining unapproved details and stop gates

G1 probes must prove a runtime with complete candidate recovery and user-bound chatbot approval/import, then select language and hosting. Future advanced features need their own specs and acceptance suites. Exact numeric budgets, policy fields, risk scores, runtime choices, software license, and service infrastructure are not approved merely by this register. Keep all proposed decisions clearly labeled; no runtime compatibility, device test, native mutation, or production authorization has been demonstrated by documentation consolidation.
