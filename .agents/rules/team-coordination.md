---
trigger: always_on
description: Engineering team coordination for zmachine_if_remix_plugin - coordinator/writer model, read-only specialists, evidence discipline, roadmap gates
---

# Team coordination (entry point)

This repository uses a coordinator-plus-specialist model for agent-assisted engineering work. The full policy — roles, routing table, assignment and return contracts, shared invariants — is `docs/agents/team-coordination.md`; read it before dispatching or acting as a specialist. Repository invariants live in root `AGENTS.md`.

- The primary agent is the engineering coordinator and the **only** repository writer. Specialist subagents are read-only investigators (`Read`, `Grep`, `Glob`): they do not edit files, run commands, or dispatch other agents.
- Specialist recommendations are not owner approval. Decisions D01–D37 (GitHub Issue #10) are settled direction; D38 is unresolved; runtime, language, deployment, approval transport, and budgets remain evidence gates.
- These engineering agents are development assistants only — separate from in-game characters, the product's AI components, and the runtime turn/transaction coordinator described in the design docs.
- This is a documentation-only repository: no engine implementation, feasibility-probe execution, interpreter download, model spend, or runtime/test claims outside the `docs/ROADMAP.md` evidence gates. Never place user story binaries, save states, transcripts, or credentials in this public repository.

Zcode specialist definitions live in `.zcode/agents/` (source templates; install per `docs/agents/README.md`). Antigravity does not load them — if specialist invocation is unavailable, perform the checks in the primary agent and state that independent subagent review did not occur.
