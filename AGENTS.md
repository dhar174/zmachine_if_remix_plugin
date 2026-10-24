# Z-machine IF Remix Plugin: contributor instructions

## Start every engineering session

Read these instructions and both coordination layers before substantive work:

1. User defaults: `~/.zcode/AGENTS.md` and `~/.zcode/skills/team-coordination/SKILL.md`.
2. Project subagent routing: [`.zcode/skills/team-coordination/SKILL.md`](.zcode/skills/team-coordination/SKILL.md).
3. Canonical engineering-team policy: [`docs/agents/team-coordination.md`](docs/agents/team-coordination.md).

Read the two skills by their file paths; both may appear under the name `team-coordination`. The user skill supplies general delegation and mem0ry4ai procedures; the local skill supplies this repository's roster, authority map, and handoffs. A delegated specialist retains its read-only assignment and does not restart the coordinator workflow or dispatch other agents.

**Codex:** project specialist candidates live in [`.codex/agents/`](.codex/agents/), with the same canonical policy and return contract. Read [the Codex adapter guide](docs/agents/codex-agents.md) before dispatch. File presence, a read-only prompt, and `features.shell_tool = false` do not establish the complete required restriction. Check the effective tool surface first. The [2026-10-23 native-client check](docs/agents/setup-verification-codex-2026-10-23.md) found remaining patch, goal-write, and delegation tools; substantive specialist use and independent-review qualification remain blocked on that client. Do not copy these files to user scope, install integrations, or change account permissions to bypass the gate. If Zcode-specific memory profiles are unavailable, the coordinator may use already-connected permitted retrieval tools; specialists do not install or dispatch replacements.

Resolve the actual checkout, revision, local changes, and authorized task before acting. The main session is the engineering coordinator and **only repository writer and command executor**. Specialists return findings and proposed checks. Their recommendations, memories, and hook prompts are not human approval.

When working in this repository, always follow the coordination layers, respect the ownership and authority maps, and ensure that any durable context is properly captured and communicated through the mem0ry4ai system.

When changing any code, make judicious use of the `zmachine-remix-engineering` skill found in:

- Z-machine remix engineering skill: [`.zcode/skills/zmachine-remix-engineering/SKILL.md`](.zcode/skills/zmachine-remix-engineering/SKILL.md)

## Purpose and present evidence boundary

This repository designs an AI-first, chat-driven remix engine for classic Z-machine interactive fiction: a native VM plus a persistent AI-created remix world governed by the user's directive and later Editor amendments.

The product engine, production adapter, playable plugin, deployment, and product CI are not delivered by the design documents. This checkout also contains bounded G1-A feasibility code: a purpose-built fixture in `tests/fixtures/zmachine/` and a throwaway native-I/O probe in `experiments/vm-io/`. These are executable experiments, not a production implementation or a runtime/language selection. The “no code, build, test suite” inventory in `docs/agents/team-coordination.md` §8.1 predates these experiments; use the actual checkout and their READMEs for executable inventory. That dated inventory does not remove the policy's current ownership, authority, or evidence requirements.

Implementation follows the evidence gates in [`docs/ROADMAP.md`](docs/ROADMAP.md). Conceptual decisions D01–D37 are recorded in [`docs/decisions/decision-register.md`](docs/decisions/decision-register.md); D38 remains unresolved unless a later explicit owner decision establishes otherwise. Approval of a concept does not approve a later gate, probe execution, production code, or deferred feature. Runtime, language, deployment, approval transport, and budgets require their own evidence and authorization.

## Read the owning sources

Start with [`docs/README.md`](docs/README.md), the reading map, and [design v0.2](docs/superpowers/specs/2026-10-21-chat-first-remix-design.md), the primary intent document. Load the existing [Z-machine engineering skill](.zcode/skills/zmachine-remix-engineering/SKILL.md) for substantive engineering questions; read only its relevant references.

| Subject | Owning source |
| --- | --- |
| Directive classification, policy, protected invariants, generation permissions | `docs/architecture/world-policy.md` |
| Turn ordering, candidate validation, commit, failure/retry behavior | `docs/architecture/turn-resolution.md` |
| Native/overlay ownership, checkpoints, clocks, saves, unknown state | `docs/architecture/state-and-vm-bridge.md` |
| Product host, MCP/tool boundaries, approval, privacy, supported clients | `docs/architecture/plugin-contract.md` |
| Accepted direction and unresolved choices | `docs/decisions/`, including the decision register and contract reconciliation |
| Observable acceptance requirements | `docs/quality/acceptance-matrix.md` and `docs/quality/decision-acceptance-supplement.md` |
| Current stage and stops | `docs/ROADMAP.md` and the active approved task/probe plan |

