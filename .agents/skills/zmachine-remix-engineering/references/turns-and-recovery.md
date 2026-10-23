# Turns, clocks, and combined recovery

Owning sources: `docs/architecture/turn-resolution.md` §§2–7 and accepted refinements; `docs/architecture/state-and-vm-bridge.md` §§2, 5–9. Use the current implemented types when available; the baseline envelope/tool names are conceptual contracts.

## Trace one logical turn

1. Authenticate access. Resolve the idempotency identity and canonical payload digest. A completed identical request returns its receipt; changed payload under the same identity conflicts; concurrent duplicates must not execute twice.
2. Capture a consistent session/branch generation, world revision, policy revision, server-owned mode/lease, capability manifest, and pending input kind.
3. Obtain bounded context and model proposals without holding the commit lock. Resolve entities, ownership, preconditions, full effects, time semantics, and unresolved judgments.
4. Validate authority, current policy, capabilities, budgets, and required recovery support. Bind any required approval to the actual candidate/diff and scope.
5. Restore an isolated candidate and execute one logical native/remix/bridged turn. Buffer consequential output until commit. Rejecting a candidate must discard its memory, stack, RNG, clocks, pending I/O, events, and output effects.
6. Verify actual effects and postconditions. Serialize and durably persist the complete checkpoint before publishing references to it.
7. At a short commit boundary, revalidate freshness, mode/approval validity, world and policy revisions. Atomically publish the new head, events, receipt, and idempotency result. Discard stale candidates; do not silently rerun their old plan on a changed world.
8. Narrate only receipt-authorized facts. Recover cached live processes from the committed head, never treat a live singleton as independent permanent truth.

Do not add speculative native command attempts before complete relevant recovery is proven. Where the contract permits one explicitly selected native attempt, report its actual result; do not append an unrequested AI fallback after a committed native failure.

## Distinguish time and failure

| Situation | Required behavior |
| --- | --- |
| Rejected proposal, clarification, read-only inspection/hint | No world/time change |
| Native action fails in fiction but advances a timer | Commit that failed action and its actual time/effects once |
| Editor operation | No fictional time; no catch-up turn on return to Play |
| Extension scene | Pause native execution/timers by default; eligible committed overlay Play turns may advance overlay time |
| Model latency, idle chat, input polling | No extra gameplay turns |
| Supported native timed-input callback | Preserve verified native clock/interrupt semantics; do not assume automatic freezing while a model responds |
| Rule budget exhaustion | Abort candidate; no partial cascade |
| Compound command | Validate sequential subturns against each newly committed state; retain separate receipts and stop at failure, ambiguity, choice, surprise, or limit |

Do not obtain read-only inventory by executing native `LOOK`/`INVENTORY`. If the user explicitly requests a native command, apply its measured native semantics. Do not infer parser success/failure solely from output keywords.

## Define the snapshot before implementing restore

Include exact story/runtime/adapter/schema identity; VM memory, PC, frames/stacks, continuations and relevant I/O/timers/RNG; overlay entities/relationships/beliefs/rules/events; policy/source lineage; native/overlay clocks; immutable history/receipts and branch ancestry. Inventory runtime-owned state outside VM memory. State which boundaries and optional features are unsupported.

Native SAVE/RESTORE/UNDO/restart must coordinate both worlds or return an explicit limitation. A native-only export is labeled as such. Stored generated content and recorded draws support reconstruction; fresh model generation is not replay.

Restore game state into a fresh monotonic session generation/head. Preserve historical receipts and branch provenance. Do not resurrect authorization: invalidate old candidates, approvals, and Editor leases, and return to Play unless separately reauthorized. Bind idempotency to the correct generation so historical IDs cannot collide with a new branch.

Reject wrong story/runtime/schema, corrupt bytes, unsupported pending input, and failed migration without changing the active session. Migrate through a tested new copy/revision rather than reinterpreting bytes in place. Mark stale transcript events; rollback cannot erase spoilers the user/model has already seen.

## Prove crash and retry behavior

Inject failure before blob durability, before head publication, and after durable publication but before response. Before commit, the old head remains authoritative; orphan candidate blobs may be collected. After commit, retry returns the same saved receipt without repeating native execution. Verify concurrency with two candidates at the same head and a policy change while a model proposal is pending.

At G1-B, prove runtime recreation and candidate isolation only; do not describe that as atomic database persistence or host proof. At the authorized transactional stage, demonstrate storage ordering and receipt atomicity with actual failure injection.

Relevant regressions: A14–A16, A21–A34; S03, S05–S06, S10–S12. Include the narrow acceptance cases that cross a changed boundary.
