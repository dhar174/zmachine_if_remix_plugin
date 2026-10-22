# AGENTS.md

## What this repository is

A documentation-only design proposal (v0.2) for an AI-first, chat-driven remix engine for classic Z-machine interactive fiction: a real native VM plus a persistent, AI-created remix world governed by a user's initial directive and later Editor amendments.

**There is no code, no package.json, no build, no test suite, no CI, and no runtime.** Do not infer runtime behavior, native/mobile compatibility, test passes, or deployment from these documents — the docs themselves forbid that inference. Current status: gate G0 (behavioral contract review) per `docs/ROADMAP.md`; implementation work must follow the roadmap's G0–G6 evidence-first stop gates (e.g., select the VM runtime after checkpoint/restore evidence, not from feature names).

## Directories

- `docs/superpowers/specs/2026-10-21-chat-first-remix-design.md` — design v0.2, the primary intent document (user requirements R1–R6). Start here.
- `docs/README.md` — documentation map with the official reading order.
- `docs/architecture/` — normative contracts (see ownership rules below).
- `docs/contracts/remix-directive.schema.json` — proposed policy schema; a design artifact, not a runtime contract.
- `docs/decisions/` — ADRs. ADR-0001 records user requirements plus decisions still requiring evidence (runtime, language, deployment, approval transport).
- `docs/examples/` — synthetic examples; illustrate the contracts, never override them.
- `docs/quality/acceptance-matrix.md` — observable evidence required before claiming any feature works.
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

None exist. `.gitignore` is leftover Next.js/Vercel template content — it is **not** evidence of a JavaScript stack. ADR-0001 keeps TypeScript as a *candidate* runtime language, explicitly undecided pending gate-G1 evidence. Do not scaffold a framework based on the gitignore.

## Git conventions

PRs target `main`; work on feature branches. No formal commit convention is established yet — history shows both `docs:`-prefixed and plain imperative subjects.
