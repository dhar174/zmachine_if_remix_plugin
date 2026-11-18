# Issue #20 native fixture evidence

The integration starts from PR #81 merge `48ae57c5bc8cefd089cac7e2838b23c0ed2a45ac`. The native profile uses the 88,576-byte Z5 fixture with SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, the vendored ifvms.js revision `6ac63e6b61144d4353a168df16c4ad5c22526f88`, and the accepted G1-B v2 codec. The engine binds the runtime and codec source digests to the native adapter modules. The v2 envelope also binds Node, V8, platform and architecture. An incompatible build needs a fresh fixture draft. [D39 owner decision](../decisions/decision-register.md#d39-owner-decision) · [G1-B evidence](g1-vm-recovery.md)

## Run locally

From `engine/`, run `npm ci` and `npm run build`. Start with the existing fixture authentication configuration format and a fresh disposable SQLite path. Set `profile` to `native-z5` and `auth.public_origin` to the exact `http://127.0.0.1:<listen_port>` origin. Launch with `npm run start:fixture -- <local configuration file>`. The browser consent page explains that the opening and `SEED 42` run before the draft. The original authored opening sets the startup counter to 7. The setup consumes one native tick. Play becomes available after approval of the initial directive. The default configuration selects the synthetic profile. [Fixture authentication and configuration](../contracts/fixture-mcp.md) · [Tool and skill contract](../../plugin/references/fixture-mcp.v1.md)

Use a fresh LF checkout for source-identity checks. On Windows, configure the clone with `-c core.autocrlf=false -c core.eol=lf` or use the repository's clean-CI normalization step in a disposable checkout. The first hosted Windows engine run failed the native worker bootstrap because checkout conversion changed the pinned runtime and codec digests. Both engine matrix jobs now apply the same checkout normalization as the G1-B workflow. [Checkout normalization](../../.github/scripts/normalize-checkout.js)

Run the reproducible loopback route with `node --test --test-name-pattern "native Z5" tests/fixture-mcp.test.ts`. This uses a temporary database, a synthetic MCP principal and browser session, and the actual pinned interpreter. The scripted client sends the same typed tool calls described in the skills. The worker test runs with `node --test tests/native-adapter.test.ts`. It checks clean startup and fresh-process recapture, and observes nonzero exit with no candidate output when the story identity or input boundary is wrong.

## Reference sequence and acceptance

The loopback test compares each native output delta and whole checkpoint to an uninterrupted adapter executing the same authored input. Before publication the executor restores and recaptures each candidate in another process and compares the envelope, the machine-state fingerprint, and the declared undo-depth disposition. The fingerprint covers dynamic RAM, in-use frames, stacks, globals, RNG state, requests, and both output streams. The original transcript, the status grid, and the committed event ledger have distinct fields.

| Case | Reference observation and tested result |
| --- | --- |
| A10 | The opening prints `[F01:startup=7]`. Capture at the unseeded prompt rejects with `E_RNG`. Setup emits `[F08:seed=42]` and `[F06:turn=1]`. An attempt to alter startup returns `CAPABILITY_MISSING` and the draft remains identical. |
| A13–A14 | `take stone panel` produces “The stone panel is hardly portable.” and advances to tick 2. `take brass key` produces “Taken.” and the scheduled chime at tick 3. The coordinator commits the authored outcome once, with the chime in the event ledger. Entering the gallery, encountering the locked gate, and subsequently unlocking, opening, and traversing it match the reference. From the vault, the fixture's authored `south` response returns the vault description and advances time. |
| A15 | An injected fault after staging a rolled checkpoint discards the candidate. The published checkpoint is byte-equivalent as canonical JSON, including RNG, transcript, timers and input continuation. The next committed roll matches the uninterrupted reference. Exact receipt replay has no further effect. |
| A16 | `menu` opens an actual character prompt with zero ticks. A line input is refused. After restarting the loopback service on the same database, character `b` produces the beta result and advances one tick, returning to a line prompt. |
| A08, A19, A23 | The read projection has a known room and inventory and makes no absence claim for a missing windowsill. The gallery's two brass tokens have distinct IDs. An ambiguous token request needs clarification, and the exact IDs resolve to the original red and blue parser inputs. Context and fact inspection preserve the checkpoint. Explicit `look` and `inventory` each advance one tick in this fixture. |
| A24 | The scripted compound request stops at the committed failed attempt to take the stone panel. The subsequent north subturn is left unexecuted. |

## Local verification

On Windows with Node `24.13.0` and npm `11.12.1`, engine build, typecheck and lint exited 0. The schema suite passed 9 tests and the full engine suite passed 72. The G1-B checkpoint suite passed 141 tests. A separate compiled-entry smoke test on the initial review head observed the native profile listening on loopback, OAuth metadata returning 200, and an unauthenticated MCP request returning 401. After review fixes, the compiled executor bootstrapped and recaptured the seeded line checkpoint at tick 1 with adapter build `764123f5756987d4513792cd40720f521736c578ddc9695ed7bfc722e9c2fecf` and native envelope digest `1ba164d892f41015ed185c3623a1ee43fa71297f9bcd30a597320ac2b4679f77`.

## Independent review

Antigravity CLI 1.5.10 with Gemini 4 Hydrogen (High) completed a source-packet review, `ZIRP-20-AGY-R1`, at `ab9290be65008d704b820f0f66571898900a1ea2`. The checkout reviewer exposed task and MCP resource functions during admission. The actual review used an isolated workspace with an enforced packet-read guard. The admission probe observed denials for task control, MCP resource calls, and other file reads. The review trace shows only reads of the exact packet.

- Draft and active native assignment attempts now return `CAPABILITY_MISSING` with the applicable explanation and end their one-turn Editor authority. The loopback test verifies both rejection paths and unchanged game state.
- The fixture takes a key from the floor before checking an already-unlocked door. The coordinator now commits that exact authored failure as one failed turn with the inventory effect and original output. The loopback case compares the receipt and checkpoint to uninterrupted execution and verifies exact retry.
- The Play skill names the registered lowercase commands `inventory` and `look`. The reviewer also confirmed the distinction between synchronous data checks and fresh-VM recovery before publication.

## Evidence limits

The command map covers the named operations and fixture object mapping documented in the tool contract. Unsupported input fails closed. The qualification covers the checkpointable seeded fixture boundaries and the headless status grid. The native route uses the same owner, revision, approval, and receipt boundaries demonstrated by #19. That accepted synthetic live trial used delegated approvals and an earlier revision. It lacked per-skill execution traces and the original MCP request bytes. This #20 evidence is deterministic interpreter and local protocol evidence. Actual model selection of the native tools, owner-operated host publication, and device coverage remain unverified. A39 remains partial until combined restore in #21. Private import belongs to #22. Production sandboxing and broader runtime compatibility remain outside this evidence. [Accepted #19 scope](https://github.com/dhar174/zmachine_if_remix_plugin/issues/19) · [Issue #21](https://github.com/dhar174/zmachine_if_remix_plugin/issues/21)

The packet-only Antigravity review covers the exact supplied source and receipts. It establishes no broader client admission or live gameplay evidence. [Specialist admission](../agents/team-coordination.md#91-project-adapters-and-specialist-admission)