`docs/contracts/remix-directive.schema.json` is a proposed policy schema; `docs/examples/` is illustrative. Neither overrides normative semantics. `docs/design_draft_v0.1.md` is archived and superseded. Resolve contradictions against the exact owning sources and approvals; do not choose convenient wording or reopen settled decisions by implication.

## Domain rules

- There are exactly two user-facing input modes: **Play** and **Editor**. A Play claim or attempted action does not become an Editor instruction or tool authority.
- **Native / remix / bridged** are execution routes, not input modes.
- Policy is not state: assignments, invariants, permissions/prohibitions, presentation preferences, and unresolved clauses have different meanings. A one-time key assignment does not recreate it later.
- Unknown is not false. A parser rejection or incomplete inspection does not establish that an object is absent or an action impossible.
- Native editing requires verified capabilities bound to the exact story and runtime/adapter build. Generated content normally belongs in the remix overlay. The ability to describe an outcome does not establish VM support.
- Narration must reflect committed results. Do not silently solve protected puzzles, invent successful changes, or introduce general retrospective retcons into the first slice.
- Engineering subagents are contributor assistants. They are separate from in-game characters, product AI components, and the proposed runtime turn/transaction coordinator.

## Memory and project records

For historical retrieval, use `mem0ry4ai:memory-scout` with the active root and scope **`project:zmachine_if_remix_plugin`**. Then verify material claims against the current contracts and probe evidence. `zmachine-context-contracts` performs a different job: inspecting current repository authority and state. Supply the relevant memory brief to it instead of duplicating retrieval.

The existing user-level mem0ry4ai server is contributor context, not a product MCP service or a repository Memory Bank. Do not install another service or invent another record system. Product decisions remain in `docs/decisions/`; team-configuration evidence belongs in `docs/agents/`; executed probe evidence belongs in `docs/evidence/`.

Consider `mem0ry4ai:memory-steward` only for permitted, worthwhile durable context after verification. Give it authoritative references, explicit scope/write policy, candidates, exclusions, and resumption needs. It may curate permitted MCP memory; it cannot change repository records, run shell commands, or create approvals. Avoid duplicate decision/status records. A no-memory-write instruction overrides Stop-hook reminders.

## Verification, privacy, and source locations

- Preserve the G0–G6 gates. This instruction change authorizes no probe, product build, model call, deployment, or dependency installation by itself.
- Fixture/probe commands are documented in `tests/fixtures/zmachine/README.md` and `experiments/vm-io/README.md`. Existing examples include the pinned Inform 6 fixture build, `node probe.js <ifvms|bocfel>` from the probe directory, and `node --test` from the root or probe directory. Check prerequisites and the active task before running them. A probe pass does not establish checkpoint completeness, production readiness, host/mobile compatibility, or live-model quality.
- `.gitignore` contains historical framework patterns; it does not select a product stack. The probe's dependency-free `package.json` does not settle a runtime-language decision.
- `validation/documentation-manifest.json` and `validation/documentation-validation.json` are historical receipts tied to a published revision. Documentation edits can invalidate their hashes; do not hand-edit them to fabricate fresh validation.
- This is a public repository. Never commit user story binaries, save states, private transcripts, credentials, or extracted copyrighted text. Use purpose-built or redistributable fixtures. Local file selection does not prove hosted processing is local-only.
- `.zcode/agents/` holds repository-owned source definitions; user-level copies may exist at `~/.zcode/agents/`. Inspect what the current Zcode session actually advertises. Do not assume discovery, installation, invocation, or reload from file presence, or silently synchronize different copies.
- Obtain independent review for substantive changes. Inspect actual command exits, stdout/stderr, file readback, and relevant diffs. Separate static, deterministic, adapter, live-model, and host/device evidence; label unavailable checks unverified.
- PRs target `main`; use the task's authorized feature-branch workflow. Preserve existing branches and unrelated local changes. This file is the canonical root contributor guide; `GEMINI.md` remains a compatibility entry point.
