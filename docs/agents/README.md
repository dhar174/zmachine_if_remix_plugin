# Engineering agents: roster, installation, and use

This directory holds the engineering-team configuration for the repository: the canonical coordination policy ([team-coordination.md](team-coordination.md)), this guide, and point-in-time setup-verification records. The specialist definitions themselves are versioned as source templates in the repository's [`.zcode/agents/`](../../.zcode/agents/) directory.

The coordination policy — roles, routing table, assignment and return contracts, shared invariants — is [team-coordination.md](team-coordination.md). This README is operational guidance only; where any wording disagrees, the policy wins.

## Roster

All specialists are read-only investigators (`Read`, `Grep`, `Glob`), inherit the primary session's model, and cannot spawn subagents or edit files.

| Agent | Mission (one line) |
| --- | --- |
| `zmachine-context-contracts` | Brief the current state: accepted decisions, draft contracts, historical material, missing evidence, documentation-update map |
| `zmachine-policy-directives` | Directives, policy semantics, clause classification, scopes, supersession, generation envelopes, schema-vs-semantic boundaries |
| `zmachine-vm-bridge` | Native VM ownership, exact-story identity, capability manifests, complete checkpoints, RNG/timers, anchors, takeover coverage |
| `zmachine-turn-persistence` | Turn algorithm, candidate isolation, atomic commit, idempotency, crash recovery, save/restore/branches, concurrency |
| `zmachine-chat-host` | Host/model vs service responsibilities, proposed tools and skills, trusted approvals, private import, privacy, client evidence |
| `zmachine-narrative-knowledge` | Narration grounding, facts/beliefs/knowledge separation, transcript fidelity, quests, hints, engine-owned randomness |
| `zmachine-continuity-provenance` | Future continuity family (D08, D29–D37): lineage, merges, transfers, sync, sharing — reviewed without initiating deferred work |
| `zmachine-acceptance-reviewer` | Independent final review: defects, contract violations, unsupported claims, evidence-layer discipline |

## Source templates versus installed agents

Facts verified against this Zcode version's official documentation and the installed client on 2026-10-22:

- Subagent definitions are discovered **only** from `~/.zcode/agents/<name>.md` (user scope). There is **no project-level subagent discovery**: the repository's `.zcode/agents/` directory is a versioned source location, not an installed one. Do not claim the templates are automatically discovered.
- Zcode subagents cannot spawn subagents; the primary session dispatches.
- Official documentation: definition changes take effect only in a **fresh session**, except that a subagent with `model: inherit` follows a primary-session model switch immediately. Observed deviation (2026-10-22 desktop session): new definitions became available as agent types mid-session, right after installation. Do not assume either behavior — verify reload behavior in your own client and report which one you observed.
- Required frontmatter fields are `name` and `description`; supported optional fields used here are `model`, `tools`, `injectAgentsMd`, and `maxTurns`. A file missing a required field is ignored.
- Zcode reads workspace instructions from the root `AGENTS.md` only; it does not read `GEMINI.md` (that file exists for Gemini CLI / Antigravity compatibility).

## Installation

Installing means copying the templates into the user-scope discovery directory. Git Bash:

```bash
mkdir -p ~/.zcode/agents
cp .zcode/agents/zmachine-*.md ~/.zcode/agents/
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.zcode\agents" | Out-Null
Copy-Item .zcode\agents\zmachine-*.md "$HOME\.zcode\agents\"
```

The 2026-10-22 install was purely additive (no existing file was overwritten); if a future update would overwrite an existing definition, back up the installed copy **outside** the discovery directory first (for example `~/.zcode/backup/agents/`) — files left in `~/.zcode/agents/` are live configuration. Do not preserve unrelated definitions (such as other projects' agents): installation touches only `zmachine-*.md`.

## Updates and removal

- **Update:** edit the repository template, then re-copy it to `~/.zcode/agents/` and start a fresh session. The repository copy is the source of truth; never edit only the installed copy.
- **Remove:** delete the matching `~/.zcode/agents/zmachine-<name>.md`. Removing or editing the repository templates does not uninstall anything.
- **Verify a clean state:** `ls ~/.zcode/agents/zmachine-*.md` lists exactly the installed specialists.

## Invocation

Specialists are dispatched by the primary session (coordinator), not by the user directly and not by each other. Example requests and the routing the coordinator would apply (full routing table and examples in [team-coordination.md](team-coordination.md) §4):

- "Classify the clauses in this proposed remix directive and flag what stays unresolved." → `zmachine-policy-directives`, then `zmachine-acceptance-reviewer` on the diff.
- "Design the checkpoint contents for pausing at a native character prompt during an extension scene." → `zmachine-vm-bridge` + `zmachine-turn-persistence` in parallel, coordinator synthesizes.
- "Can we let the chat model confirm editor changes with a yes/no reply?" → `zmachine-chat-host` (transport/trust) + `zmachine-policy-directives` (approval tiers).

Every assignment uses the policy's assignment contract (§5) and every specialist response follows the return contract (§6). A specialist recommendation is not owner approval.

## Verification

Four states are distinct and must be reported separately: **written** (templates exist in the repository), **installed** (copied to `~/.zcode/agents/`), **discovered** (a fresh session lists the agents as available), and **invocation-verified** (a real assignment ran through each role). Fresh-session checklist:

1. Start a new Zcode session in this repository.
2. Confirm the eight `zmachine-*` agents appear as available subagent types (discovered).
3. Dispatch one small read-only assignment (e.g. have `zmachine-context-contracts` brief the current roadmap gate) and check the response follows the return contract (invocation-verified).
4. Record outcomes in a dated `setup-verification-YYYY-MM-DD.md` in this directory.

The current verification state is recorded in [setup-verification-2026-10-22.md](setup-verification-2026-10-22.md).

## Antigravity and GEMINI.md

Antigravity does not load Zcode subagent definitions. It loads root `AGENTS.md`/`GEMINI.md` and the immediate `.md` children of `.agents/rules/` (frontmatter with a valid `trigger` is required, or the file is silently discarded). This repository provides `.agents/rules/team-coordination.md` with `trigger: always_on` as the Antigravity entry point to the same policy. If specialist invocation is unavailable in a given client, the primary agent performs the checks itself and states that independent subagent review did not occur.
