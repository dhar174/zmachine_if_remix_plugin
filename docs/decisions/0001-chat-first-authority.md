# ADR-0001: Chat-first interface and explicit authorial authority

**Status:** user requirements and Decisions D01–D37 approved conceptually; detailed runtime/host realization awaits G1 evidence. D38 not approved.  
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

## G1 technology decisions and remaining contract evidence

| Decision | Recommended starting point | What must settle it |
| --- | --- | --- |
| Runtime/adapter | Evaluate the prior ZVM candidate and a maintained alternative behind the same adapter | Pinned build; input, snapshot, RNG, conformance and story tests |
| Runtime language | Keep TypeScript as a candidate, not a requirement | Selected VM integration and MCP operational needs |
| Deployment | Compare a private/tunnel service with an authenticated hosted service | Actual host availability, import path, privacy, recovery and operational costs |
| User authorization transport | Use tested host consent or a small authenticated diff approval component | Proof that approval is bound to actual user action and exact change |


## Consequences

The design trades a little edit-preview friction for consistency and inspectability. It preserves large creative freedom in the overlay without claiming that an LLM can safely patch every native mechanic. Model/provider replacement should not destroy authoritative state because state lives in the engine.

Review this record together with the [design](../superpowers/specs/2026-10-21-chat-first-remix-design.md). Implementation planning and runtime work remain a separate next stage. No branch merge is implied by writing this proposal.

## Decision register and normative scope of approval

Charles approved **D01–D37, each as Option B**, with full reasoning and source links in the [decision register](decision-register.md). The [contract reconciliation](contract-reconciliation.md) clarifies scope and resolves v0.2 wording that might otherwise conflict with these approvals. In particular: guided partial initial-argument acceptance (D01); natural-language scoped supersession (D02); risk-based confirmation (D10); paused-native **default** clock with future proven alternatives (D07); retcons (D08) **approved as future architecture, not v1 functionality**; risk-sensitive semantic fidelity review (D06); and cross-game/cross-user features (D29–D37) deferred.

D38 (publisher package updates/revocation) was discussed but **not approved** and must not be inferred. Runtime, language, hosting, exact approval mechanism, file import and client compatibility remain G1 evidence gates. This ADR records architectural acceptance but does not approve implementation plans, source changes, release or model spend.
