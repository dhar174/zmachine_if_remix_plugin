# GEMINI.md

Guidance for AI coding agents working in this repository. The canonical instruction file is [AGENTS.md](AGENTS.md) — start there for the repository's purpose, domain rules, privacy boundaries, and evidence discipline. Zcode does not read this file; it exists for Gemini CLI and Antigravity compatibility.

Engineering subagent coordination follows the coordinator-plus-specialist policy in [docs/agents/team-coordination.md](docs/agents/team-coordination.md): the primary agent is the engineering coordinator and the only repository writer; specialist subagents are read-only investigators (`Read`, `Grep`, `Glob`). Antigravity loads the same policy always-on via `.agents/rules/team-coordination.md`.

This file is an entry point, not a second copy of the policy. Where any wording here disagrees with AGENTS.md or the coordination policy, those documents win.

This repository is a documentation-only design proposal: do not implement engine code, run feasibility probes, select runtimes/languages/deployment, or claim runtime/test evidence outside the roadmap's evidence gates (see AGENTS.md and docs/ROADMAP.md).
