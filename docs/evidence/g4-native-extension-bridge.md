# G4-C native extension bridge evidence

The seeded Z5 fixture exposes one bridge at the F11 basalt pedestal in Records Vault. The capability requires the exact fixture digest `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, the current `nativeIdentity()` runtime and adapter builds, and the existing `format:ifvms-v2` checkpoint. The decoded checkpoint must be at a nonterminal line prompt in Records Vault with the native vault door unlocked and open. [Issue #25](https://github.com/dhar174/zmachine_if_remix_plugin/issues/25) · [Anchor checks](../../engine/src/turn/extension-bridge.ts) · [Fixture source](../../tests/fixtures/zmachine/fixture.inf)

Authenticated approval in Editor authors one persistent location and a dormant overlay avatar. A separate, explicit Play action switches the active scene to that room. The bridge keeps the exact native payload, input boundary, and native tick in the combined checkpoint and binds the capsule to the entry proposal. Return verifies that a fresh native worker can recreate and recapture the same checkpoint without sending game input. The overlay remains saved and becomes active again on a later visit. Both crossings cost zero. [MCP contract](../../plugin/references/fixture-mcp.v1.md#pedestal-extension)

| Requirement | Deterministic regression evidence |
| --- | --- |
| A07 | The native `north` attempt at the locked door fails. The passage cannot enter an unregistered room. Scoped connection denials on the Records Vault endpoint or the vault door block the authoring preview. The loopback test also commits a scoped door denial through authenticated Editor approval and verifies the rejection through MCP. Proposals for a generated connection in either direction or a connection from the room to itself fail before staging. The authorized authoring preview includes the passage and the exact approved room text. |
| A17 | The anchor check rejects a different story digest, runtime or adapter build, or halted boundary. MCP rejects the wrong or absent anchor, an unsupported character boundary, an unregistered destination, a return from the native side, and an extension noun sent as native input. Both MCP and the lower-level turn API reject native input while paused. Inventory-transfer proposals in either direction fail without changing the active head. |
| A22 | Authored entry, inspection, exact Editor description assignment, return, and repeat entry preserve the native clock. Speech adds one overlay tick. Entry, return, reads, and authoring use zero ticks. A direct VM control starts at the pre-entry checkpoint and produces the same next `roll` output and full captured checkpoint as the resumed service, including the RNG, native location, and timer state represented by that checkpoint. |
| A31 | Combined restore from before authoring, from inside, and from outside restores the active owner, clocks, and input boundary under a new Play generation. The same room ID preserves its approved description on re-entry. A competing candidate becomes stale. An interruption before commit leaves the original head, and a lost return response is recovered after SQLite reopen with the original committed receipt. A signed save imports into fresh SQLite and returns using the same native state. Signed variants with a changed capsule tick, a tick charged to an Editor assignment, or an overlay edit during native Play are rejected. |

The regression uses the real fixture, native worker, SQLite store, authenticated loopback MCP, and separate browser approval endpoints. It exercises deterministic, local adapter behavior. Live model selection, owner-operated host sessions, and device trials belong to [#27](https://github.com/dhar174/zmachine_if_remix_plugin/issues/27).

Run from `engine` using the pinned Node and npm versions.

```text
node --test --test-name-pattern "#25 crosses the pedestal" tests/fixture-mcp.test.ts
npm run build
npm run typecheck
npm run lint
npm run test:schema
npm test
```

[Loopback regression](../../engine/tests/fixture-mcp.test.ts)
