# Milestone roadmap and stop gates

**Proposed sequencing, not an approved implementation task plan.** The written design and contract decisions must be reviewed before code or deployment begins. No dates, effort estimates, completed runtime milestones, or CI passes are claimed here.

## G0: Agree on the behavioral contract

Review [design v0.2](superpowers/specs/2026-10-21-chat-first-remix-design.md), [policy](architecture/world-policy.md), [turn algorithm](architecture/turn-resolution.md), and [ADR-0001](decisions/0001-chat-first-authority.md).

Exit evidence: explicit acceptance or requested changes for policy/state separation, scoped overrides, unknown-state handling, mode controls, and native/overlay ownership. The detailed implementation plan should then be written against the accepted revision, not a moving chat summary.

## G1: Prove the two hardest integration boundaries

Run two separately scoped feasibility probes: complete VM checkpoint/restore at line and character input; and an actual intended chatbot host calling a read tool, a scoped write, and a trusted approval/import mechanism.

Use a small redistributable purpose-built story first. Select and pin the runtime/adapter after evidence, not from source-code feature names. Confirm initialization behavior, controlled randomness, invalid input handling, and whether pre-first-prompt edits can be supported. Test the private-import privacy boundary.

Stop gate: no synthetic world engine built on an interpreter with incomplete recoverability; no production editor API built on an unverified authorization claim. A desktop demo is not mobile compatibility evidence.

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
