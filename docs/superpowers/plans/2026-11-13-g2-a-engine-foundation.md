# G2-A engine foundation

Issue #14 starts after [G1 closed as completed](https://github.com/dhar174/zmachine_if_remix_plugin/issues/4#issuecomment-6847766760), from main at `dfe0966f7a71d9e71790885e000ecc95e80e03de`.

## Ownership

- `engine/src/contracts.ts` owns v1 wire records, strict validation and canonical serialization. The turn, policy and state/VM architecture documents own their meaning.
- `engine/src/ports.ts` owns interfaces for native execution, policy, authorization, candidates, head publication and receipt lookup. It imports no interpreter or host SDK.
- `engine/tests/` owns synthetic records and in-memory doubles. Production policy/compiler, transaction recovery, host approval and native compatibility remain downstream.

## Verification

From `engine/`, use Node 24.13.0 and npm 11.12.1. Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:schema` and `npm test`. The workflow runs these checks on Windows and Ubuntu, with a separate Node 26 job.

The [#31 ownership table](https://github.com/dhar174/zmachine_if_remix_plugin/issues/31) assigns A01–A42. Contract tests support A09 (provenance), A11–A12 (authority), A16 (input discrimination), A25–A27 (idempotency and freshness) and A31–A38 (checkpoint identity and approval boundaries). Those are structural and synthetic checks. Behavioral A-case acceptance stays with the owning issues.

Review the exact final diff with local and hosted receipts. Open one focused PR against main after its separate acceptance review. Keep #14 open and the PR unmerged.
