# Z-Machine IF Remix Plugin

**Design status (2026-10-22):** [Issue #10 Decisions D01–D37](docs/decisions/decision-register.md) were approved conceptually and are consolidated for documentation review. The engine, native bridges, cross-chat hosting, and advanced multiverse systems are **not implemented or verified** by this approval. [Reconciliation](docs/decisions/contract-reconciliation.md) · [G1 feasibility probes](docs/ROADMAP.md). Decision D38 remains unapproved.

**An AI-first, chat-driven way to play and deliberately remix classic interactive fiction.**

The original game remains the default authority for its fiction and mechanics. A user's initial remix prompt defines permitted changes, protected content, and where spontaneous generation is allowed. Later editor instructions can revise that agreement. Ordinary play remains in-character: an attempted action is not permission to rewrite reality.

> **Status: design proposal, not a playable plugin.** This repository contains specifications and illustrative contracts. No interpreter integration, MCP service, working skill package, deployment, or runtime test suite is delivered by this documentation change.

## The experience

When a story loads, describe the remix you want. For example:

> Preserve the original plot and puzzles. Let me explore beyond the original map, but do not invent shortcuts around existing puzzle gates. Let characters respond naturally to new events without changing their established personalities.

Use **Play Mode** for actions and dialogue: “I tell the bartender we are old friends.” That records a claim or attempt, not a new shared history.

Use **Editor Mode** for authorial specifications: “The bartender and I really are old friends; add that to our shared history.” This proposes an explicit, inspectable change. Historical changes require a supported retcon operation rather than an unnoticed rewrite.

The initial prompt and editor instructions can change both **world state** and **world policy**, but those are different operations. “Give me a key” changes state once. “Allow new shops beyond the original map” changes future generation permissions. Neither turns every future play utterance into an editor command.

## Proposed architecture

```text
User in a chatbot
    -> AI interpretation and creative proposals
    -> typed, capability-limited MCP tools
    -> policy + transaction coordinator
         -> original Z-machine interpreter and verified story adapter
         -> persistent remix entities, behavior rules, and event history
    -> committed results for AI narration
```

AI is a core product feature. Deterministic engine operations are the mechanism that makes AI-created changes durable and testable, not an alternative product without AI. A custom UI is optional and secondary; a map or approval panel should not become a mandatory nested terminal.

## Start reading

| Document | Purpose |
| --- | --- |
| [Design v0.2](docs/superpowers/specs/2026-10-21-chat-first-remix-design.md) | User requirements, architecture, alternatives, scope, review boundary |
| [World policy and directive schema](docs/architecture/world-policy.md) | Initial prompt compilation, permissions, protections, precedence |
| [Turn-resolution algorithm](docs/architecture/turn-resolution.md) | Play and Editor paths, validation, commit, failure recovery |
| [State and VM bridge](docs/architecture/state-and-vm-bridge.md) | Native/overlay ownership, checkpoints, clocks, saves, unknowns |
| [Plugin and tool contract](docs/architecture/plugin-contract.md) | Skills, MCP tools, authorization and deployment constraints |
| [Acceptance matrix](docs/quality/acceptance-matrix.md) | Observable evidence needed before claiming features work |
| [Roadmap](docs/ROADMAP.md) | Dependency-ordered milestones and stop gates |
| [Documentation index](docs/README.md) | Examples, draft schema, decisions, references, archived draft |

## Boundaries

The engine must not silently solve protected puzzles, promote dialogue into tool authority, invent successful state changes in narration, or treat an unrecognized parser command as proof that an action is impossible. Original and added content must remain coherent across undo, restore, and new chat sessions.

Native editing is limited to verified capabilities for the exact story build. New content normally lives in the remix world. “AI can describe it” is not proof that the native VM can represent it. Unsupported mechanics require a real implementation or an explicitly approved narrative abstraction.

## Story files and privacy

Do not commit user-uploaded story binaries, save states, transcripts, credentials, or extracted copyrighted text collections to this public repository. Distribute the engine separately. Hosted processing requires an explicit import flow and disclosure of what leaves the user's device; a local file selection is not automatically a local-only runtime.

The earlier [v0.1 draft](docs/design_draft_v0.1.md) is retained as historical context. Its browser-first, optional-AI product direction is superseded by the user requirements captured in v0.2. Its unverified runtime assumptions are not promoted into implementation claims.
