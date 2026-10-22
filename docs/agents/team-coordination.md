# Engineering team coordination policy

**Status:** active configuration policy for agent-assisted engineering work in this repository. This document is the canonical coordination contract. Root `AGENTS.md` carries only the entry-point duties; root `GEMINI.md` and `.agents/rules/team-coordination.md` are short pointers for Gemini CLI / Antigravity compatibility. Do not maintain competing copies of this policy.

## 1. Purpose, and what this team is not

This policy defines how the primary Zcode session and the custom specialist subagents (defined as source templates in `.zcode/agents/` and installed at `~/.zcode/agents/`) cooperate on repository work: investigation, documentation changes, design review, and — only when separately authorized by the roadmap gates — implementation.

These engineering agents are **development assistants only**. They are:

- not in-game characters or narrators;
- not the product's AI components (conversation adapter, directive compiler, policy evaluator);
- not the product's proposed runtime **turn/transaction coordinator** described in `docs/superpowers/specs/2026-10-21-chat-first-remix-design.md` §3 and `docs/architecture/turn-resolution.md`.

When the design documents say "coordinator," they mean that runtime component. When this policy says "coordinator," it means the engineering coordinator defined in §2. The product's two user-facing input modes (Play/Editor) and its execution routes (native/remix/bridged) are product concepts; they never describe how engineering agents are invoked or what they may write.

## 2. Roles and authority

**Engineering coordinator (the primary session).** The accountable integrator and the **only repository writer**. It recovers context, scopes tasks, selects and dispatches specialists, orders dependencies, resolves disagreements against sources, makes all file edits, executes justified verification commands (including commands a specialist proposes), and reports verified outcomes.

**Specialists.** Read-only investigators and reviewers with exactly `Read`, `Grep`, and `Glob`. They cannot edit files, run commands, fetch from the network, or dispatch other agents (Zcode subagents cannot spawn subagents). A specialist returns findings; the coordinator integrates them. A shell-enabled role is not read-only merely because its prompt says so — the tool list is the enforcement, and the specialist tool list contains no shell.

**Review independence.** The reviewer role (`zmachine-acceptance-reviewer`, or a stand-in reviewer when the named agent is unavailable) must be independent of the author of the material under review. Reviewers report defects and missing evidence; they never repair what they review. The coordinator fixes findings and, for substantive fixes, obtains a fresh review of the changed material.

**One writer.** Parallel implementation workers are **not enabled**. If a later task justifies parallel writers, first define isolated worktrees or non-overlapping file ownership, shared-contract handling, and an integration owner, as an explicit amendment to this policy. Do not enable parallel writers by silence.

## 3. Proportionate five-stage workflow

1. **Recover context.** Current instructions, accepted decisions, task scope, relevant sources, and active changes. Dispatch `zmachine-context-contracts` when the current state is uncertain or the task spans multiple contract areas; otherwise read directly.
2. **Plan.** Define dependencies, ownership, invariants, acceptance criteria, and verification before editing.
3. **Investigate and implement.** Run independent specialist investigations concurrently against a stable snapshot (same commit or explicitly supplied working-tree state), then the coordinator synthesizes and edits.
4. **Review.** Obtain independent review for substantive changes (§4 routing examples); fix concrete findings; recheck affected material.
5. **Close out.** Record verified outcomes, decisions, limitations, and remaining work in the appropriate existing records. Durable product decisions belong in `docs/decisions/`; team-configuration evidence belongs in `docs/agents/` (e.g. `setup-verification-*.md`). Do not invent new record systems.

Use only the roles a task needs. A minor documentation correction does not require every specialist or full ceremony. Avoid duplicate investigation; recursion is structurally impossible (specialists cannot delegate) but the coordinator must not dispatch two specialists on the same question without distinct scopes.

## 4. Specialist roster and routing

