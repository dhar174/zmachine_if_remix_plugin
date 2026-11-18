# Antigravity Workspace Agents (Migrated from ZCode)

This directory contains eight Google Antigravity workspace candidates based on the specialist definitions in [`.zcode/agents/`](../../.zcode/agents/). Before substantive delegation, verify their effective read-only tool surface under the [specialist admission gate](../../docs/agents/team-coordination.md#91-project-adapters-and-specialist-admission).

This `README.md` has no YAML agent frontmatter and is documentation only — not an agent definition.

## Source, Destination, and Mapping

- **Source directory (ZCode):** `.zcode/agents/` (unchanged)
- **Destination directory (Antigravity):** `.agents/agents/`
- **Shared skill:** `.agents/skills/zmachine-remix-engineering/SKILL.md` (already present and identical to `.zcode/skills/zmachine-remix-engineering/SKILL.md`; reused in place)

| Agent Name (`name`) | ZCode Source | Antigravity Destination | Role |
| --- | --- | --- | --- |
| `zmachine-context-contracts` | `.zcode/agents/zmachine-context-contracts.md` | `.agents/agents/zmachine-context-contracts.md` | Read-only context and contracts scout |
| `zmachine-policy-directives` | `.zcode/agents/zmachine-policy-directives.md` | `.agents/agents/zmachine-policy-directives.md` | Remix directive, policy, and schema specialist |
| `zmachine-vm-bridge` | `.zcode/agents/zmachine-vm-bridge.md` | `.agents/agents/zmachine-vm-bridge.md` | Native VM ownership, checkpoints, and bridge specialist |
| `zmachine-turn-persistence` | `.zcode/agents/zmachine-turn-persistence.md` | `.agents/agents/zmachine-turn-persistence.md` | Play/Editor turn transactions, recovery, and concurrency specialist |
| `zmachine-chat-host` | `.zcode/agents/zmachine-chat-host.md` | `.agents/agents/zmachine-chat-host.md` | Chat-host boundary, tools, approvals, and import privacy specialist |
| `zmachine-narrative-knowledge` | `.zcode/agents/zmachine-narrative-knowledge.md` | `.agents/agents/zmachine-narrative-knowledge.md` | Narration grounding, knowledge/beliefs, hints, and quests specialist |
| `zmachine-continuity-provenance` | `.zcode/agents/zmachine-continuity-provenance.md` | `.agents/agents/zmachine-continuity-provenance.md` | Future continuity, branch merge, and sharing boundaries specialist |
| `zmachine-acceptance-reviewer` | `.zcode/agents/zmachine-acceptance-reviewer.md` | `.agents/agents/zmachine-acceptance-reviewer.md` | Independent acceptance reviewer (also covers `.agents/agents/`) |

## Common Frontmatter Configuration

Every migrated agent sets the following baseline YAML frontmatter:

```yaml
model: flash
mainAgent: true
subagent: true
commandExecutionPolicy: sandbox
inheritMcp: false
inheritCustomizations: true
skills:
  - skills/zmachine-remix-engineering
```

- **`model: flash`**: Antigravity documents `model` as the tier used when an agent runs as a **subagent** (`invoke_subagent`). When the same agent is selected as a **primary agent** (`mainAgent: true`), the active session model selection may govern execution. Preserving `model: flash` in every file satisfies the repository migration standard across all eight definitions (including `zmachine-acceptance-reviewer`, which left `model` unset in ZCode).
- **Removed ZCode-only fields:** `color`, `thoughtLevel`, `maxTurns`, and `injectAgentsMd` have no Antigravity frontmatter equivalents and were removed. Bounded-pass discipline (`maxTurns: 24` for `zmachine-context-contracts`, `20` for the remaining seven) is preserved in the agent instructions alongside the `team-coordination.md` §5 effort budget. Workspace instruction injection (`injectAgentsMd: true`) is replaced by `inheritCustomizations: true` and Antigravity's automatic loading of root `AGENTS.md`, `GEMINI.md`, and `.agents/rules/team-coordination.md`.

## Shared Skill Integration

All eight agents declare `skills: [skills/zmachine-remix-engineering]` in YAML frontmatter and include an operational instruction in their Markdown body directing them to load and follow `.agents/skills/zmachine-remix-engineering/SKILL.md` before performing repository engineering tasks while preserving each agent's stricter read-only and no-network rules.

## Tool Mapping and Permission Preservation

All eight source specialists are defined as read-only, non-mutating, non-network investigators in `docs/agents/team-coordination.md` (§2, §8.9–§8.10) and in each definition's §6 ("Allowed operations and limits"):

- **Declared Antigravity tools (all 8 agents):** `view_file`, `grep_search`, `find_by_name`, `list_dir` (functional equivalents of ZCode `Read`, `Grep`, `Glob`, plus read-only directory listing).
- **Omitted write/shell tools:** The eight `tools` declarations omit `write_to_file`, `replace_file_content`, `multi_replace_file_content`, and `run_command`.
- **Omitted `TodoWrite`:** No direct Antigravity built-in tool equivalent exists; progress tracking stays inline without mutating workspace files.
- **Intentionally excluded web tools (`WebSearch` / `WebFetch`):** Five ZCode templates (`zmachine-context-contracts`, `zmachine-vm-bridge`, `zmachine-narrative-knowledge`, `zmachine-continuity-provenance`, `zmachine-acceptance-reviewer`) listed `WebFetch` and/or `WebSearch` in YAML frontmatter (see `docs/agents/README.md`), even though their own §6 and `docs/agents/team-coordination.md` §2 explicitly forbid network fetching. To preserve the effective read-only, offline/packet-only intent, `search_web` and `read_url_content` are omitted from all eight Antigravity `tools` allowlists.
- **MCP inheritance (`inheritMcp: false`):** Disables inheritance of workspace MCP servers. Verify the effective tools separately, including runtime task management and delegation. See the [Antigravity frontmatter reference](https://antigravity.google/docs/build-plugins#subagents).

## Differences and Compatibility Limitations

1. **CLI vs. App/IDE tool surface (`agy 1.5.8`):** In Antigravity CLI (`agy 1.5.8`), `view_file` resolves to the built-in `read_file` tool, whereas `grep_search`, `find_by_name`, and `list_dir` are not exposed as separate CLI built-ins (they apply on surfaces such as Antigravity App/IDE where those tools exist). When running under CLI-only restrictions without `run_command`, specialists read known paths with `read_file` and request search/listing excerpts or commands from the coordinator via the assignment packet (`docs/agents/team-coordination.md` §5).
2. **Primary-agent `model` precedence:** Selecting an agent as a primary session agent (`agy --agent <name>` or `/agents`) can inherit or follow the active session model rather than forcing `flash`.
3. **No frontmatter `maxTurns` enforcement:** Turn budgets are guidance in instructions rather than a hard Antigravity frontmatter cap.
4. **Runtime admission:** The review at `7dbb00d` observed inherited MCP tools and process control through `manage_task` in the earlier configuration. The revised frontmatter still requires fresh effective-tool verification on the intended client.

## Discovery and Invocation

- **List discovered agents (CLI):** `agy agents`
- **Select as primary agent (CLI):** `agy --agent <agent-name>` (or choose from `/agents` inside an interactive session)
- **Delegate as subagent:** Parent sessions invoke `invoke_subagent` with the target role/prompt when `subagent: true` is active in the workspace.
- **Antigravity App / IDE:** Workspace agents under `.agents/agents/*.md` are discovered automatically at the repository root and appear in Customizations / agent selectors.

## Maintaining Synchronization with `.zcode/agents/`

`.zcode/agents/` remains the upstream template source for ZCode. When updating a specialist role:

1. Update the canonical policy (`docs/agents/team-coordination.md`) or `.zcode/agents/<name>.md` first as required by the task.
2. Mirror domain-scope, invariant, startup-read, and return-contract edits into `.agents/agents/<name>.md`, keeping Antigravity YAML frontmatter (`model: flash`, `mainAgent: true`, `subagent: true`, `commandExecutionPolicy: sandbox`, `inheritMcp: false`, `inheritCustomizations: true`, `skills`, and the read-only `tools` list) intact.
3. Check the YAML and declared tools, then verify that the intended workspace client lists the expected eight `zmachine-*` roles.
