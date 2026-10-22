# ADR-0001: Chat-first interface and explicit authorial authority

**Status:** user requirements recorded; technical realization proposed for review.  
**Date:** 2026-10-21.  
**Scope:** documentation only.

## Context

The user selected a chatbot as the main interface and described an initial prompt that controls fidelity, permissible additions, protected content, and later amendments. They explicitly distinguished in-character Play from fourth-wall-breaking Editor instructions. The earlier browser-first draft is historical, not the product brief to implement unchanged.

## Requirements already supplied by the user

AI is a central feature. Original content remains faithful except where user direction changes it or grants bounded generation. The initial directive and later editor specifications persist. Play actions are interpreted in-character against original mechanics and those directives. Editor can change the world and its future rules.

This records the user's requirements. It does not claim that the user has already approved every algorithmic choice in this documentation set.

## Recommended decisions

1. Use a native VM plus a persistent overlay and a sole transactional coordinator; avoid transcript-only state.
2. Separate policy, one-time assignments, invariants, preferences, beliefs, and observations.
3. Store explicit amendment lineage; do not use unconditional last-write-wins across different scopes or treat old editor assignments as permanent constraints.
4. Make Play/Editor explicit control state, independent of native/remix/bridged execution routes.
5. Require complete candidate checkpoints and durable receipts before claiming successful changes.
6. Use chat skills and narrow MCP operations; keep UI optional except a minimal trusted consent surface where the host requires it.

## Decisions still needing evidence or approval

| Decision | Recommended starting point | What must settle it |
| --- | --- | --- |
| Runtime/adapter | Evaluate the prior ZVM candidate and a maintained alternative behind the same adapter | Pinned build; input, snapshot, RNG, conformance and story tests |
| Runtime language | Keep TypeScript as a candidate, not a requirement | Selected VM integration and MCP operational needs |
| Deployment | Compare a private/tunnel service with an authenticated hosted service | Actual host availability, import path, privacy, recovery and operational costs |
| User authorization transport | Use tested host consent or a small authenticated diff approval component | Proof that approval is bound to actual user action and exact change |
| Partial/ambiguous prompt handling | Keep unresolved bundle uncommitted unless user approves a supported subset | Review of desired UX and source-provenance guarantees |
| Clock bridge | Pause native state in extension scenes initially | User-visible acceptance and later synchronized-time design |
| Retcons | Defer general retrospective rewriting; support explicit present-time edits first | Dependency representation and tested consistency restoration |
| Semantic constraints | Structural/adapter enforcement where possible; explicit semantic evaluation and conservative blocking for high-impact uncertainty | Evaluation cases and user-approved trade-offs |

## Consequences

The design trades a little edit-preview friction for consistency and inspectability. It preserves large creative freedom in the overlay without claiming that an LLM can safely patch every native mechanic. Model/provider replacement should not destroy authoritative state because state lives in the engine.

Review this record together with the [design](../superpowers/specs/2026-10-21-chat-first-remix-design.md). Implementation planning and runtime work remain a separate next stage. No branch merge is implied by writing this proposal.
