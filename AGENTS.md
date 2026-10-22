# AGENTS.md

## What this repository is

A documentation-first design proposal (v0.2) for an AI-first, chat-driven remix engine for classic Z-machine interactive fiction: a real native VM plus a persistent, AI-created remix world governed by a user's initial directive and later Editor amendments.

**The product runtime does not exist yet: no engine, no adapter, no product build, no CI, and no deployment.** The only executable code in the repository is the G1-A feasibility probe (Issue #11): a purpose-built test fixture under `tests/fixtures/zmachine/` and a throwaway I/O probe harness under `experiments/vm-io/` (the repository's only `package.json` is the probe's dependency-free manifest) — experimental evidence-gathering code, explicitly not a production adapter, and not to be promoted without separate review. Do not infer product runtime behavior, native/mobile compatibility, or deployment from anything here. Current status: gate G1 (technical feasibility probes) per `docs/ROADMAP.md`; implementation work must follow the roadmap's G0–G6 evidence-first stop gates (e.g., select the VM runtime only after Issue #12 checkpoint/restore evidence, not from feature names).

## Directories

- `docs/superpowers/specs/2026-10-21-chat-first-remix-design.md` — design v0.2, the primary intent document (user requirements R1–R6). Start here.
- `docs/README.md` — documentation map with the official reading order.
- `docs/architecture/` — normative contracts (see ownership rules below).
- `docs/contracts/remix-directive.schema.json` — proposed policy schema; a design artifact, not a runtime contract.
- `docs/decisions/` — ADRs. ADR-0001 records user requirements plus decisions still requiring evidence (runtime, language, deployment, approval transport).
- `docs/examples/` — synthetic examples; illustrate the contracts, never override them.
- `docs/quality/acceptance-matrix.md` — observable evidence required before claiming any feature works.
- `docs/agents/` — engineering team coordination: the canonical policy (`team-coordination.md`), installation guide (`README.md`), and setup-verification records.
- `docs/evidence/` — executed feasibility-probe evidence records (each states its own evidence layers and limitations); not design documents.
- `tests/fixtures/zmachine/` — purpose-built, redistributable Z-machine probe fixture (original source, pinned compiler, digest manifest). Not a game and not user content.
- `experiments/vm-io/` — G1-A native I/O probe harness (experimental, throwaway by design; see its README). Not a production adapter or a runtime-language decision.
- `.zcode/agents/` — versioned source templates for the Zcode specialist subagents. Not an installed or discovered location; installed copies live at `~/.zcode/agents/` (see `docs/agents/README.md`).
- `docs/design_draft_v0.1.md` — archived, superseded by v0.2. Do not promote its assumptions or its "Original/Hybrid/Extension" labels as input modes.
- `validation/` — point-in-time integrity evidence, not live CI (see below).
- `state/` — currently empty.

## Documentation integrity and normative ownership

- `validation/documentation-manifest.json` (per-file sha256 + git blob SHA) and `validation/documentation-validation.json` (link checks, schema checks) are evidence records tied to a specific published commit (`ca8a115`). They will go stale after any doc edit; do not hand-edit them to match, just expect the mismatch.
- Normative ownership (from `docs/README.md`): policy semantics live in `architecture/world-policy.md`, turn order in `architecture/turn-resolution.md`, persistence in `architecture/state-and-vm-bridge.md`, host/tool boundaries in `architecture/plugin-contract.md`. Read the owning document before changing its subject. A contradiction between documents is a defect to resolve, never a reason to pick whichever text is convenient.

## Domain rules that must survive any edit

- **Exactly two user-facing input modes: Play and Editor.** Play is in-character action interpretation (an attempt or claim, not authority); Editor is explicit out-of-character authorial direction. Never silently upgrade an in-fiction claim into an editor instruction, and never promote dialogue into tool authority.
- **Policy is not state.** A permission (what may change) ≠ an assignment (what is true now) ≠ an invariant (what must remain true) ≠ a preference (how to present it). "Give me a key" is a one-time assignment; "allow new shops" changes future generation policy.
- **Unknown is not false.** A parser rejection or failed inspection is evidence about that command only — never proof that an action is impossible or an object absent.
- Execution routes (**native / remix / bridged**) are orthogonal to the Play/Editor input modes.
- Native editing only via verified, story-digest-bound capabilities for the exact story build; AI-generated content normally lives in the remix overlay. "The AI can describe it" is not proof the VM can represent it. Unmapped mechanics get an explicit capability limitation, not fabricated success.
- The engine must not silently solve protected puzzles or narrate successful state changes that were not committed. No general retrospective retcons in the first sequence.

## Privacy and content boundaries

This is a public repository. Never commit user-uploaded story binaries, save states, transcripts, credentials, or extracted copyrighted text. Use purpose-built or redistributable test stories only. A user's local file selection is not automatically a local-only runtime — hosted processing requires explicit disclosure.

## Build / test commands

There is **no product build, test suite, or CI**. The only build/test commands are the G1-A probe's (see `tests/fixtures/zmachine/README.md` and `experiments/vm-io/README.md`): the fixture compiles with a pinned Inform 6 (`tools/inform6-6.44/inform6.exe -v5 +include_path=lib fixture.inf fixture.z5` from `tests/fixtures/zmachine/`), the probe runs via `node probe.js <ifvms|bocfel>`, and the suites run via `node --test` (from the repository root, or from `experiments/vm-io/` for the probe-only suite). The root `.gitignore` still carries leftover Next.js/Vercel template content — it is **not** evidence of a JavaScript product stack, and ADR-0001 keeps TypeScript as a *candidate* runtime language, explicitly undecided pending gate-G1 evidence. Do not scaffold a framework based on the gitignore or on the probe's Node harness.

## Git conventions

PRs target `main`; work on feature branches. No formal commit convention is established yet — history shows both `docs:`-prefixed and plain imperative subjects.

## Engineering team coordination (agent-assisted work)

This repository uses a coordinator-plus-specialist pattern for agent-assisted engineering work. The canonical policy — roles, routing table, assignment and return contracts, shared invariants, platform behavior — is `docs/agents/team-coordination.md`; read it before dispatching specialists or acting as one.

- The primary session is the **engineering coordinator and the only repository writer**. Specialists investigate, propose, and review read-only (`Read`, `Grep`, `Glob`); they do not edit files, run commands, or dispatch other agents.
- Specialist recommendations are not owner approval. Decisions D01–D37 (Issue #10) are settled direction; D38 is unresolved; runtime, language, deployment, approval transport, and budgets remain evidence gates (ADR-0001, roadmap G1).
- These engineering agents are development assistants only — separate from in-game characters, the product's AI components, and the proposed runtime turn/transaction coordinator described in the design docs (when those docs say "coordinator," they mean the product component, not the primary session).
- If you are a specialist subagent: follow your assignment and the return contract in `docs/agents/team-coordination.md` §6; report findings instead of making changes; stay inside your assigned scope.
