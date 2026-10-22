# Issue #11 (G1-A): Z-machine fixture + native I/O probe — implementation plan

## Mission and success definition
Establish a reproducible Z-machine v5 execution baseline: a purpose-built redistributable fixture, an evidence-backed I/O probe comparing **ifvms.js/ZVM vs Bocfel**, and `docs/evidence/g1-native-io.md` with a **provisional, conditional** recommendation for Issue #12. Done when the issue's seven acceptance checkboxes are satisfied with honestly-labeled evidence, a draft PR is published from `glm/issue11`, and work stops at the independent review gate. This is evidence-gathering, not a production adapter.

## Confirmed baseline (verified 2026-10-22 — no re-derivation needed)
- Branch `glm/issue11` == `main` == `origin/main` @ `a0c6e23`; clean tree; no open PRs; no prior code anywhere (repo is 46 markdown/JSON files). No CI, no package.json, no LICENSE.
- `tests/`, `experiments/`, `docs/evidence/` do not exist — created by this work. Paths sanctioned by the issue #11 body and `docs/superpowers/plans/2026-10-22-g1-a-native-io-probe.md` (read; matches the pasted task).
- `.gitignore` is leftover Next.js template: `*.z5` is NOT ignored (fixture binary committable), but `/node_modules` is root-anchored — an experiments-scoped ignore rule is needed.
- `validation/*` manifests are pinned to `ca8a115` and stale by design — never hand-edit. Exclude untracked `.mimosa/` files from commits. `state/` stays empty.
- D01–D37 approved conceptually (PR #33); D38 unresolved. Load-bearing here: D05, D07, D09, D13, D18, D24, D25, D26; checkpoint scope (D27/D28) is characterization-only — correctness is #12's.
- Governance: the primary session (coordinator) is the ONLY writer; `zmachine-*` specialists are read-only (Read/Grep/Glob, **no network**) — in-repo review only; web research uses web-capable agents.

## Binding guardrails
1. Issue #11 only. No #12 work (no save/restore correctness claims, no checkpoint implementation), no remix engine, no LLM/MCP, no production adapter, no deployment. Full exclusion list = pasted task §9.
2. Probe code is not the product: the Node harness is NOT the ADR-0001 runtime-language decision; no automatic promotion of probe code (probe brief).
3. Privacy: fixture is original, purpose-built, redistributable; no user-uploaded or commercial story content in repo or CI.
4. Evidence honesty (team-coordination §8.7): label evidence layers (static / deterministic / adapter integration / host-device). Probe runs are host/device evidence. A13/A14/A19/A23 presuppose engine artifacts (receipts, stable IDs, commit semantics) that don't exist — report interpreter-level **precursor** evidence only; never report planned acceptance cases as results.
5. Stop gates (task §10): fixture not reproducibly buildable; both candidates fail core input; char input not exercisable as genuine `read_char`; runtime API materially differs from docs; reliable I/O measurement needs substantial interpreter modification; licensing blocks the setup; required change would create unauthorized production architecture. On trigger: stop, document blocker + evidence + recommended action.
6. Platform honesty: primary environment Windows native (win32 x64). Any WSL2-run evidence is labeled WSL2-only; no native-Windows claims from WSL2 tests, no mobile claims.

## Phase 0 — Baseline & context (coordinator, local)
1. Re-verify clean tree, branch `glm/issue11`, HEAD == main @ `a0c6e23`.
2. Read owning docs before touching their subjects: `state-and-vm-bridge.md` (§5 capability manifest, §9 budgets/import validation), `turn-resolution.md` (§2 failed-action turns, §4 P5 char input), `world-policy.md` §8, `plugin-contract.md` §1/§6, `acceptance-matrix.md`, `decision-register.md`, `contract-reconciliation.md`, `ROADMAP.md` G1, G1-B brief (deferral boundary), design spec R1–R6.
3. Toolchain check: `node --version` (need ≥20), git, network for pinned downloads. If the fixture can't be built reproducibly → stop gate 1.
4. Write the investigation summary (exists / must-create / undecided tech / risks / contradictions) → reused in PR description + evidence doc.

## Phase 1 — Deliverable A: fixture (`tests/fixtures/zmachine/`)
1. Pin compiler: Inform 6 (IFTF-maintained release) + Inform 6 library — exact versions, download sources, SHA-256 digests recorded. Windows-native binary preferred; fallback documented.
2. Write `fixture.inf` (original work) — smallest practical story exposing F01–F12 with stable greppable markers (e.g. `[F01:startup=1]`) so assertions never parse prose:
   - F01 startup side effect before first prompt (A10/S06/D09) · F02 recognizable room + LOOK (A13) · F03 movable item + INVENTORY (A13) · F04 valid room movement (A13) · F05 recognized-but-failed action that consumes a turn, e.g. TAKE fixed scenery (A14) · F06 turn counter / scheduled event marker (A14, timer observability) · F07 GENUINE `read_char` menu — never a line-input fake (A16/P5) · F08 controlled `random(n)` draw with result marker (D24 precursor) · F09 two distinct objects with identical short names → disambiguation prompt (A19) · F10 locked progression gate · F11 designated extension anchor, documented for future bridge testing (D07/D13 precursor) · F12 clean terminal state (observable halt).
3. Compile → `fixture.z5`; record compiler version + exact command.
4. Reproducibility: recompile, compare SHA-256. Byte-identical → record; else pin tested binary digest + document nondeterminism (issue checkbox 1 allows either).
5. `README.md`: description, F01–F12 table, build procedure, compiler/library pins + digests, SHA-256 manifest (source + binary), explicit redistribution permission (original purpose-built work).
6. Fixture integrity test (digest match; optional rebuild check when compiler present).

## Phase 2 — Deliverable B: interpreter research (2 parallel web-capable subagents)
zmachine-* specialists have no network — research uses Explore/general-purpose agents. Every finding labeled: verified-experimentally (none yet) / supported-by-inspected-source-or-docs / unknown-untested / unsupported. Pin exact revisions.
- Subagent A — ifvms.js/ZVM (github.com/curiousdannii/ifvms.js): the 14 research points (license/redistribution; Z-versions; environment; required I/O integration surface; line input; char input; startup/init; output capture; timer/turn behavior; RNG interfaces + limitations; inspection interfaces; exposed save/checkpoint APIs WITHOUT correctness claims; future MCP-service integration difficulty; maintenance state). Inspect source at pinned revision, not old docs.
- Subagent B — Bocfel: same 14 points + dumb-terminal scripting interface + Windows build path (prebuilt/MSYS2/WSL2) + license verification (GPL expected; invoking an unmodified binary as a child process for evidence is acceptable; never vendor GPL source into the repo).
- Coordinator consolidates → 10-category comparison matrix (Z5 compatibility, input-boundary fidelity, output capture, startup, timer/failed-action, RNG observability, state inspection, checkpoint integration potential, isolation/resource control, licensing/maintenance/deployment) with the 4 evidence labels.

## Phase 3 — Deliverable C: probe harness (`experiments/vm-io/`)
Plain Node.js ≥20, ZERO npm dependencies, `node:test`. Minimal adapter interface; nothing frozen as a product contract.
- `adapters/ifvms-adapter.js` — ZVM in-process under Node with a minimal headless I/O implementation against the pinned revision's ACTUAL API (stop gate 4 if materially different from docs).
- `adapters/bocfel-adapter.js` — child-process driver for dumb-bocfel with watchdog; platform path config (native Windows preferred; WSL2 fallback labeled per-run).
- `probe.js` — scripted sequence → machine-readable JSONL evidence records: story_sha256, runtime identity + revision, init result, boundary type (line/char), submitted input, raw output (whitespace, prompt behavior, I/O ordering preserved), observed changes (location/inventory/turn markers/random results), execution status, errors/unsupported ops. Status values `running / waiting_for_line_input / waiting_for_character_input / halted / error` — conceptual states mapped to actual tested runtime signals per adapter, limitations documented.
- `vendor/ifvms/` — pinned ifvms.js copy with upstream LICENSE preserved + revision recorded (verify MIT).
- `package.json` (private, no deps) + `.gitignore` addition for `experiments/**/node_modules/` and build outputs.
- Experimental sequence (task §5, 12 steps): load; observe pre-input startup; LOOK; INVENTORY; move; failed action; measure turn advance; timed behavior; char-input menu; random behavior; duplicate-name disambiguation; terminal state. Same fixture + same declared I/O protocol for BOTH candidates; no fixture changes between candidates; any compatibility shim documented (reason + exact behavior).
- Test-first where practical for harness logic (state classification, transcript parsing) before adapter integration.

## Phase 4 — Deliverable D: negative tests & error isolation (bounded)
Cases: empty binary; truncated header; unsupported version byte; invalid/inconsistent header metadata; truncated otherwise-valid fixture; invalid command input; input at the wrong boundary (both directions); timeout/nontermination (where safely testable). Tampered binaries are generated at test time in a temp directory, not committed.
Bounds: per-run wall-clock timeout (e.g. 10s), output-size cap, one isolated process per run (no cross-run output mixing), explicit error classification, no false "loaded successfully" claims. Document any limit the runtime cannot enforce. Worker/process isolation is NOT claimed as a sandbox.

## Phase 5 — Deliverable E: test suite & acceptance mapping
Organized by responsibility: fixture integrity tests; harness/parser boundary tests; per-adapter integration tests (skip-with-explicit-reason when a runtime binary is unavailable on the platform). Map every test to the issue's 7 acceptance checkboxes and to A10/A13/A14/A16/A19/A23 as precursor interpreter-level evidence (layer-labeled); A15/A31 explicitly deferred to #12. Record exact commands, pass/fail/skip counts, runtime + fixture versions, environment, platform limitations. Never mark unexecuted tests passing. Windows vs WSL2 differences documented per-run.

## Phase 6 — Deliverable F: evidence doc + minimal doc-map updates
`docs/evidence/g1-native-io.md`: executive findings (was a viable native-I/O baseline established); test environment (OS/arch/toolchain/versions/digests); interpreter comparison (source-observations vs executed-tests strictly separated); experimental results (commands, transcripts, state observations, timers, char-input, errors); compatibility & limitations; **conditional** provisional recommendation for #12 (runtime accepted only after #12 recovery evidence; no conformance claim from reaching a prompt); G1-B handoff (exact fixture identity, reproduction commands, candidate revisions, input-boundary observations, RNG/time behavior, state fields requiring checkpoint coverage, known restoration obstacles).
Minimal doc updates (objectively identified inconsistencies created by this issue; flagged in PR): `docs/README.md` map gains `docs/evidence/`; root `AGENTS.md` Directories gains the three new directories and its status line is amended to distinguish probe/experiment code from the still-nonexistent product runtime. `docs/ROADMAP.md` and `validation/*` untouched.

## Phase 7 — Specialist reviews (read-only, per team-coordination policy)
Each dispatch carries a complete §5 packet: Task ID `zirp-20261022-NN`, objective, acceptance criteria, repo root + revision, paths + source excerpts (probe outputs included as source packets — specialists cannot run commands), applicable decisions, scope/exclusions, allowed tools, §6 return contract, effort budget, escalation conditions.
1. `zmachine-vm-bridge` ∥ `zmachine-turn-persistence` in parallel, distinct scopes (routing example 2): vm-bridge = native I/O semantics, capability manifest, budget/isolation coverage, checkpoint-claim discipline; turn-persistence = failed-action/timer semantics, #12 deferral boundary intact. Both review the evidence doc + harness design.
2. Coordinator synthesizes, resolves findings against owning docs, applies fixes (only writer).
3. `zmachine-acceptance-reviewer` — final independent gate on the complete diff: scope discipline, evidence layers, unsupported claims; returns checked/unverified item lists.
4. Substantive fixes → fresh re-review of the changed material.

## Phase 8 — PR & final report
1. Self-review: full diff; privacy scan of artifacts; docs-claims match observed results; changed files within Issue #11 scope.
2. Focused commits per deliverable (fixture; research records; harness; negative tests; suite; evidence doc; doc-map updates).
3. Push `glm/issue11`; open DRAFT PR titled `[G1-A][#11] Establish Z-machine fixture and native I/O feasibility evidence`, body with: objective/scope, base + head SHAs, candidates + tested revisions, deliverables, test commands + results, acceptance mapping, failures/limitations/skips, provisional recommendation, #12 handoff, explicit exclusions + stop-gate confirmation.
4. Do NOT merge; do NOT close #11; do NOT start #12.
5. Final report per task §12 sections A–E, including the five explicit stop confirmations.

## Subagent deployment summary
| Phase | Agent | Why | Output |
|---|---|---|---|
| Planning (done) | zmachine-context-contracts + 2× Explore | design-state brief; repo baseline; governance model | this plan's baseline facts |
| 2 | 2× web-capable research agents (parallel) | specialists lack network; independent evidence search | 14-point records, pinned revisions, labeled findings |
| 7 | zmachine-vm-bridge ∥ zmachine-turn-persistence | domain review, distinct scopes | §6 return-contract findings |
| 7 | zmachine-acceptance-reviewer | independent final gate | findings + checked/unverified lists |
All implementation and writing stays with the coordinator (only writer; agent-deployment discipline: tightly-coupled work stays local, delegation only for independent research and review).

## Files created/changed
- NEW `tests/fixtures/zmachine/`: `fixture.inf`, `fixture.z5`, `README.md`, digest manifest, integrity test.
- NEW `experiments/vm-io/`: `package.json`, `probe.js`, `adapters/ifvms-adapter.js`, `adapters/bocfel-adapter.js`, `vendor/ifvms/` (pinned + LICENSE), sequences, tests, negative-case generators.
- NEW `docs/evidence/g1-native-io.md`.
- EDIT `.gitignore` (experiments-scoped ignores), `docs/README.md` (map), `AGENTS.md` (directories/status) — minimal, flagged in PR.
- Untouched: `docs/architecture/*`, `docs/decisions/*`, `docs/ROADMAP.md`, `validation/*`, `state/`.

## Key risks → mitigations
- inform6 Windows binary unavailable → pinned official release; fallback MSYS2/WSL2 build, documented.
- Bocfel dumb-mode not buildable natively on Windows → WSL2 evidence labeled WSL2-only (allowed; no native-Windows claim for Bocfel).
- ifvms.js Node integration differs from documented assumptions → stop gate 4 (report, don't force).
- Compiler nondeterminism → pin tested digest + document (explicitly allowed).
- GPL compliance → Bocfel invoked as unmodified child process, never vendored.

## Skill applicability (user-tagged)
agent-deployment → delegation discipline above; create-initial-operating-contract → this plan's contract structure (mission/scope/constraints/order/verification/stop/handoff); roadmap → gate alignment only, no ROADMAP.md edits; github:issue → #11 fetched and confirmed; find-skills → local inventory sufficient (github:pr + github:commit at Phase 8); langgraph-project-setup → excluded — nothing in #11 involves LangGraph and the repo forbids scaffolding.