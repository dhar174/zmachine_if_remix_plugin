---
name: team-coordination
description: Coordinate Zcode engineering work in zmachine_if_remix_plugin with its read-only specialist roster, contract ownership, roadmap gates, memory handoffs, and independent acceptance review.
---

# Z-machine project coordination

This is the repository-specific Zcode adapter to `docs/agents/team-coordination.md`, the canonical team policy. Read that policy and root `AGENTS.md`; use the user-level `~/.zcode/skills/team-coordination/SKILL.md` for generic handoff and MCP procedures. Read this file by path because the generic skill has the same name. This file supplies practical routing and task context, not a second policy, new approval, or new record system.

## Session start and authority

1. Establish the active checkout/revision, local changes, task, permitted gate, and explicit stops. Resolve repository paths from the active checkout, not from this skill's directory.
2. Read `docs/README.md`, the relevant accepted decisions, the owning architecture contract, and `docs/ROADMAP.md`. Use the existing `.zcode/skills/zmachine-remix-engineering/SKILL.md` and its relevant references for engineering work.
3. If past context matters, run the memory scout with explicit scope `project:zmachine_if_remix_plugin` and the active root. Read only the relevant records. Memory is historical context; current contracts and exact approvals remain authoritative.
4. Use `zmachine-context-contracts` when current authority, stage, branch availability, or cross-contract ownership is uncertain. Give it the memory brief and a precise current-source question. Do not duplicate its investigation with another specialist on the same question.

The coordinator is the only repository writer and command executor. All project specialists receive **Read/Grep/Glob-only assignments**, no edits, shell, network, task-state writes, or delegation. Some definitions may expose additional tools; availability does not override the canonical assignment restriction. The user-level memory team has a distinct MCP role; it is not an implementation worker. No parallel implementation writers are enabled.

If you are a specialist, perform only the assigned bounded investigation/review. Do not relaunch startup scouting, install definitions, invoke another agent, or edit the material under review. Propose an exact check for the coordinator when command evidence is missing.

## Roster and routing

Use the exact `Agent` `subagent_type` advertised by Zcode. Definitions may exist in `.zcode/agents/` and `~/.zcode/agents/`; inspect the current catalog and effective definition. Preserve configured model/reasoning/turn limits. Do not infer runtime loading or invocation from a template or silently overwrite installed copies.

| Agent | Route these questions | Supply these sources/context |
| --- | --- | --- |
| `zmachine-context-contracts` | Current state, decisions, gate, ownership, documentation map | Task/snapshot; `README.md`, `docs/README.md`, `docs/ROADMAP.md`, relevant `docs/decisions/`, v0.2 design |
| `zmachine-policy-directives` | Clause classification, policy/state separation, scope, supersession, protections, schema vs semantics | Owning `world-policy.md` sections, directive/schema/example excerpts, relevant decision IDs and authority question |
| `zmachine-vm-bridge` | Exact-story capabilities, native I/O, ownership, checkpoints, RNG/timers, takeover coverage | Story/runtime identity, input boundary, `state-and-vm-bridge.md`, native turn sections, applicable probe source/evidence |
| `zmachine-turn-persistence` | Candidate isolation, complete effects, commit, retries, revisions, recovery, save/restore/concurrency | `turn-resolution.md`, persistence contract, transaction/recovery scenario, expected receipt and failure behavior |
| `zmachine-chat-host` | Host/service boundaries, product tools/skills, trusted approval, private import, privacy, client evidence | `plugin-contract.md`, relevant references, intended host/client, trust boundary and evidence layer |
| `zmachine-narrative-knowledge` | Narration grounding, knowledge/belief/perspective, spoilers, dialogue, quests/hints/NPC behavior | Relevant policy/turn/state sections, walkthrough/scenario, applicable D11–D26 decisions, committed-vs-proposed distinction |
| `zmachine-continuity-provenance` | Lineage, branches/merges, transfer/identity, synchronization/sharing | Relevant state/decision contracts, provenance scenario, and explicit delivery-lane exclusions; do not initiate deferred features |
| `zmachine-acceptance-reviewer` | Independent final review, unsupported claims, contract violations, evidence gaps, agent setup | Exact final diff/snapshot, task/approval boundaries, owning contracts, A/S cases, actual check receipts and omissions |

Examples: native ownership plus restore mechanics can use VM-bridge and turn-persistence concurrently on distinct questions. Approval design can use chat-host plus policy-directives. Agent-configuration work needs current-context inspection and independent acceptance review. Do not dispatch every role automatically; minor isolated corrections may need none.

## Memory scout handoff

