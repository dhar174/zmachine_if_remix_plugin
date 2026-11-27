# G4-B bounded behavior evidence

Issue #24 adds a deterministic synthetic overlay scenario. The `synthetic-rules` server profile creates the world through the usual launch and activation path. The test authors and approves the rule through authenticated fixture MCP, speaks the exact gossip, checks the visible pending offer, accepts it in a later turn, and restores pending and consumed states. Fixture authorization uses the existing separate browser control. This evidence covers the engine and loopback MCP adapter. The live chatbot and device trials are owned by #27.

| Requirement | Deterministic evidence |
| --- | --- |
| Composed and persistent behavior | The gossip fixture and a separate Play-generated trader observation use the same registry. They use different entities, topics, and items. SQLite reopen, restore, and signed portable relocation preserve the definitions, evidence, and offer outcomes. |
| A21 and A30 | Root and descendant steps share their limits. Tests reject self-cycles and multi-rule cycles, accept the exact operation/event cap, and roll back one over it. Depth overflow and repeated failed conditions abort. Relationship overflow is tested after speech, belief, and offer have staged. A clock-controlled test expires the shared deadline at publication and verifies rollback and retry. Fault tests cover publication rollback and exact recovery after publication. |
| A07 | Trusted dependencies reach the protected vault rule from initial speech, rule installation, a manual handoff, and a nested reward transfer. Each tested rejection leaves the committed world unchanged. A separate check verifies that each eligibility consequence includes the container and actor reads. Unregistered exits fail schema validation. |
| Invalid definitions and authority | Version, executable parameters, unsupported operations, Editor authorization, exact candidate approval, request changes, and a moved reward item are exercised. |
| Replay and A36 | Exact and concurrent MCP retries return the same receipt. A competing acceptance goes stale, and a direct engine proposal can accept at most one offer. Native input and overlay speech with identical text use separate request bindings. An absent character does not receive evidence. The nearby character records attributed knowledge while the objective facts retain their values. Public receipts omit private topics and steps. |
| History integrity | Signed portable histories with pending and consumed offers pass codec validation and relocation. Separate cases reject a self-referential cause, reordered receipt events, a missing or incorrect footprint, a false condition, and an omitted cascade. |

## Version 2 coverage for PR #90 fixes

[PR #90](https://github.com/dhar174/zmachine_if_remix_plugin/pull/90) introduced the shared observation, narration, and portable receipt checks. PR #91 exercises these checks through the version 2 world and typed fixture actions.

| Issue | Regression evidence |
| --- | --- |
| [#87](https://github.com/dhar174/zmachine_if_remix_plugin/issues/87) | Both world versions reject an off-scene observation in Play. The image validator, SQLite ancestry check, and signed decoder reject matching forged observation bodies. The same-room observation passes all three checks and still supports a later belief. [World test](../../engine/tests/world.test.ts#L1490) |
| [#88](https://github.com/dhar174/zmachine_if_remix_plugin/issues/88) | Authenticated MCP history, exact lookup, prepare replay, and commit replay all withhold off-scene prose in a stored version 2 offer receipt. A genuine offer note survives when the two are mixed. [MCP test](../../engine/tests/fixture-mcp.test.ts#L286) · [Native prose control](../../engine/tests/world.test.ts#L1552) |
| [#89](https://github.com/dhar174/zmachine_if_remix_plugin/issues/89) | A valid mixed-version history decodes and relocates with its fictional IDs, event bodies, and receipt event count intact. A signed copy reusing an external receipt event ID across versions fails decoding. A separate version 1 history supports continued native and remix play after import into fresh SQLite. [Mixed-version test](../../engine/tests/world.test.ts#L1583) · [Fresh-SQLite control](../../engine/tests/world.test.ts#L1326) |

The added coverage lives in [world tests](../../engine/tests/world.test.ts) and [fixture MCP tests](../../engine/tests/fixture-mcp.test.ts). The default limits are visible in [rule contracts](../../engine/src/world/rule-contracts.ts) and [turn limits](../../engine/src/turn/limits.ts). Reproduce from `engine` with the pinned Node and npm versions.

```text
npm run build
npm run typecheck
npm run lint
npm run test:schema
npm test
```
