# Consolidated architectural decision register (Issue #10)

**Record date:** 2026-10-22. **Status:** Decisions **D01–D37 approved conceptually by Charles**, linked individually below; **D38 is not approved**. This document reconciles intent, not proof of implementation or a blanket acceptance of implementation details. [Issue #10](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10) holds the source approvals.

## Reading and authority

1. The user's approved initial directive and later authenticated, explicitly scoped Editor amendments govern allowed changes. Original Z-machine authored execution and the original story remain authoritative where not explicitly modified or permissibly extended.
2. Decisions D01–D37 specify **desired behavior** subject to tested capabilities, privacy, trusted authorization, complete effect checks, and reliable combined checkpointing. None grants imaginary native capabilities.
3. This register summarizes exact approval comments and must not be treated as proof that code, host features, tests, cloud services, model selection or business licensing exist. In case of summary ambiguity, read the linked decision comment and request a targeted clarification.
4. **Scope labels are delivery guidance, not a promise of release readiness.** “Core, narrow” permits only the first fixture-backed/tested subset. “Later” is an approved direction but beyond the minimal integrated demo. “Future” is outside the initial G0–G6 implementation scope unless a separately reviewed change expands it.
5. For operational details use [contract reconciliation](contract-reconciliation.md), [world policy](../architecture/world-policy.md), [turn algorithm](../architecture/turn-resolution.md), [state and native bridge](../architecture/state-and-vm-bridge.md), and [plugin contract](../architecture/plugin-contract.md).

## Approved decisions

| ID | Approved Option | Domain / delivery lane | Consolidated effect | Original approval |
| --- | --- | --- | --- | --- |
| D01 | **B: Guided partial directive acceptance** | G0/core | Approve an enumerated supported subset; unresolved clauses stay inactive. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6331497420) |
| D02 | **B: Guided scoped overrides** | G0/core | Show exact conflicts, obtain approval for minimal supersession, retain unaffected protections. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6331595836) |
| D03 | **B: Policy-controlled generation** | Core | Generation is scoped by region/type/trigger; default preserves authored content. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6331780101) |
| D04 | **B: Hybrid Play/Editor switching** | Core | Persistent /play and /edit plus one-turn /edit; no implicit promotion. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332086151) |
| D05 | **B: Evidence-aware parser limitations** | Core | Differentiate native rejection, confirmed impossibility and unknown facts. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332102212) |
| D06 | **B: Risk-sensitive semantic review** | Core | Review uncertain characterization/puzzle impacts by risk; model judgment is not proof. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332137075) |
| D07 | **B: Policy-controlled hybrid time** | Core | Native VM pauses in extension scenes by default; other clocks require tested bridges. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332218612) |
| D08 | **B: Dependency-aware retcons** | Future | Retcons require causal reconciliation, review and a verified capability; v1 uses restore/branch. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332236307) |
| D09 | **B: Preflight-first initialization** | Core | Compile initial policy before native execution; apply at earliest verified safe point. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332289658) |
| D10 | **B: Risk-based Editor approvals** | Core | Low-risk edits within valid leases may proceed; high-impact edits require exact-diff approval. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332553728) |
| D11 | **B: Hybrid native/AI character control** | Core, narrow | Native script owns native effects; allowed AI dialogue/memory cannot fabricate plot flags. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332579016) |
| D12 | **B: Unified inventory with gated cross-world effects** | Core, narrow | One user view; strict native/remix item ownership; only tested native effects. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332607926) |
| D13 | **B: Policy-controlled topology bridges** | Core, narrow | Only verified native/remix anchors; preserve protected native exits and puzzle gates. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332666578) |
| D14 | **B: Policy-controlled postgame continuation** | Later | Preserve genuine native ending; policy may continue overlay world with native halted. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6332803447) |
| D15 | **B: Recovery and aftermath after death/failure** | Later | Preserve genuine native failure; authorize branches, restores or remix aftermath. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333134580) |
| D16 | **B: Turn-based offscreen NPC autonomy** | Later | Only committed eligible turns advance supported AI-owned NPC activity. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333367125) |
| D17 | **B: Policy-controlled narrative perspective** | Core | Character knowledge differs from reader cutscenes and Editor inspection. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333414610) |
| D18 | **B: Original transcript plus optional enhancements** | Core | Archive native wording exactly; user may authorize compatible AI prose/rewrite. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333477832) |
| D19 | **B: Unified progress view, separate score owners** | Later | Native points stay native; remix milestones track separately in one view. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333655125) |
| D20 | **B: Policy-controlled interconnected quests** | Later | Remix quests may reference native events but cannot rewrite protected native progression. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333711889) |
| D21 | **B: Organic quest progression with agency** | Later | Track lead, offer, investigation and accepted promise separately. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333757548) |
| D22 | **B: Dynamic quest consequences** | Later | Policy-authorized deadlines/NPC activity use committed logical turns only. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333783394) |
| D23 | **B: Creative solutions for generated puzzles** | Later | Alternative solutions need real validated mechanics and committed effects. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333871190) |
| D24 | **B: Hybrid challenge difficulty and randomness** | Later | Engine owns validated random draws; models propose bounded difficulty. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333913928) |
| D25 | **B: Bounded interruption-aware multi-actions** | Core, narrow | Execute validated subturns; stop at surprise, failure, choice or limit. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6333945712) |
| D26 | **B: Progressive hints and spoiler limits** | Core, narrow | Policy controls hint tiers; answers do not execute actions. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334003157) |
| D27 | **B: Persistent portable branch-aware sessions** | Core | World and VM state outlive chats/models; contextual views are nonauthoritative. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334059758) |
| D28 | **B: Revision-aware concurrent clients** | Core | CAS serialized writes; stale proposals pause; branching is explicit. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334091335) |
| D29 | **B: Selective branch merging** | Future | Merge supported remix dependencies to a new branch, never blindly splice VM histories. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334113569) |
| D30 | **B: Cross-game content transfer** | Future | Explicit policy-approved destination overlay imports; no implicit native insertion. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334160802) |
| D31 | **B: Linked identity copy/move/sync policy** | Future | Independent copies by default; move/link require explicit tested contracts. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334181453) |
| D32 | **B: Provenance-aware memory reconciliation** | Future | Preserve independent historical evidence, separate beliefs from objective facts. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334224719) |
| D33 | **B: Event-driven cross-world sync** | Future | Manual by default; permitted triggers only, no background sync. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334304884) |
| D34 | **B: Causal cross-world chronology** | Future | Destination learns at sync point; history retcons need separate tested capability. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334425721) |
| D35 | **B: Divergent source rollback repair** | Future | Keep destination history, track source lineage, flag dependency impact selectively. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334456576) |
| D36 | **B: Identity-link lifecycle** | Future | Suspend/unlink prospectively, preserve legitimate history; private deletion is separate. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334498271) |
| D37 | **B: Consent-based cross-user sharing** | Future | Private by default, exact package and grants, independent imported copies. | [#10 comment](https://github.com/dhar174/zmachine_if_remix_plugin/issues/10#issuecomment-6334554269) |

## Decision families

- **Directives, mode and fidelity:** D01–D06, D09–D10. Resolve text into one-time assignments, persistent invariants, permissions, preferences and unresolved clauses; only trusted authoring changes the policy. Normal Play assertions are attempts.
- **VM and fictional-world ownership:** D07, D11–D13, D16–D18, D25. Keep the native engine real, preserve exact output, enable limited compatible AI overlay narrative, pause native clocks in extensions by default and use proven bridges for native effects.
- **Time, history, progress and play flexibility:** D08, D14–D15, D19–D24, D26. Support explicitly governed postgame/aftermath, quests, puzzles, hints and RNG where corresponding capabilities actually exist. Retcons remain future work.
- **Session integrity:** D27–D28. Combined authoritative state survives model/chat changes; serialized commits and stale-revision handling prevent accidental double actions or conflicting writes.
- **Future multiverse and sharing:** D29–D37. Selective merges, cross-game imports, identity links, sync, chronology, rollback and cross-user sharing are **approved architectural aspirations**, not delivered capabilities. Sharing is private by default; native histories cannot be spliced and private data deletion is not a fictional retcon.

## Preserved defaults and precise distinctions

- **Original fidelity:** preserve authored progression, not a frozen opening snapshot. Unsupported native operations cannot be claimed successful in prose.
- **Play vs Editor:** Play speech and efforts do not automatically alter history or grant Editor permission. Native/remix/bridged are execution routes, not input modes.
- **Policy vs state:** “give me a key” assigns it once; “always keep that key” is an ongoing invariant; “you may create new keys” is permission; a writing preference does not mutate state.
- **Reader vs character:** offscreen knowledge and authorized cutscenes are not automatically known to the player character or other NPCs.
- **Narration vs receipt:** generated narration may enhance tone, but consequential new facts require validated committed effects.
- **Restore vs retcon vs merge:** restoring creates a new branch generation; a historical rewrite needs verified causal dependencies; merging distinct branches or games is not copying raw VM state.
- **Control vs capability:** authorial approval is necessary but not sufficient to alter unsupported native semantics. Service authentication and privacy cannot be overridden by fictional Editor commands.

## Unapproved and evidence-dependent

**D38: Versioned shared-package updates and revocation** was presented with A/B/C options but not approved. It remains **open / deferred**, not implicitly Option B. Stop the sequential decision exercise at D37 pending any future explicit request.

**G1 evidence decisions remain open:** interpreter/runtime and adapter (a D39 proposal now exists from #12, below); runtime language; hosted versus private service; real host tool/attachment support; trusted user-bound approval mechanism; portability/device compatibility. [G1 probe briefs](../superpowers/plans/) specify how to evaluate them rather than choosing from speculation.

**D39 (PROPOSED, evidence-gated — not owner-approved): ifvms.js ZVM as the G1-B checkpoint-capable probe candidate, with a proposed minimum adapter boundary.** Recorded 2026-10-23 from Issue #12's probe ([g1-vm-recovery evidence](../evidence/g1-vm-recovery.md)); updated same day after independent review: capture/validate/restore/continue of a live interpreter at line, character and halted boundaries into a fresh process with transcript + machine-state fingerprint equality, and candidate isolation including pre-publication kills; candidate execution failures now exit nonzero; Bocfel 2.6's own autosave route failed its character-boundary restore and serializes no random-mode RNG state. Proposed minimum adapter contract: capture only at supported boundary kinds **and only in seeded RNG mode (unseeded capture/restore rejected — `E_RNG` — per bridge §8)**; a data-only, identity-bound, digest-verified envelope validated — including nested I/O, window, and read-continuation state — before any interpreter is constructed (plus the VM-level Quetzal IFhd gate); fresh-process restore re-applying interpreter-owned header state, RNG (after `update_header`), pending input, and the published transcript; killable candidate processes with deadlines, output limits, and nonzero exits on every failure mode; a declared-unsupported surface (timed input, sound, graphics, Glk file streams, undo history, interpreter number/version header fields, unseeded RNG). **This record proposes; it does not approve.** Production adoption still requires the #18/#21 durable commit/receipt half, the remaining open G1 decisions above, and explicit owner acceptance of D39.

**G1-C recommendation (PROPOSED, not owner-approved):** Issue #13's isolated [chat-host probe](../evidence/g1-chat-host.md) demonstrates local/protocol controls and bounded actual authenticated ChatGPT web/Classic reads, separately personally approved reversible edits, receipt recovery, private external fixture-byte import and process recovery through the owner-authorized private Secure MCP Tunnel and Auth0 setup. Web Work additionally invoked one installed standalone cloud workflow skill with successful tool reads; native desktop Work passed state/receipt reads but did not discover that skill. Recommend retaining Streamable HTTP, a separately authenticated exact-diff approval page and the explicitly disclosed external upload fallback for further authorized trials. Native attachment-to-service import remains BLOCKED: attachment acceptance did not establish a valid file object or received bytes, and the CLI's origin gate remains closed. Full host schemas, native Work writes/approval/import, real second-principal denial, Android, workspace type and enforced independent review remain unqualified as specified in the evidence. This does not select a production language/hosting/budget, amend D38/D39, satisfy full product acceptance, or authorize a later issue.

**Additional design specifics not approved:** numeric budgets; exact model/provider, prompt schemas, risk thresholds, code layout; uninterrupted real-time autonomy; arbitrary native NPC takeover; generalized retcons; automatic sharing or continuous sync. Explicit capability and review gates remain binding.

## Requirements traceability

| User-stated requirement | Grounding |
| --- | --- |
| R1: Original content faithful by default | D02–D03, D05–D07, D09, D11–D13, D17–D18 |
| R2: Initial world directive | D01–D03, D06–D10, D17–D18, D24, D26 |
| R3: Play and Editor control planes | D02, D04, D10, D25 |
| R4: Durable explicit direction and added-world state | D02–D03, D08, D12–D13, D16, D27–D28 |
| R5: AI-first, chat-based interface | D03–D06, D11, D16–D18, D23–D26, D27 |
| R6: Real committed state, not narrative-only change | D05–D08, D11–D13, D18–D25, D27–D28 |

**Approval boundary:** The 37 choices were approved through linked conversation comments, but implementation, deployment, merges, G1 technology selection and tests still require separate gates. Do not close #10 until the consolidated documentation PR has been reviewed and the unresolved feasibility decisions are routed to G1.
