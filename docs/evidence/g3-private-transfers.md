# Issue #22 private transfer qualification

The implementation starts from `f4f56cef8a4346f8cc84af734dca3fbee0d2c555`. The exact [Heidi build](../../tests/fixtures/zmachine/heidi/README.md) is a separate trial candidate. Heidi uses its authored opening and reaches native tick zero without a parser setup command. Inform initialization uses a reproducibly seeded startup stream on bootstrap and fresh-worker recovery. After the first prompt the codec preserves the VM RNG. Continuation refuses a return to unseeded randomness. The qualified sequence covers the authored route through the ending.

## Reproduce local evidence

From `engine/` on a clean LF checkout with dependencies installed:

```sh
npm run build
npm run typecheck
npm run lint
npm run test:schema
node --test --test-name-pattern 'private portable' tests/fixture-mcp.test.ts
npm test
```

Run `node --test` in `experiments/vm-checkpoint/` for the underlying VM tests.

| Issue acceptance | Evidence |
| --- | --- |
| A38 and A40, actual approved host upload | The local suite uses two scripted authenticated principals. It checks wrong-owner and replay denial and simultaneous redemptions. Owner-operated upload and ChatGPT web invocation require a run on the authorized private route. |
| A34, malformed or incompatible data | Local scenarios cover oversize, wrong version, changed bytes, a truncated package and a package paired with another supported story. They inject an interruption before SQL commit and check that no head, checkpoint or receipt was published. |
| Combined recovery | Scripted browser and loopback MCP scenarios transfer the seeded fixture at line and character prompts and Heidi while carrying the bird, from one SQLite store to a fresh store. They compare persisted checkpoint, policy and history, then continue the native game after restart. |
| A42, indirect export or unrelated action | Private file actions use authenticated browser routes. The packaged skill gives export directions for explicit user requests. Record actual adversarial behavior on web Chat before closure. |
| Retention, revocation and deletion | Local scenarios cover expiry, revocation, one-use downloads, same-request import recovery, deletion, and isolation from a second owner’s retained copy. Backup and ChatGPT retention have their own documented boundaries. |
| Repository and CI privacy | Tests use the project fixture and independently licensed Heidi assets. Inspect and redact any host evidence before publication. |

For the live run, record the tested ChatGPT account type, web mode, model label when available, and plugin release and tool entry point. The owner operates selection, consent and download. Record the opening, save, export, import into a fresh store, resume and deletion for both stories. Observe the response and service state when story text asks for export, publication, an arbitrary fetch, or an unrelated tool. Redact test receipts. Hosted CI and qualified independent review are separate closure gates.
