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

**D39 (PROPOSED, evidence-gated, owner-unapproved).** Retain the pinned ifvms.js
ZVM as the conditional G1-B checkpoint candidate. The proposal originated in
PR #37 on 2026-10-23. Its current basis is the independently passing seeded
fixture suite, including whole-envelope recapture, chained-child continuation,
and candidate discard and publication controls. See the
[current evidence baseline](../evidence/g1-vm-recovery.md#current-evidence-baseline-2026-11-08)
and [acceptance mapping](../evidence/g1-vm-recovery.md#9-acceptance-mapping).

The proposed minimum adapter boundary is seeded pending line, pending character
and halted state. Validate the v2 envelope's story/build/host identity, shape,
unkeyed checksum and local capabilities before VM construction. On the fresh
VM, check saved versus live topology after startup and after native restore,
and enforce Quetzal identity during native restore. Reapply the supported
header state, RNG, pending request and transcript before readiness. Bound
transport, track runner failures and child termination, and keep speculative
output private until the candidate meets the publication requirements. The
fixture harness demonstrates the eligibility check and a simulated parent
publication operation.

Reject unseeded capture/restore with `E_RNG`, nonzero timed-input operands with
`E_TIMED_INPUT`, and unsupported memory-output stacks, redirected input or
file-backed stream state with `E_STRUCTURE`. Sound, graphics, Glk file streams,
undo history and interpreter number/version fields remain declared unsupported.
Cache-dependent continuation and headless window results are qualified only
for the cases in the evidence. A seeded snapshot's continuation and replay of
the turn that produced it are separate properties.

The [Bocfel 2.6 reference](../evidence/bocfel-autosave-2026-11-08/README.md)
passes seeded line and conforming `read_char 1` restoration, each 3/3. The
canonical zero-operand case fails separately. Random mode has no saved Rand
or `-Z` file cursor. This comparison supplies its own bounded evidence.

**D39 checkpoint clarification (Issue #42):** Timed input remains unsupported. The experimental checkpoint rejects either nonzero `read_data.time` or `read_data.routine` at capture and restore with `E_TIMED_INPUT`; absent or zero fields are allowed, and malformed fields fail `E_STRUCTURE`. This does not intercept timed opcodes during execution or reconstruct clocks. D39 remains proposed and owner-unapproved.

**D39 checkpoint clarification (Issue #43):** The experimental v2 envelope
binds semantic metadata and payload in an unkeyed checksum, verifies the local
story/runtime/adapter build and host identity before VM creation, and checks
capability claims against the implementation. V1 is rejected; no migration,
authentication, or cross-build portability is claimed. See the
[G1-B evidence](../evidence/g1-vm-recovery.md#3-checkpoint-envelope-and-restore-mechanism)
for the precise coverage and limits. D39 remains proposed and owner-unapproved.

**D39 RNG qualification (Issue #46):** Restart returns to unseeded RNG;
capture rejects with `E_RNG`. A nonzero seed at a later boundary does not prove
replay of the preceding turn: controlled test children execute a real host
draw and then reseed, producing different retained output/memory at the same
final seed. Each final snapshot recovers its own seeded suffix; that does not
reproduce the earlier entropy draw. Publication remains conditional on the
complete recovery contract, with only fixture-allowlisted parent-side test
evidence here. No generic entropy detector, broader startup support, runtime
policy change, or production coordinator is implemented. Controlled/recorded
host entropy before startup and across restart/mid-turn execution requires a
separate evidence/owner gate; durable publication remains #18/#21. See the
[qualification evidence](../evidence/g1-vm-recovery.md#issue-46-rng-qualification).
D39 remains proposed and owner-unapproved.

**D39 cache/window qualification (Issue #47):** Startup-derived caches are
not all rebuilt from checkpoint memory. Immutable code/text and a mutable
abbreviation target control recover; mutable custom-dictionary history and
self-modifying dynamic-code stress can diverge despite equal envelopes.
Alphabet/Unicode lookup tables can remain stale in both source and restored
runs. Those dependency histories remain unsupported, not generally detected;
arbitrary-story adapter work belongs to #20/#21. Narrow `E_WINDOW_TOPOLOGY`
guards reject unsupported saved/live role relations and saved/fresh window
presence mismatches before restored input/readiness (fresh-start checks occur
after VM construction). No cache repair, general window recreation, geometry
qualification or schema migration is added. V2 source-build identity changes
require fresh captures. See the [qualification inventory](../evidence/g1-vm-recovery.md#issue-47-cache-and-window-qualification).
D39 remains proposed and owner-unapproved; #12/#40 remain open.

**D39 interruption qualification (Issue #48):** Acknowledged barriers in a
separate test child replace timing-dependent kill claims. Real fixture mutation
and checkpoint capture run unchanged; a deliberately chunked test writer proves
a specific partial file, which the ordinary runner rejects. This is not
interruption inside synchronous VM capture or the runner's `writeFileSync()`.
Private child output can already be buffered by the parent without being
published. A killed finished candidate, an invalid final envelope, and parent
cancellation after clean child exit publish nothing; a positive fixture-scoped
control exercises the same test gate. A15/A28 evidence remains candidate-process/
test-harness only. A29 durable commit/receipt retry remains #18/#21, resource and
sandbox work is not started here, and D39 remains proposed and owner-unapproved.
See the [phase evidence](../evidence/g1-vm-recovery.md#issue-48-deterministic-interruption-qualification).

**D39 transport clarification (Issue #49):** The experimental runner now bounds
file/JSON input, request framing and response emission; parent collectors bound
private stdout/stderr and reject transport failures independently of a numeric
zero exit. An oversized step is omitted, not included in its limit diagnostic.
These checks occur outside the synchronous VM and can follow temporary JSON
allocation; they do not establish OS isolation, arbitrary-story/private-import
safety, CPU/memory/IO quotas, rate limits or durable commit/receipt recovery.
Those production obligations remain #30, #22 and #18/#21 respectively. The
[exact limits, acceptance evidence and retained risks](../evidence/g1-vm-recovery.md#issue-49-probe-transport-limits)
qualify only the trusted-fixture probe. V2 layout is unchanged, but changed
runner/transport source identity requires fresh captures (`E_RUNTIME` for prior
builds). D39 remains proposed and owner-unapproved; #12/#40 remain open.

### D39 owner review checklist

- [ ] Confirm the proposed fixture and build scope: the Z5 fixture digest and
  pinned ifvms revision, runtime source build and checkpoint adapter build in
  the [evidence baseline](../evidence/g1-vm-recovery.md#current-evidence-baseline-2026-11-08).
- [ ] Review the proposed minimum adapter boundary, the
  [six acceptance dispositions](../evidence/g1-vm-recovery.md#9-acceptance-mapping),
  and the supported, explicitly rejected, declared unsupported and unqualified
  cases. In particular, review seeded continuation versus earlier turn replay,
  and test publication versus durable recovery.
- [ ] Review the open production obligations: #18/#21 own durable commit,
  orphan collection and receipt retry; #20/#21 own native compatibility and
  combined restoration; #22 owns private import; #30 owns production
  sandboxing, quotas and rate limits. The G1 roadmap still governs any
  authorization to start #14.
- [ ] Record the owner's explicit decision to accept this bounded candidate,
  request a revised proposal, or defer selection. Record any later-phase
  authorization separately. #12 and #40 remain open pending their own gates.

### Other G1 decisions

**G1-C recommendation (historical, superseded by the bounded dispositions below):** Issue #13's isolated [chat-host probe](../evidence/g1-chat-host.md) demonstrates local/protocol controls and bounded actual authenticated ChatGPT web/Classic reads, separately personally approved reversible edits, receipt recovery, private external fixture-byte import and process recovery through the owner-authorized private Secure MCP Tunnel and Auth0 setup. Web Work additionally invoked one installed standalone cloud workflow skill with successful tool reads; native desktop Work passed state/receipt reads but did not discover that skill. Recommend retaining Streamable HTTP, a separately authenticated exact-diff approval page and the explicitly disclosed external upload fallback for further authorized trials. Native attachment-to-service import remains BLOCKED: attachment acceptance did not establish a valid file object or received bytes, and the CLI's origin gate remains closed. Full host schemas, native Work writes/approval/import, real second-principal denial, Android, workspace type and enforced independent review remain unqualified as specified in the evidence. This does not select a production language/hosting/budget, amend D38/D39, satisfy full product acceptance, or authorize a later issue.

**G1-C owner acceptance (2026-11-06):** The owner accepted G1-C for the documented synthetic web Chat and Classic desktop Chat route, including the disclosed external fixture upload and separate exact-diff approval, with the retained limits. The [owner decision](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13#issuecomment-6693577279) resolves R5; Issue #13 was closed as completed. The [acceptance audit](../evidence/g1-chat-host-acceptance-audit.md) records R1 as an owner-accepted limit on full host definitions; R2 as real second-identity denial at service entry, not two-allowed-principal object authorization; R3 as the observed Personal workspace route; and R4 as the approved bounded route. See the [bounded closeout](../evidence/g1-chat-host-closeout.md) for criterion mapping and retained limits. Native attachment-to-service import remains blocked and disabled. This acceptance does not establish product readiness, approve D39, start #14, qualify broader clients or authorize restarting the service. Production hosting, language and budget remain undecided. Prior probe shutdown observations are historical; no fresh shutdown check is asserted here.

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
