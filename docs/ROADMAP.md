# Milestone roadmap and stop gates

**Milestone sequence and evidence gates.** Each implementation or deployment assignment requires separate authorization. Current feasibility evidence and decisions are linked below.

## G0: Agree on the behavioral contract

Review [design v0.2](superpowers/specs/2026-10-21-chat-first-remix-design.md), [policy](architecture/world-policy.md), [turn algorithm](architecture/turn-resolution.md), and [ADR-0001](decisions/0001-chat-first-authority.md).

Exit evidence: explicit acceptance or requested changes for policy/state separation, scoped overrides, unknown-state handling, mode controls, and native/overlay ownership. The detailed implementation plan should then be written against the accepted revision, not a moving chat summary.

## G1: Prove the two hardest integration boundaries

Qualify native I/O and checkpoint recovery in separate fixture probes. Verify the host boundary with actual read, scoped write, trusted approval and private fixture import evidence.

Use a small redistributable purpose-built story first. Select and pin the runtime/adapter after evidence, not from source-code feature names. Confirm initialization behavior, controlled randomness, invalid input handling, and whether pre-first-prompt edits can be supported. Test the private-import privacy boundary.

Stop gate: production native execution requires complete, verified recovery for its supported boundaries and effects. Privileged Editor operations require verified authorization. Mobile compatibility requires separate device evidence.

### G1 closeout status (2026-11-09)

- **G1-A [#11](https://github.com/dhar174/zmachine_if_remix_plugin/issues/11):** Closed as completed on November 10, 2026, after the owner accepted the [fixture and comparative native I/O evidence](evidence/g1-native-io.md) at its documented scope. [G1-A closeout](https://github.com/dhar174/zmachine_if_remix_plugin/issues/11#issuecomment-6773294196).
- **G1-B [#12](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12) / [#40](https://github.com/dhar174/zmachine_if_remix_plugin/issues/40):** Both issues closed as completed on November 10, 2026, after the owner accepted the bounded G1-B evidence. All twelve follow-up children are closed. The [acceptance mapping](evidence/g1-vm-recovery.md#9-acceptance-mapping) records fixture results, explicit exclusions and downstream production obligations. The November 9 owner approval of [D39](decisions/decision-register.md#d39-owner-decision) covers the documented seeded Z5 fixture only. [follow-up closeout](https://github.com/dhar174/zmachine_if_remix_plugin/issues/40#issuecomment-6773296141) · [G1-B closeout](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12#issuecomment-6773298207).
- **G1-C [#13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13):** Closed after the November 6 [bounded owner acceptance](evidence/g1-chat-host-closeout.md) of the synthetic web and Classic desktop Chat route, external fixture upload and separate exact-diff approval. The closeout records the limits on host and device coverage.

G0 [#3](https://github.com/dhar174/zmachine_if_remix_plugin/issues/3) and G1 [#4](https://github.com/dhar174/zmachine_if_remix_plugin/issues/4) remain open. G2 entry still requires acceptance of the remaining G0/G1 dispositions, owner decisions on production runtime, language and deployment boundaries, and separate authorization to start [#14](https://github.com/dhar174/zmachine_if_remix_plugin/issues/14).

## G2: Policy and transactional kernel with live AI contract feedback

Implement validated policy documents, source mappings, mode/session revisions, capabilities, idempotency, candidate staging, receipts, and a small fixture world. Exercise a real host model compiling an initial directive and an editor change against this kernel. Deterministic fixtures test bad proposals; live runs test actual skill/tool selection.

Exit evidence: assignment/invariant distinctions, conflicting rules, explicit supersession, forged permissions, stale proposals, retry safety, and atomic policy-plus-state changes satisfy the relevant acceptance cases. No story-specific mutation is claimed yet.

## G3: Faithful native play and combined persistence

Wire the selected VM into the coordinator. Establish a known original-game transcript and checksums at input boundaries. Route natural-language actions through grounded native commands without fabricated parser success. Preserve line versus character input semantics.

Exit evidence: native actions, legitimate failed attempts, safe inspection, combined snapshots, crash recovery, branch restore, and RNG reconstruction. Initial policy cannot silently alter already-executed opening events.

## G4: First complete AI remix slice

Use an explicitly approved expansion region/anchor. Generate and persist one location, one character, dialogue events, and a small bounded behavior rule. Enter, interact, leave, return, and restore the session. Include a genuine Editor change and a rejected overreach.

Exit evidence: live chatbot use across the entire loop; no separate mandatory terminal; no generated state existing only in prose; generation respects geography, trigger rules, personality protection, and puzzle gates. This is the first integrated product demonstration, not an AI-free player awaiting later intelligence.

## G5: Narrow native editing bridge

Add one story-hash-bound, tested native mutation and its complete effect contract. Verify native observable consequences and recovery. Expand only after evidence. Teleportation, personality takeover, and progression rewrites are separate capabilities rather than free consequences of object access.

Exit evidence: same-owner consistency, adapter digest checks, dependency-aware effects, protected edits, and no narrative/native disagreement. Publish the capability limits clearly.

## G6: Hardening and release decision

Complete user-private import/export, authorization, quotas, bounded rules, malformed-story isolation, context retrieval, branch visibility, mobile host checks, and live-model adversarial evaluation. Audit packaging, upstream licenses, and rights to all fixtures before any public release.

Exit evidence: versioned release artifacts, declared supported stories/capabilities/hosts, reproducible engine tests, separately recorded live-model evaluations, and no private user content in the repository.

## Deferred scope

Universal source reconstruction, arbitrary generated runtime code, fully synchronized offscreen native simulation, unlimited retcons, multiplayer, autonomous real-time worlds, public story hosting, voice, and a full visual editor are outside this first sequence. They require new design and tests rather than silent scope expansion.

## Reconciliation status after Decision 37 (2026-10-22)

G0 design choices D01–D37 have been approved conceptually and consolidated in the [decision register](decisions/decision-register.md). See the [contract reconciliation](decisions/contract-reconciliation.md) for their meaning, precedence, and scope. **D38 is pending**, and no new open-ended decision marathon is required before proceeding with review.

The G1 feasibility probes are independently reviewable:
- [#11: native fixture/I/O](superpowers/plans/2026-10-22-g1-a-native-io-probe.md)
- [#12: complete VM checkpoint](superpowers/plans/2026-10-22-g1-b-checkpoint-probe.md)
- [#13: real chatbot host, user approval and private import](superpowers/plans/2026-10-22-g1-c-chat-host-probe.md)

**First playable G0–G6 vertical slice remains narrow:** real original VM execution, compiled initial directive and mode separation, guided Edit approval, controlled generated world entity/rule, one tested native/extension anchor, faithful transcript/AI narration, transactional saves and live model use. Choices D14–D26 set policy/extension behavior but do not automatically add full ending/quest/autonomy/puzzle/RPG implementations to this slice. D29–D37 (branch merge, cross-game identity and cross-user sharing) are expressly future initiatives requiring separate specs/issues/acceptance, not gate G6 release. D38 is not user-approved.

All previously listed gates still apply; do not treat a decision summary as proof of actual VM checkpoint coverage, trust-bound host approval, native editing, mobile device behavior, or live-model quality.
