# Issue #19 synthetic fixture evidence

**Baseline** [PR #80 merge](https://github.com/dhar174/zmachine_if_remix_plugin/tree/2ccd550f81977ddeb788559c51063ae8d5c16a61). Fixture package and MCP schema version `1.0.0`.

## Deterministic and protocol checks

The loopback test exercises all eight tools through Streamable HTTP with two synthetic principals. It verifies OAuth discovery and a missing-token challenge, strict tool inputs, scopes, owner and session isolation, browser Origin and CSRF checks, initial subset staging, exact approval, and receipt readback. The browser session in that test is supplied by the harness. The recorded directive passes through the same compiler, resolver, authority, and SQLite publication code used by the fixture runtime.

Separate verifier tests use generated signing keys and a simulated identity-provider response. They exercise bearer issuer, audience, expiry and owner checks, browser code exchange with S256 PKCE and nonce, flow replay rejection, and verified owner equality across the two channels. These tests use local network endpoints and make no Auth0 calls.

Controlled exceptions before and after publication exercise inactive draft recovery and lost-response replay. The later receipt replay uses the original request, candidate, and digest after the head advances and a replacement coordinator opens the database. The existing transaction suite separately exercises acknowledged process kills. The v1 migration test checks an existing head and receipt. The package test resolves the four on-disk skill references and checks tool names against the actual catalog.

Independent review round `zirp-20261115-19-r1` read the complete candidate diff and attested commit `c6437f4f2f300bac572d26a6f666e4375eae4f91`. Its two conditions concerned HTTP method and body-limit tests and a direct compiler regression check for `field.unchanged`. The follow-up adds those checks, covering sized and streamed requests and assignments on both sides of the protected-field boundary. The historical documentation validation receipt remains tied to its original revision.

| Case | Evidence available before a live trial |
| --- | --- |
| A09 | Deterministic draft inactivity, unresolved selection rejection, and atomic first-head publication of the owner-selected supported subset. |
| A11–A12 | The fixture exposes quoted control and export text as a visible fact. A mixed action returns clarification without publication or clock changes. Existing authority tests exercise quoted control at the authorization boundary. |
| A35 | The Play receipt and visible facts contain no invented exit. An unsupported exit assertion has no corresponding state or receipt fact. Model narration remains unverified. |
| A37–A38 | Deterministic schema rejection of forged provenance and approval fields, cross-owner and cross-session denial, and exact-digest approval checks. |
| A39 | The fixture protocol covers launch, initial directive, Play, assignment, policy amendment, and durable replay. Actual host behavior remains unverified. A successful fixture trial would still leave A39 partial because real restore belongs to #21. |
| A42 | The fixture catalog exposes no publication operation and save/restore return the #21 handoff. Host tool selection in response to quoted export instructions remains unverified. |

## ChatGPT web trial

**Initial runtime check.** On November 15, 2026, the owner authorized starting the fixture service and the existing private Secure MCP Tunnel for the bounded trial. The local check found the existing one-owner Auth0 configuration and tunnel profile. Tunnel client 0.0.18 `doctor` loaded the profile and exited 2 because its restricted runtime key reference `CONTROL_PLANE_API_KEY` was unset. The Auth0 browser-client secret reference `PROBE_AUTH0_BROWSER_SECRET` was also unset. The four recorded private-route ports had no listener when checked. The trial requires both existing credential types, the owner's browser sign-in and confirmations, and a private ChatGPT installation with both the packaged skills and write-capable MCP. See the [implementation and live trial runbook](../contracts/issue-19-runbook.md).

The startup check targeted reviewed commit `e06e502e58bf8befa60e2240db47364d2ddb0a3e`. Its [engine CI run](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/43798010055) passed on Windows and Ubuntu with Node 24 and 26.

### November 15, 2026 private web preflight

**Playthrough blocked on ChatGPT tool discovery.** The owner supplied both runtime credentials through hidden local prompts. The first launcher attempt exited during fixture startup. The fixture had logged that it was listening, but the Windows listener check missed it. The launcher stopped the fixture before it started the tunnel. Two subsequent credential-free smoke runs verified the corrected listener check and the expected HTTP responses.

The live retry tested PR #81 at `eb0fb286512622e23939e8c48ae61840783ae156` with a fresh fixture database. The loopback OAuth metadata returned HTTP 200 and the unauthenticated MCP endpoint returned HTTP 401 with a Bearer challenge. Secure MCP Tunnel client 0.0.18 returned exit 0 from `doctor` and confirmed active control-plane polling. Those results qualify local startup and tunnel readiness. The browser approval login and authenticated host tool calls still require live verification.

In Chrome on Windows, ChatGPT's Personal plugin directory imported the exact revision's plugin archive and confirmed installation of package `1.0.0`. The plugin page listed all four skills. The web Chat composer accepted mentions for both the installed skill package and the existing G1-C Synthetic Probe MCP app. One read-only preflight ran with the host's GPT-5.6 Sol model at Medium effort. The initially selected GPT-6 tier showed a usage limit, so the preflight used the available GPT-5.6 Sol model.

The model reported seeing all four skill names and reading `start-remix-session`. It reported only the seven historical `probe_*` tools from Issue #13 and specifically reported `open_story_session`, `prepare_turn`, and `commit_turn` unavailable. The plugin page corroborates skill discovery. The skill read is model-reported. The fixture audit recorded zero Issue #19 tool calls.

The existing app's settings showed that OAuth reconnection was required and exposed no catalog refresh. The web setup form for a fresh connector against the same existing private tunnel reported that it could not discover OAuth settings and offered manual OAuth setup. The operator exited that form. No fresh connector was created. The next qualification needs a private ChatGPT connection that discovers the Issue #19 catalog and authenticates using the approved Auth0 configuration. See the [ChatGPT connection and refresh instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The preflight stopped before the initial directive and any owner approvals, Play or Editor turns, receipts, or readbacks. The live gameplay evidence for A09, A11–A12, A35, A37–A39 and A42 remains unverified at this gate. The deterministic evidence above still applies. A39 also requires combined restore under #21. After the preflight, the operator stopped the fixture and tunnel and verified both listeners closed. The historical #13 observations are recorded in the [bounded closeout](g1-chat-host-closeout.md).

For the live record, capture the exact tested code and package revision, host-reported model and mode, tools selected and count by attempt, observed skill discovery or execution, unnecessary clarifications, policy and clock readbacks, and exact receipt comparisons. Record failures even if a later attempt succeeds. Keep authentication details, account identifiers, raw private transcripts, and connection IDs outside this repository.
