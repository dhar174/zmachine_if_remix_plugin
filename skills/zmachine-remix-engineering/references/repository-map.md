# Repository map and scope recovery

## Verified baseline; refresh before use

Repository: [`dhar174/zmachine_if_remix_plugin`](https://github.com/dhar174/zmachine_if_remix_plugin). Inspected `main` at [`a0c6e23b2946c1975d931d596774a68b006ca840`](https://github.com/dhar174/zmachine_if_remix_plugin/tree/a0c6e23b2946c1975d931d596774a68b006ca840), 2026-10-22, after PRs #33 and #34.

At that revision, the tree contains design documents, a proposed policy schema, examples, historical validation receipts, and engineering-agent definitions. It has **no runtime source, package/build manifest, executable product tests, or CI**. Issue #10 is closed; Issue #11 remains open. Older prose describing G0 review or an unmerged branch is historical context, not current issue/branch evidence.

Do not keep this baseline frozen. Inspect the actual checkout and any task-supplied newer approvals. Report unavailable remote evidence rather than inventing it. Use a dated observation for status and accepted records for authority; neither issue closure nor a merge independently proves a runtime capability.

## Source ownership

All paths below are repository-relative. Read relevant sections, not every file on every task.

| Question | Source |
| --- | --- |
| Agent duties and permitted delegation | `AGENTS.md`; `docs/agents/team-coordination.md`; narrower instructions |
| Product purpose, R1–R6, reading order | `docs/README.md`; `docs/superpowers/specs/2026-10-21-chat-first-remix-design.md` |
| Approved intent and remaining choices | `docs/decisions/decision-register.md`; `contract-reconciliation.md`; `0001-chat-first-authority.md` in that directory; exact linked approvals when ambiguous |
| Policy classification, scopes, supersession, generation | `docs/architecture/world-policy.md` |
| Play/Editor execution, candidate validation, receipts | `docs/architecture/turn-resolution.md` |
| Native ownership, capabilities, combined state, recovery | `docs/architecture/state-and-vm-bridge.md` |
| Product skills/tools, user trust, host/import boundaries | `docs/architecture/plugin-contract.md` |
| Structural policy shape and example | `docs/contracts/remix-directive.schema.json`; `docs/examples/initial-policy.json` |
| Acceptance evidence and delivery lanes | `docs/quality/acceptance-matrix.md`; `decision-acceptance-supplement.md` in that directory |
| Sequencing, authorization boundaries, probes | `docs/ROADMAP.md`; relevant approved task; `docs/superpowers/plans/` |
| External technical references | `docs/REFERENCES.md`; primary standards/runtime documentation |

Apply explicit accepted refinements in the decision register/reconciliation when they clarify older v0.2 text. Examples and the archived `docs/design_draft_v0.1.md` do not override normative contracts. Historical validation files under `validation/` are receipts for their recorded revision; never hand-edit them to appear current.

## Approved direction versus delivery scope

At the baseline, D01–D37 are conceptually approved; D38 remains unapproved. Runtime, language, deployment, host approval/import, numeric budgets, and detailed schemas still require evidence or review.

- Preserve R1–R6: faithful authored behavior by default, an initial directive, explicit Play/Editor control, durable user direction, chat-first AI participation, and actual committed state.
- Keep D08 general retcons and D29–D37 branch merging/cross-game identity/synchronization/sharing outside the initial G0–G6 sequence unless later explicitly scoped.
- Treat D14–D16 and D19–D24 as later delivery, with only the currently authorized narrow dependencies in core work. A policy direction does not require implementing its entire subsystem.
- Preserve D27–D28 continuity across chats/models and revision-aware concurrent clients as core integrity requirements.
- Keep S17–S23 future scenarios from silently becoming initial-release requirements. Do not invent a D38 acceptance case.

## Gate routing

| Gate/task | Work to prepare or perform only within its authorization | Evidence boundary |
| --- | --- | --- |
| G0 | Reconcile contracts and exact owner decisions | Documentation approval is not runtime proof |
| G1-A / #11 | Original redistributable Z5 fixture; compare candidate native I/O under one experimental protocol | First prompt and useful I/O do not prove recovery or select a production runtime |
| G1-B / #12 | Checkpoint, recreate, restore, continue; discarded-candidate isolation | Memory copies or native SAVE alone do not prove complete application recovery |
| G1-C / #13 | Actual intended host, user-bound approval, private import | Desktop results do not prove mobile behavior or trusted intent |
| G2–G3 | Authorized policy/transaction kernel, live AI contract feedback, native play and combined persistence | Preserve earlier evidence prerequisites |
| G4–G5 | One persistent remix slice and one narrow verified native bridge | Do not generalize one anchor/mutation to arbitrary story editing |
| G6 | Declared support, privacy, hardening, release evidence | Release/deployment requires its own scope and evidence |

The baseline probe briefs are `2026-10-22-g1-a-native-io-probe.md`, `2026-10-22-g1-b-checkpoint-probe.md`, and `2026-10-22-g1-c-chat-host-probe.md` under `docs/superpowers/plans/`. Recheck their current status. Do not prescribe an interpreter from an old candidate name or turn throwaway probe code into a production dependency without review.
