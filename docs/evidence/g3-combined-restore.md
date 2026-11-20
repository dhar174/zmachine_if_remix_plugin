# Issue #21 combined restore evidence

## Qualification boundary

The fixtures are the synthetic room and the exact bundled, seeded Z5 profile qualified by [Issue #20](g3-native-turns.md). Native combined restore uses the pinned interpreter and the v2 native envelope at line and character prompts. The combined restore worker verifies recapture without supplying game input. The #21 source-derived adapter identity differs from #20. Use a fresh native fixture for qualification.

## Reproduce

From `engine/` on a clean LF checkout:

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm run test:schema
node --test --test-name-pattern 'combined|restore approvals|saved data|upgrade' tests/fixture-mcp.test.ts
npm test
```

From `experiments/vm-checkpoint/`, run `node --test` for the underlying checkpoint suite. The [operator runbook](../contracts/issue-21-restore-runbook.md) describes the private fixtures and exact retry protocol.

| Case | Deterministic evidence |
| --- | --- |
| A28 | Kill the synthetic and pinned native restore processes before staging, after staging, and inside the SQL transaction before commit. Reopen the store and compare the prior combined head. The old browser approval fails and a fresh approval can publish one restore. Run collection while each of the two claim types owns a staged checkpoint and verify the checkpoint survives and publication succeeds. |
| A29 | Kill the synthetic and pinned native restore processes after commit. Reopen and recover the recorded restore result without advancing the head. Simulate a lost response on a committed native character turn and recover its original receipt after restart. Its complete checkpoint remains unchanged on retry. |
| A30 | Across the interrupted fixtures, change the room label and replace a policy protection before restoring. A kill inside publication leaves both changes live. Successful restore returns both to the saved checkpoint under the new head. |
| A31 | Save and restore at actual line and character prompts over loopback MCP. Compare the complete native envelope and machine fingerprint, remix entities, policy and source history, both clocks, and the pending boundary. Restore a saved nonempty policy lineage after another supersession. Continue the menu and compare the output and next seeded roll to reference execution. A synthetic overlay regression restores an earlier nonzero clock and its inventory state. |
| A32 | Reject native save, restore, undo, and restart lines without changing the head. Unsupported character selections are refused, and the registered `q` choice exits the menu to line input. |
| A33 | Save while in Editor and verify restore enters a fresh Play generation with a monotonically advanced world revision and the saved policy revision. Reject old proposals, approvals, directive source references, and a pre-restore lease presented for a fresh candidate. A new lease commits that candidate. Exact old receipts remain available, and recent history excludes displaced receipts both immediately after restore and after a new commit. |
| A34 | Reject incompatible story/runtime/adapter/schema, a future saved revision, malformed and corrupt data, broken event references, and unsupported input. With matching outer digests, native restore rejects invalid opening, truncated Quetzal, and timed continuation data. A structurally valid envelope with incompatible window topology passes browser approval and is rejected by the fresh worker. The synthetic profile rejects a native database restore. Each failure preserves the active combined head. |

The local Windows Node 24 run observed the focused persistence cases and v1/v2 upgrade tests pass. The underlying VM suite passed all 141 tests. The loopback client and owner are scripted. A39 still needs the actual chatbot restore flow in [Issue #27](https://github.com/dhar174/zmachine_if_remix_plugin/issues/27). Timed input, unseeded RNG, native undo history, graphics and audio remain outside this qualification.