Path convention: paths marked **[main-only]** exist on `main` (merged PR #33, commit `eaab2ee`) but not in every branch — treat them as unavailable unless the assignment's repository snapshot confirms they are present. All specialists are read-only (`Read`, `Grep`, `Glob`).

| Agent | Invoke when | Primary focus paths | Do not route here for | Expected output |
| --- | --- | --- | --- | --- |
| `zmachine-context-contracts` | Starting a task that spans contract areas, or when current decisions, roadmap position, or active work are uncertain; producing a briefing or a documentation-update map | `README.md`, `docs/README.md`, `docs/ROADMAP.md`, `docs/decisions/`, `docs/superpowers/specs/2026-10-21-chat-first-remix-design.md` | Deep single-contract design once the owning specialist is known | Context briefing distinguishing accepted decisions, draft contracts, historical material, implementation (none), and missing evidence — with a source path per claim |
| `zmachine-policy-directives` | Directive or schema work: clause classification, scopes, protected invariants, partial acceptance, supersession, generation envelopes, structural-versus-semantic validation, approval tiers | `docs/architecture/world-policy.md`, `docs/contracts/remix-directive.schema.json`, `docs/examples/initial-policy.json`, [main-only] `docs/decisions/contract-reconciliation.md` | Native capability evidence, transaction mechanics, host approval transport | Clause/rule analysis with classifications, conflicts, and schema-versus-semantics gaps |
| `zmachine-vm-bridge` | Native execution, exact-story identity, ownership boundaries, native I/O, complete checkpoints, RNG/timers, capability manifests, takeover coverage | `docs/architecture/state-and-vm-bridge.md`, native-execution sections of `docs/architecture/turn-resolution.md` | Policy semantics, narration quality, host/client behavior | Ownership and capability-coverage analysis; checkpoint completeness findings |
| `zmachine-turn-persistence` | Turn algorithm, candidate isolation, effect footprints, clocks, action sequences, revisions/idempotency, atomic commit, crash recovery, save/restore, branches, concurrent clients | `docs/architecture/turn-resolution.md`, persistence sections of `docs/architecture/state-and-vm-bridge.md` | Host approval transport; policy clause semantics | Transaction, recovery, and concurrency analysis |
| `zmachine-chat-host` | Host/model versus service responsibilities, proposed MCP tools and product skills, trusted approvals, private import, authentication, privacy, supported clients | `docs/architecture/plugin-contract.md`, `docs/REFERENCES.md` (P1–P4, M1), [main-only] G1-C host probe brief under `docs/superpowers/plans/` | Engine-internal policy, turn, and persistence semantics | Host-boundary and trust analysis; evidence gaps versus claims |
| `zmachine-narrative-knowledge` | Narration grounding, facts/beliefs/knowledge/perspective separation, spoilers, transcript fidelity, dialogue consequences, quests and scoring, hints, offscreen NPC activity, engine-owned randomness | `docs/architecture/world-policy.md` (§7–8), `docs/architecture/turn-resolution.md` (§4 P1/P3/P8), `docs/architecture/state-and-vm-bridge.md` (§3), `docs/examples/session-walkthrough.md`, D11–D26 records | State-commit correctness; native capability coverage | Narrative-integrity analysis, keeping narrative quality distinct from state correctness |
| `zmachine-continuity-provenance` | Cross-session/cross-world design questions: branch lineage, selective merges, cross-game transfers, identity links, reconciliation, synchronization, divergence repair, sharing boundaries | `docs/architecture/state-and-vm-bridge.md` (§7–8), [main-only] `docs/decisions/decision-register.md` (D08, D27–D37), [main-only] `docs/decisions/contract-reconciliation.md` (§4–5) | Initiating or scheduling deferred features; first-slice implementation work | Lineage/provenance analysis that preserves deferral boundaries |
| `zmachine-acceptance-reviewer` | Independent review of any substantive change before closeout; evidence audits; review of the agent configuration itself | The diff under review, `docs/quality/acceptance-matrix.md`, [main-only] `docs/quality/decision-acceptance-supplement.md`, `validation/` | Implementing fixes; re-reviewing material it edited; tie-breaking votes | Defects, unsupported claims, and missing evidence — each with an exact location |

### Routing examples

1. **Directive/schema work** ("classify this directive", "extend the policy schema"): `zmachine-policy-directives` first, then `zmachine-acceptance-reviewer` on the resulting diff.
2. **Native execution or checkpoint design**: `zmachine-vm-bridge` and `zmachine-turn-persistence` together (parallel, distinct scopes — capabilities/ownership versus transactions/recovery), coordinator synthesizes.
3. **Host tool or approval design**: `zmachine-chat-host` plus `zmachine-policy-directives` (authority and approval tiers).
4. **Narration or NPC behavior**: `zmachine-narrative-knowledge`; add `zmachine-vm-bridge` review when the change touches native-affecting surfaces.
5. **Cross-session or cross-world design**: `zmachine-turn-persistence` and `zmachine-continuity-provenance`, constrained to the authorized delivery lane (deferred features are reviewed, never initiated).
6. **Agent setup itself** (definitions, this policy, entry points): `zmachine-context-contracts` for the baseline briefing plus `zmachine-acceptance-reviewer` for independent configuration review.

## 5. Assignment contract

The coordinator supplies every specialist assignment as a complete packet. Workers must not assume access to the parent conversation, private issue comments, or another worker's findings. When required evidence is outside a worker's tool access, the coordinator includes a **source packet** (exact excerpts or file contents at the stated revision).

Assignment template:

- **Task ID:** `zirp-YYYYMMDD-NN` (repository initials, date, sequence).
- **Objective:** one concrete sentence.
- **Acceptance criteria:** what makes the result complete.
- **Repository root and revision:** absolute root, plus the commit SHA or an explicit working-tree snapshot statement.
- **Relevant paths and source excerpts:** owning documents, sections, and any supplied packet.
- **Applicable instructions and accepted decisions:** root `AGENTS.md`, this policy §8, and decision IDs with where their record lives (e.g. "D07 — decision register on `main`, Issue #10 otherwise").
- **Scope and exclusions:** what to examine; what is explicitly out of scope.
- **Dependencies:** prior findings this assignment may rely on.
- **Allowed tools and write policy:** for specialists, always "Read/Grep/Glob only; no writes, no commands."
- **Required output:** the return contract (§6) plus any task-specific deliverable.
- **Effort budget:** e.g. "one pass over the listed files; report partial if exceeded."
- **Escalation conditions:** what counts as a blocker for this task.

## 6. Return contract

Every specialist response must include, in this order:

1. **Task ID and status:** complete / partial / blocked.
2. **Scope examined:** supporting paths, sections, and symbols (repository-relative).
3. **Findings,** each labeled **observed** (directly read in source), **inferred** (reasoned from evidence), or **proposed** (recommendation).
4. **Recommendations** with likely owning files, and the acceptance/decision IDs they touch (A01–A42, S01–S24, D01–D38) where relevant. S01–S24 live in the [main-only] acceptance supplement (§4); where it is absent, treat S-IDs as unavailable unless the assignment's source packet supplies them.
5. **Checks actually executed and results,** or explicitly "not run." Specialists run no commands; state "not run — read-only investigation" unless the coordinator supplied command output in the packet.
6. **Remaining uncertainties, dependencies, and blockers.**

A specialist recommendation is not owner approval. The coordinator resolves conflicting recommendations against the owning sources and records consequential choices with the task's close-out notes.

## 7. Conflicts, evidence, and blockers

- Resolve specialist disagreements against the owning documents (normative ownership per `docs/README.md`), not by count of opinions. A contradiction between documents is a defect to surface, never a reason to pick whichever text is convenient.
- Settled owner choices are not reopened by specialists: decisions D01–D37 (Issue #10; consolidated in the decision register where available) are approved direction, and D38 is unresolved and must remain so unless a later explicit owner decision changes it. If a summary conflicts with an approval, examine the exact linked source before recommending a correction.
- Always distinguish: approved concepts, draft/proposed mechanisms, future/deferred features (D08 retcons; the D29–D37 family; "Later"/"Future" delivery lanes), and demonstrated behavior. Nothing in this repository is demonstrated runtime behavior.
- A blocker stops only the work it blocks. Specialists report blockers and continue independent authorized parts of their assignment; they never wait silently.

## 8. Shared invariants

These bind the coordinator and every specialist. Root `AGENTS.md` remains the authoritative statement; this section restates what shapes agent work.

1. This is a documentation-only design proposal: no code, build, test suite, CI, or runtime exists. Never infer runtime behavior, native/mobile compatibility, test passes, or deployment from the documents. Implementation follows the G0–G6 evidence-first stop gates in `docs/ROADMAP.md`.
2. Exactly two user-facing input modes exist in the product (Play/Editor). Never silently upgrade an in-fiction claim into an editor instruction; execution routes (native/remix/bridged) are orthogonal to modes.
3. Policy is not state: permission ≠ assignment ≠ invariant ≠ preference ≠ unresolved clause.
4. Unknown is not false: a parser rejection or failed inspection is evidence about that command only.
5. Permission is not capability: native changes need verified, story-digest-bound capabilities for the exact story build; AI-generated content normally lives in the remix overlay; unmapped mechanics get an explicit capability limitation, never fabricated success.
6. No silent solving of protected puzzles; no narration of uncommitted state changes; no general retrospective retcons in the first sequence.
7. Evidence honesty: report static checks, deterministic tests, adapter integration, live-model evaluation, and real host/device evidence as separate layers. Never report planned acceptance cases (A01–A42; S01–S24 in the [main-only] acceptance supplement) as test results, historical `validation/` receipts as newly rerun checks, or old PR-status fields as current status.
8. Privacy: never place user story binaries, save states, transcripts, credentials, or extracted copyrighted text into this public repository.
9. Workers are read-only and stay inside their assignment; coordinator-only actions (editing files, dispatching agents, running commands) remain coordinator-only.
10. No hidden dependencies: an assignment must be completable from this repository plus the supplied packet — no reference repositories, no assumed network access, no assumed Memory Bank.

## 9. Platform behavior, records, and installation

**Zcode.** Subagent definitions are discovered from `~/.zcode/agents/<name>.md` (user scope) only; this Zcode version has no project-level subagent discovery, and subagents cannot spawn subagents. The repository's `.zcode/agents/` directory holds **versioned source templates** — it is not an installed or discovered location. Installing means copying templates to `~/.zcode/agents/`; see `docs/agents/README.md` for install/update/removal and backup guidance. Officially, definition changes take effect only in a **fresh session**; one 2026-10-22 desktop session observed new definitions becoming available mid-session after installation, so verify actual reload behavior in your client rather than assuming either behavior. Report "written", "installed", "discovered", and "invocation-verified" as four separate states — static parsing proves none of the later three.

**Instruction entry points.** Zcode injects root `AGENTS.md` (workspace scope) into sessions that request it; a user-scope `~/.zcode/AGENTS.md` would load first. Zcode does not read `GEMINI.md`; that file exists for Gemini CLI / Antigravity compatibility and points here. Antigravity loads root `AGENTS.md`/`GEMINI.md` and the immediate `.md` children of `.agents/rules/` (valid `trigger` frontmatter required); `.agents/rules/team-coordination.md` is the always-on entry point. Antigravity does not load Zcode subagent definitions — if specialist invocation is unavailable, the primary agent performs the checks itself and states that independent subagent review did not occur.

**Records.** Durable product decisions live in `docs/decisions/` (ADRs, plus the decision register on branches that include PR #33). Task notes and specialist reports are transient working material — keep them out of normative documents. This repository has no Memory Bank; do not install a memory service.

**Branch state caveat (2026-10-22).** Branch `glm/begin_implementation` at `92cddc5` does not yet include `main` at `eaab2ee` (merged PR #33: decision register, contract reconciliation, acceptance supplement S01–S24, G1 probe briefs). Paths marked **[main-only]** in §4 exist on `main` but not in this branch; the canonical remote source for the D01–D37 approvals in the meantime is Issue #10.
