# G4-B bounded behavior evidence

Issue #24 adds a deterministic synthetic overlay scenario. The `synthetic-rules` server profile creates the world through the usual launch and activation path. The test authors and approves the rule through authenticated fixture MCP, speaks the exact gossip, checks the visible pending offer, accepts it in a later turn, and restores pending and consumed states. Fixture authorization uses the existing separate browser control. This evidence covers the engine and loopback MCP adapter. The live chatbot and device trials are owned by #27.

| Requirement | Deterministic evidence |
| --- | --- |
| Composed and persistent behavior | The gossip fixture and a separate Play-generated trader observation use the same registry. They use different entities, topics, and items. SQLite reopen, restore, and signed portable relocation preserve the definitions, evidence, and offer outcomes. |
| A21 and A30 | Root and descendant steps share their limits. Tests reject self-cycles and multi-rule cycles, accept the exact operation/event cap, and roll back one over it. Depth overflow and repeated failed conditions abort. Relationship overflow is tested after speech, belief, and offer have staged. Fault tests cover publication rollback and exact recovery after publication. |
| A07 | The fixture grants an apparent reward while trusted dependencies identify a native progression effect. The full nested footprint reaches the protected vault rule and rejects the entire candidate. Unregistered exits fail schema validation separately. |
| Invalid definitions and authority | Version, executable parameters, unsupported operations, Editor authorization, exact candidate approval, request changes, and a moved reward item are exercised. |
| Replay and A36 | Exact and concurrent MCP retries keep one durable outcome. An absent character does not receive evidence. The nearby character records attributed knowledge while the objective facts retain their values. Public receipts omit private topics and steps. |
| History integrity | Signed portable history with a self-referential cause or reordered receipt events is rejected. Recorded turns validate each cause, rule definition, event order, offer, and source record. |

The added coverage lives in [world tests](../../engine/tests/world.test.ts) and [fixture MCP tests](../../engine/tests/fixture-mcp.test.ts). The default limits are visible in [rule contracts](../../engine/src/world/rule-contracts.ts) and [turn limits](../../engine/src/turn/limits.ts). Reproduce from `engine` with the pinned Node and npm versions.

```text
npm run build
npm run typecheck
npm run lint
npm run test:schema
npm test
```
