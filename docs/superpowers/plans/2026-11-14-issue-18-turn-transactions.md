# #18 implementation plan and ownership

Baseline: main at 398d5aeb5dc0a3d5e38d6a31fc4a13b4737b9f3d (PR #79). Issue #18 joins #14 contracts, #15 compiled policy, #16 resolution and #17 authority. Recovery evidence from #12 informs the fixture. See the [transaction contract](../../contracts/turn-transactions.md).

1. Bind an authenticated request and its original envelope and proposal digests. Build the isolated executor and contract tests before adding publication.
2. Adapt #17 persistence without duplicating its authority rules. Publish head, events, receipt, idempotency and authority use in one SQLite transaction, with the immutable checkpoint already durable.
3. Run the focused negative, concurrency and acknowledged child interruption cases. Confirm the complete engine checks and review the exact diff and receipts independently before opening the PR.

| Owner within #18 | Scope |
| --- | --- |
| Turn service | Request binding, preflight, isolated execution, observed effects and receipt |
| SQLite adapter | Checkpoint ordering, publication, coordinator fencing and cleanup |
| Existing #17 authority | Mode, browser approval, exact diff, expiry, leases and revocation |
| Fixture and tests | Deterministic native/overlay behavior and failure evidence |

#19 owns live host qualification, #20 owns real adapter support, and #21 owns user-facing combined recovery, saves and branching. Use purpose-built fixtures only. PR and issue stay open for owner review.
