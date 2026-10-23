---
name: zmachine-remix-engineering
description: Plan, implement, debug, and review scoped engineering changes for zmachine_if_remix_plugin. Use for Z-machine runtime and story-adapter work, fixtures and native I/O, directive and policy semantics, transactional turns, combined persistence, chat-host tools, narration grounding, and their documentation or tests. Preserve approved project decisions, exact-story capability boundaries, and evidence gates. This is a development skill, not a skill for playing a story or installing a particular agent harness.
---

# Z-machine Remix Engineering

Deliver the smallest complete change authorized by the task. Preserve real native execution, durable remix state, and narration grounded in committed results. Treat this skill as an engineering procedure; it does not approve a roadmap stage, choose a runtime, or supply a product capability.

Use ordinary file inspection, search, editing, and verification facilities available in the host. No particular agent platform, model, command syntax, package manager, or subagent API is required. Resolve links below relative to this skill directory; resolve repository paths inside references relative to the target checkout.

## 1. Establish the working contract

Before substantive work:

1. Identify the repository root, branch, commit, working-tree changes, requested outcome, and relevant issue/PR or approved task. Preserve unrelated work.
2. Read applicable repository instructions, including `AGENTS.md` and any narrower instructions. Read `docs/agents/team-coordination.md` before assigning or acting as an engineering specialist.
3. Recover the relevant accepted decisions, owning contract, current roadmap gate, and acceptance cases using [repository map](references/repository-map.md). Distinguish **approved behavior**, **proposed mechanisms**, **deferred scope**, and **demonstrated implementation**.
4. Verify which source files, manifests, tests, commands, and capabilities actually exist. The dated baseline in the map is a starting point; refresh it from the checkout and current task evidence. Never infer a stack from `.gitignore`, a runtime from a design name, or test results from a planned matrix.
5. Resolve material contradictions against exact approvals and the owning documents. Record a real conflict rather than silently choosing convenient wording. Reuse authorization already granted for this scope; ask only about a decision that actually blocks the requested work.

For a small isolated documentation correction, inspect only the relevant instructions and owning section. Do not turn every edit into a full architecture audit.

## 2. Load only the relevant modules

| Task touches | Read |
| --- | --- |
| Current architecture, decisions, scope, or gates | [Repository map](references/repository-map.md) |
| Story bytes, interpreter behavior, native I/O, adapters, fixtures, or save formats | [Z-machine and VM boundaries](references/zmachine-vm.md) |
| Directive compilation, permissions, invariants, generation, narrative facts, or knowledge | [Policy and world semantics](references/policy-and-world.md) |
| Turn execution, clocks, candidates, retries, save/restore, or concurrency | [Turns and recovery](references/turns-and-recovery.md) |
| MCP/tool schemas, trusted approval, file import, host integration, or product skills | [Host and tool boundaries](references/host-and-tools.md) |
| Verification planning, regression selection, independent review, or evidence reports | [Verification](references/verification.md) |

Read the corresponding repository-owned contract before changing its subject. These references are engineering aids, not parallel specifications. Their summaries yield to current accepted project contracts; external standards determine VM/format semantics. Surface an actual conflict between those authorities.

## 3. Preserve the non-negotiable distinctions

- **Play / Editor are input modes.** Native / remix / bridged are execution routes. A Play claim or attempted action cannot authorize an Editor change.
- **Policy is not state.** A one-time assignment, persistent invariant, permission/prohibition, presentation preference, and unresolved clause have different effects. Giving a key once must not recreate it after the player drops it.
- **Permission is not capability.** Native changes require verified coverage bound to the exact story and runtime/adapter build. Object access alone does not establish puzzle, teleportation, or character-takeover semantics.
- **Unknown is not false.** Parser rejection, incomplete inspection, and unmapped state do not prove nonexistence or impossibility.
- **Each mutable field has one owner.** Cross-owner effects require an explicit tested bridge. Unified presentation does not create shared write ownership.
- **Proposals and narration do not commit facts.** Consequential entities, exits, promises, beliefs, rule changes, and outcomes require validated events/state. Correct unsupported prose instead of mutating the world to justify it.
- **Recovery spans the whole session.** Native state, remix state, policy, clocks, and relevant execution continuations must remain coherent. Current authorization is outside historical game state.
- **Engineering agents are development assistants.** They are separate from product AI components and the runtime turn coordinator. Follow the repository's current writer/reviewer policy.

## 4. Bound the change before editing

Prepare a compact task contract, scaled to the work:

> **Outcome and authorization:** requested result, permitted stage, source of approval.
>
> **Baseline and owners:** revision, relevant contracts, implementation paths.
>
> **Scope:** included behavior, exclusions, compatibility boundaries.
>
> **Proof:** affected A/S cases or new behavior assertions, fixtures, checks.
>
> **Stop:** dependency or evidence that would block this slice.

For cross-boundary changes, trace: **input → authority → state owner → execution → complete effects → commit/receipt → visible output**. Identify failure and retry behavior at the same time. For a VM change, add story version, opcode/format, specification clauses, and supported input boundaries.

Proceed with routine reversible choices inside the authorized scope. If a required runtime, approval mechanism, or contract is undecided, complete useful investigation and prepare a bounded proposal. Do not turn a documentation request into probe execution, a probe into production scaffolding, or an approved future concept into a release requirement.

## 5. Implement through the existing boundaries

1. Inspect the smallest relevant call path and existing examples/tests. Reproduce the defect or state the new observable behavior before changing it.
2. Prefer existing interfaces and a narrow adapter over rewriting an interpreter, inventing another state store, or introducing a framework. Verify current primary runtime/SDK documentation when relying on external APIs.
3. Keep model proposals as typed data. Enforce authority, capabilities, revisions, budgets, and mutation in deterministic service code. Do not expose arbitrary memory writes or executable generated rules.
4. For state changes, stage an isolated candidate, validate complete effects, and publish only a committed receipt. Preserve native failed-action time costs; keep rejected proposals and read-only queries nonmutating.
5. Add meaningful regression coverage for changed behavior and adjacent risks. Avoid tests that merely repeat implementation details, broad dependency updates, unrelated refactors, or fabricated compatibility.
6. Update the owning documentation when behavior or a contract changes. Version breaking schemas/checkpoints and provide the required migration or explicit incompatibility behavior. Do not silently accept extra fields to accommodate unfinished features.

Use read-only specialist investigation and independent review where the repository requires them. Supply the exact snapshot, objective, relevant sources, permitted tools, exclusions, and expected evidence. If delegation is unavailable, perform the analysis directly and identify any unmet independent-review gate.

## 6. Verify and close the authorized slice

Select checks from [verification](references/verification.md) according to changed behavior. Separate static checks, deterministic tests, native integration, live-model evaluation, and actual host/device trials. Report the exact commands and results; distinguish passing, failing, blocked, and not run. A successful lower layer does not prove a higher one.

Stop only the affected work when scope/authorization is missing, a material contract conflicts, required recovery or native-effect coverage is unproven, or the relevant host boundary cannot be verified. Continue independent authorized work and describe the smallest resolution. Do not repeat approval requests already settled by the task.

Finish with:

- Result and changed paths, with the baseline/final revision where available.
- Why the change satisfies the requested behavior and relevant decision/acceptance IDs.
- Verification evidence, independent-review result, and remaining limitations.
- The next bounded action, if needed, without executing a later gate by implication.

Do not claim installation, invocation, runtime compatibility, deployment, merge, or release from source files alone. Do not add private stories, saves, transcripts, credentials, or extracted proprietary text to this public repository.
