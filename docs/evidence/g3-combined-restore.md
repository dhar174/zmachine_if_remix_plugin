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
| A28 | Kill the restore process before staging, after staging, and after publication writes inside the SQL transaction but before commit. Reopen the store and compare the prior combined head. Only staged unpublished checkpoints are collectable. The old browser approval fails and a fresh approval can publish one restore. |
| A29 | Kill the pinned native restore process after commit. Reopen and recover the recorded restore result without advancing the head. Simulate a lost response on a committed native character turn and recover its original receipt after restart. Its complete checkpoint remains unchanged on retry. |
| A30 | Across the interrupted fixtures, change the room label and replace a policy protection before restoring. A kill inside publication leaves both changes live. Successful restore returns both to the saved checkpoint under the new head. |
| A31 | Save and restore at actual line and character prompts over loopback MCP. Compare the complete native envelope and machine fingerprint, remix entities, policy and source history, both clocks, and the pending boundary. Continue the character menu and compare the output and next seeded roll to reference execution. |
| A32 | Reject native save, restore, undo, and restart lines without changing the head. Unsupported character selections are refused, and the registered `q` choice exits the menu to line input. |
| A33 | Verify a fresh generation, monotonically advanced world revision, restored policy revision, and Play mode. Old proposals and browser approvals fail, old receipts remain available by exact identity, and the new generation can reuse a request ID. Recent history excludes displaced receipts. |
| A34 | Inject incompatible story/runtime/adapter/schema, malformed and corrupt images, broken event references, and an unsupported input boundary. Compare the active combined head before and after refusal. |

The local Windows Node 24 run observed the focused persistence cases and v1/v2 upgrade tests pass. The underlying VM suite passed all 141 tests. The loopback client and owner are scripted. A39 still needs the actual chatbot restore flow in [Issue #27](https://github.com/dhar174/zmachine_if_remix_plugin/issues/27). Timed input, unseeded RNG, native undo history, graphics and audio remain outside this qualification.