```text
Repository root: [absolute active checkout].
Memory scope: project:zmachine_if_remix_plugin.
Task/gate: [authorized question or change; current G0–G6 boundary].
Relevant paths/concepts: [contracts, probe, decisions, filenames].
Restrictions: retrieval only; no files, shell, memory writes, or delegation.
Retrieve scoped resume and targeted task/file memories. Return useful record
IDs, prior decisions/gotchas, open context, conflicts/staleness, and evidence
that still needs verification. Do not treat a concept approval as runtime proof.
```

Use `mem0ry4ai:memory-scout` for this assignment. Use `zmachine-context-contracts` for the subsequent current-source authority map if needed. The existing plugin server is `plugin:mem0ry4ai:mem0ry4ai`; read-tool names in Zcode normally use `mcp__plugin_mem0ry4ai_mem0ry4ai__`. Use its advertised schema and the generic skill's tool guide; do not confuse contributor memory tools with the product's proposed MCP tools.

## Specialist assignment and return

Give each specialist a complete packet; it must not assume the parent transcript or another worker's findings:

```text
Task ID: zirp-[date]-[sequence].
Objective and acceptance: [one bounded deliverable and how it will be judged].
Repository root/revision: [absolute checkout; commit or working-tree snapshot].
Relevant paths/source packet: [owning sections, exact excerpts if access is missing].
Instructions/decisions: [AGENTS.md; canonical policy sections; relevant D/A/S IDs].
Scope/exclusions: [question; deferred work and neighboring ownership excluded].
Dependencies: [prior findings, relevant memory brief, verified command receipts].
Allowed operations: Read/Grep/Glob only; no writes, commands, network, or delegation.
Budget/escalation: [bounded pass and concrete missing-input conditions].
Return: task ID/status; scope examined; observed/inferred/proposed findings
with path/line or symbol; recommendations and owners; checks not run or supplied
evidence; uncertainties, dependencies, and blockers.
```

Supply exact-story identity and native input boundary for VM questions; transaction/failure/retry examples for persistence; actor/approval channel and host/client for tool questions. State branch/path availability explicitly rather than assuming a dated “main-only” annotation still applies. Missing external evidence is a blocker to that claim, not permission to invent it.

The coordinator reconciles findings against the owning contract, edits, and runs justified checks. An independent reviewer receives the final artifacts and actual evidence, not an instruction to endorse the implementation. Reviewers report defects; they never repair them. Resolve concrete findings and obtain another review when substantive fixes require it.

## Domain and evidence gates

Keep Play/Editor input modes distinct from native/remix/bridged execution routes. Preserve policy/state and permission/capability separation, unknown-state semantics, exact-story coverage, committed narration, protected puzzles, privacy, and the narrow first slice. D01–D37 are conceptual direction; D38 and deferred delivery lanes are not implicitly authorized.

The current repository has isolated feasibility fixture/probe code; it does not yet deliver a product engine. Specifically, the “no code, build, test suite” inventory in `docs/agents/team-coordination.md` §8.1 predates `tests/fixtures/zmachine/` and `experiments/vm-io/`. Use the actual checkout and those READMEs for executable inventory while preserving the policy's ownership and evidence rules. Never turn probe evidence into a product/runtime/language decision. Documentation or agent-setup work does not authorize running a probe.

Select checks from the changed behavior and existing fixture/probe READMEs. Separate static/link/schema checks, deterministic probe tests, native integration/checkpoint coverage, live-model behavior, and actual host/device checks. Record command, working directory, exit status, stdout/stderr, receipt, and limitations. Historical `validation/` files and planned A/S cases are not fresh test passes. Do not fabricate refreshes of those records.

## Closeout and stewardship

Product decisions stay in `docs/decisions/`; probe evidence stays in `docs/evidence/`; team setup evidence belongs in `docs/agents/` when the task calls for it. Do not create a repository Memory Bank or install a memory service. User-level mem0ry4ai can provide permitted reusable contributor context or references to authoritative records, not a parallel decision/status authority.

When worthwhile candidates exist and writing is permitted, give `mem0ry4ai:memory-steward` the explicit project scope, active root, final verified outcome, authoritative paths/receipt references, candidate and rationale, existing IDs, uncertainty/exclusions, write policy, and real resumption need. It searches before saving, skips duplicates, and returns tool-confirmed actions/IDs. It does not edit repository records, write speculative approvals, or run consolidation. A read-only/no-memory-write task skips writing stewardship even if Stop requests it.

End with actual changes/findings, checks and their evidence layers, independent review status, remaining gaps, and the next authorized action. Preserve unrelated work and any still-running command's identity; use the generic heartbeat/checkpoint procedure instead of duplicating long-running work.
