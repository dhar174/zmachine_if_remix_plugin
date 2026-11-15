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

**Blocked at private route startup.** The recorded private-route ports had no listener during the local readiness check. Starting the local fixture service and private Secure MCP Tunnel for this revision requires the separate authorization in the approved plan. The trial requires the existing scoped Auth0 configuration, the owner's browser sign-in and confirmations, and a single private ChatGPT web installation with both the packaged skills and write-capable MCP.

No ChatGPT tool calls, owner approvals, model output, or installed-skill discovery were observed for #19. The model, client mode, installation, and combined workflows remain unverified. The historical #13 observations are recorded in the [bounded closeout](g1-chat-host-closeout.md).

For the live record, capture the exact tested code and package revision, host-reported model and mode, tools selected and count by attempt, observed skill discovery or execution, unnecessary clarifications, policy and clock readbacks, and exact receipt comparisons. Record failures even if a later attempt succeeds. Keep authentication details, account identifiers, raw private transcripts, and connection IDs outside this repository.
