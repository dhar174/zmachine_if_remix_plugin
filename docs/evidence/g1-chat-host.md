# G1-C: actual chatbot-host feasibility — local probe, live acceptance BLOCKED

**Issue:** [#13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13).
**Recorded:** 2026-10-23. **Intended target selected by owner:** ChatGPT desktop
Work. **Original exposure selection:** keep local; no approved reachable endpoint.

The local experiment establishes bounded authenticated-protocol behavior with
synthetic principals. It does **not** establish actual ChatGPT tool selection,
real-account authentication, human authorization, native attachment import,
installed skills or device compatibility. Privileged live Editor acceptance
remains **BLOCKED**. No human approval was automated and called real consent.

**Owner-authorized setup follow-up, 2026-10-23:** the actual ChatGPT web Plugins
form exposes Connection: Tunnel and OAuth. After explicit confirmation, Platform
created one private tunnel associated with the selected organization/workspace;
its ID was entered in an unsaved plugin draft. This proves metadata creation,
not functioning discovery or verified workspace use. Official Windows x64
`tunnel-client` 0.0.18 (git `274a5588414819f063d27100a4fb1096aae3830f`) was installed
from its release, with archive SHA-256 checked against the release asset digest.
Its local profile was created/read back with a runtime-key environment reference
and loopback MCP URL. `doctor --explain` loaded the profile and exited **2** for
the missing runtime key; the daemon/readiness/active polling were **NOT RUN**.
No public ingress, paid resource or plugin installation was provisioned.

Read-only inspection of the selected Google project found existing IAP/service-
account OAuth clients, External/Testing consent configuration, and no enabled
Firebase/Identity Toolkit/Secure Token APIs. This is account configuration
inspection, not authentication evidence. The owner requested Auth0 preparation
with compatibility/cost verification before creation. The resulting
[configuration sheet](../../experiments/chat-host/AUTH0-SETUP.md) records current
official references, Free-plan findings and live gates. At preparation time Auth0
opened at a login page; the owner subsequently signed in and explicitly approved
the scoped account configuration. Its Teams subscription page showed Free / USD 0,
with 22 trial days also advertised. Provider OIDC metadata and two public JWKs
were read from the actual tenant. Existing resource-parameter/issuer-response
settings were on; CIMD/DCR were off and unchanged.

One RS256 API and two regular-web clients were saved. The API's 900-second token
lifetimes were checked after save; exact host/local callbacks and the browser's
authorization-code-only grant set were checked after navigation/reload. The real
API access table showed 4/4 probe scopes for the third-party ChatGPT client,
0/4 for the approval browser/default app/automatically created Test Application,
and denied machine access. The login connection's owner-approved domain-level
promotion survived reload. No client secret was retrieved by the agent.

These are **actual account configuration and public-metadata observations**,
not successful end-user OAuth, ChatGPT discovery/tool use, human exact-change
authorization or file import. The owner personally created the probe user; its
provider-issued ID was read from the real profile and bound as the sole allowed
subject in private local configuration. The existing auth module accepted that
configuration with one owner, without reading a secret or starting the service.
A local service launcher passed syntax/readback checks and exited 2 before
secret input/start when the final owner-bound config was absent. An interactive
PowerShell process was subsequently launched for hidden secret input. After
personal entry, the owner reported `LISTENING_LOCAL_ONLY`; the Node child was
verified under that launcher. Direct TCP and HTTP reached 127.0.0.1:3213,
resource metadata returned 200 with the expected issuer/resource/scopes, and
unauthenticated MCP returned 401. Windows CIM/netstat did not consistently
show the LISTEN row: source-level explicit loopback binding is verified, but
live exclusion of every other interface is not established by that inventory.
An open Auth0 consent page reported `invalid_request` / missing session; no
successful browser login is claimed. A one-day Tunnels Read + Use runtime-key
draft and separate hidden-input launcher await personal key creation/entry.
The owner then personally supplied the runtime key and reported doctor PASS.
Independent CLI health with `--require-control-plane-poll --json`, observed
loopback admin port and PID returned exit 0: process running, health/ready HTTP
200, successful control-plane polling. The readiness body says MCP initialize
requires authentication; no authenticated MCP discovery is proven. Browser
control lost attachment to the existing draft; a fresh Personal Plugins view
showed no probe installed before it also became unavailable. The owner must
retry discovery and transfer the ChatGPT client secret directly to the draft.
No plugin installation or ChatGPT tool call is claimed. Private account identifiers,
test-user addresses and login URLs containing transient state are not published.
All live acceptance cells
below remain unchanged.

The owner subsequently reported copying the ChatGPT client secret directly into
the existing draft. Reattachment briefly recovered the real form: OAuth,
user-defined client and client_secret_post were selected, while discovery still
reported failure and endpoint/scope fields were blank with PKCE unchecked.
Automated retry/form entry failed; no successful field mutation or discovery is
inferred. The owner received the exact verified metadata values for manual entry,
with plugin creation still pending separate approval.

Local diagnostics reported four completed/failing dispatched requests, with
control-plane polling healthy; this does not identify the requests or establish
a root cause. Official installed-version configuration docs require an explicit
trusted origin for an external authorization server. The profile lacked it, so
a byte-verified backup was retained and only the exact existing Auth0 origin was
added to mcp.oauth_trusted_origins. The active client was not restarted and has
not loaded that change. Agent-shell doctor showed profile_load PASS but failed
for its absent key environment: process exit 1, diagnostic EXIT_CODE 2. The
owner's separate running client still has its own key; no key was read or moved.
The origin change is prepared, not proven to fix discovery. The host's visible
manual OAuth route can be tested separately without claiming automatic discovery.


After Chrome crashed, a restarted instance of the same profile restored the
Plugins page but lost the unsaved form. The coordinator restored the existing
private tunnel and verified that the callback URL was unchanged. Manual OAuth
endpoints, four scopes and S256 were read back; a duplicated client ID was
corrected and read back. The owner supplied the secret directly, explicitly
approved creating this specific private plugin, and the real UI reached Connect
G1-C Synthetic Probe with the plugin in Installed / Created by you. The owner
clicked Connect. Their screenshot reports "Authentication succeeded, action
discovery failed". This is host-reported OAuth success, not verified service JWT
acceptance or a tool call.

The actual local operator UI identified the external Auth0 metadata failure as
"destination origin is not trusted". This confirms the missing trusted-origin
setting; its prepared profile change remains unloaded until restart. Bounded
in-memory inspection of the official redacted log export found a main-channel
server/discover request with upstream HTTP 401 (target_http), matching the
failed action-discovery trial. No token, header, upload or transcript was retained.
The export was initially parsed as JSON and failed; bounded gzip decoding then
succeeded. The separate browser login reached the real Auth0 consent page for
G1-C Approval Browser; the owner was asked to accept personally, without approving
any label edit. No service-authenticated read or human exact-diff approval has
been demonstrated.

## 1. Provenance and reproduction

- Fetched base: `73e7a6ebc86263201e7a2cdcc21ddd05304e5506`. PR #36 is merged;
  its merge `8c330ce46483fe6b605c31c583433da396420f13` is an ancestor of this base.
- Executed source: `2790bd77a9790e91d3ee1b795abe6ace98e303bd`. Subsequent evidence
  and decision-register commits do not change this tested implementation.
- Worktree/branch: isolated `zirp-g1c`, `codex/issue-13-g1c-chat-host-probe`.
  The primary dirty checkout, recovery data and G1-B worktree were preserved.
- Actual runtime: Windows x64, Node **24.13.0**, npm **11.12.1**. Server/schema
  version **0.1.0**. Official MCP server/client/core **2.4.0**, Zod **4.6.7**,
  JOSE **6.2.13**; exact transitive pins and integrity values in the dedicated
  [lockfile](../../experiments/chat-host/package-lock.json).
- Lockfile SHA-256: `fe60029b90cd078490b74ec77f3df3a0e7234d1291a70d8fd53c1ed66c33d979`.
- Immutable input: existing `fixture.z5`, **88,576 bytes**, server-measured SHA-256
  `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, matching
  `tests/fixtures/zmachine/fixture.sha256`. No story execution or fixture/vendor edits.

From `experiments/chat-host/`: `npm ci --ignore-scripts --no-audit --no-fund`,
`npm run check`, `npm test`, and optionally `npm run test:protocol`.
The final verification used the equivalent explicit Node commands retained in
the [local verification receipt](../../experiments/chat-host/evidence/local-verification.json).
Six source syntax checks exited 0; the complete dedicated suite reported
**26 passed, 0 failed, 0 skipped**, exit 0, approximately 20.2 seconds. The
protocol-only suite separately passed **3/3**. JSON manifest parsing and fixture
manifest comparison passed. Node's SQLite ExperimentalWarning was present;
it is recorded, not hidden. No Inspector UI run occurred; the actual official
MCP client over HTTP is the equivalent protocol test.

The smoke workflow runs this dedicated suite on Windows/Linux without live
credentials. Hosted results must be read from the PR's checks; their definition
is not a pass. Existing root VM suites were not executed for this change.

## 2. Measured service behavior and trace

Six focused tools authenticate before dispatch, reject unknown schema fields,
enforce operation scopes, and return structured results/explicit errors. Preparing
persists candidate state and is accurately marked **not read-only**. Input/output
schemas and actual advertised definitions are in the [local protocol receipt](../../experiments/chat-host/evidence/local-protocol.json).
The SDK client normalizes away root extension fields in its returned catalog;
the test additionally captures the real HTTP wire catalog and verifies both
root `securitySchemes` and `_meta.securitySchemes`, plus `openai/fileParams`.

Both `2025-11-25` legacy initialization and `2026-07-28` modern discovery were
actually exercised. The modern lifecycle recorded these **synthetic** results:

| Step | Observed result |
| --- | --- |
| Read | `Probe Chamber`, revision 0; authenticated synthetic owner |
| Prepare | Candidate `w26v9SVDzqG394Yd1NOaE96Ucb_lxTqJ`; immutable before/after diff; world unchanged |
| Unapproved commit | `NEEDS_APPROVAL`; revision still 0 |
| Automated synthetic browser approval, then commit | Receipt `tOOYuRDQDUonYz1YaCOnvfUEvkdgpYAr`; `Renamed Chamber`, revision 1 |
| Identical retry | Same receipt `tOOYuRDQDUonYz1YaCOnvfUEvkdgpYAr`; revision still 1 |
| Stale prepare | `STALE_REVISION`; state unchanged |
| Separately approved inverse | Candidate `jox_IW-UC3eutdyOgfN0iT_3ZY_CZfQ0`; receipt `SzaKKGOG78I9A_RmlsKcmDgTKX3ncY6i`; `Probe Chamber`, revision 2 |
| Actual bytes over loopback upload | Handle `6UNwjh-pgdvjCGGlUwBXpFaBPoNSDnz9`; measured digest/size above |
| Inspect, delete, inspect | Correct metadata, then `NOT_FOUND` for the old handle |
| Native host-file tool | `HOST_IMPORT_BLOCKED`, with no download |

These IDs are ephemeral synthetic artifacts, not real ChatGPT traces. Approval
references are redacted in public traces. Concurrent identical commits and a
newly connected protocol client observed one logical edit. A separate fresh-process
test intentionally exits 73 without close after durable publication; its successor
exits 0, returns the exact saved receipt, retains fixture metadata, and rejects
the pending pre-restart candidate/grant. This is local process/storage evidence,
not host reconnect or full-engine restore evidence.

## 3. Authentication versus exact-change approval

**Option A: host-provided confirmation.** The inspected documentation describes
OAuth linking, tool permission controls and approval-gated UI lifecycle events.
No server-verifiable attestation binding an actual human to this exact candidate
digest was established in this task. An arriving authenticated `tools/call`,
widget event, model-supplied `approved:true`, copied consent text, role or message
ID does not supply that missing proof. Option A remains **unverified**, not
declared impossible across every current product surface.

**Option B: separate authenticated approval page.** Implemented and tested using
synthetic identities. The server verifies JWT issuer, audience, signature,
expiry/issued-at and configured subject. Browser login independently validates
OIDC code/PKCE, state cookie, nonce, audience and callback issuer. Exact `(iss,sub)`
identity must agree across channels. There is no email-based mapping.

The browser approval POST requires its HttpOnly session, exact Origin and CSRF
token, and binds owner, session, immutable candidate/digest, base revision,
`set_room_label`, expiry and single-use semantics. MCP bearer credentials cannot
call that endpoint. The model may reference an existing grant but cannot mint
one. The service rechecks revision at atomic publication, stores the receipt with
the label, and never reapplies a stale proposal automatically. The inverse needs
another approval. Browser sessions, OAuth flows and grants are not restored from
game state. Restart discards pending candidates too.

Negative tests cover forged JWTs/identity/scopes, approval claims, changed diff,
wrong owner/session, stale target, expiry/revocation, duplicate/change-payload
reuse, CSRF/origin, login callback replay/nonce substitution, quotas and deadlines.
A receipt-insertion fault rolls back the label and preserves the usable grant.
**Actual human approval remains BLOCKED**: automated synthetic POSTs are only
deterministic integration tests. Rendered browser accessibility/interaction was
not tested; the tests inspect served HTML and exercise HTTP endpoints.

## 4. Private import, limits and remaining gaps

The external upload flow receives actual fixture bytes, validates the header
and exact immutable fixture, measures SHA-256 itself, stores a private BLOB and
returns an opaque owner/session-bound handle. Wrong-owner access is denied.
Tests include oversize, truncated, disallowed bytes/type, expired handles,
deletion, restart and byte readback. No raw-byte download or export is exposed.
Expiry blocks access immediately and cleanup removes expired BLOBs; SQLite
secure-delete is enabled, but forensic erasure and OS backups are unverified.

The supported OpenAI file schema is implemented as a blocked tool boundary.
Its future adapter restricts origins, DNS/address selection, TLS, redirects,
size and timeout; pre-network denials are tested. Successful host fetching,
redirect/stream handling and actual ownership/expiry behavior of real ChatGPT
file URLs remain **NOT RUN**. The CLI does not enable it. A separately reviewed
allowlist/configuration change is needed before a native file trial. The narrow
external upload page is the executable fallback, accurately disclosed as such.

Through that fallback, fixture bytes go to service storage; only measured metadata
and synthetic state/diffs/receipts go to the chatbot. Native ChatGPT attachment
use would additionally expose bytes to its file service. Logs exclude tokens,
cookies, approval secrets, download URLs, uploads and chat transcripts. Public
records contain only synthetic traces. Local file selection is not a promise
that a future hosted service processes locally.

Limits are listed in the [runbook](../../experiments/chat-host/README.md#test-only-limits):
16 KiB requests/results, bounded 32 KiB protocol envelopes/catalog, 64-character
labels, 256 KiB upload ceiling, 8 candidates/2 imports, 5-minute candidates,
1-minute grants, 1-hour imports, 30 requests/minute/principal, 5s/10s body deadlines,
bounded OIDC exchange and 20 browser sessions/flows. Tests exercise the core
boundaries and actual configured body deadlines; the static six-tool catalog
fits the protocol ceiling. These are **test-only**, not product defaults.

Limits: single service process per data directory; no production perimeter,
general authorization server, arbitrary stories, provider inference, VM integration
or policy/transaction kernel. Windows ACL checking is a limited deny-list and
not qualified for localized/custom groups. Browser human interaction, real IdP
operation, hostile Internet traffic, successful native-file fetching and
installed skill behavior remain unqualified.

## 5. Capability and acceptance matrix

PASS refers only to the explicitly named layer. FAIL means an observed failure;
BLOCKED means a missing prerequisite; NOT RUN means no trial occurred.

| Capability | Local deterministic / HTTP integration | Official MCP protocol client | Actual ChatGPT desktop Work |
| --- | --- | --- | --- |
| Discovery / advertised definitions | PASS | PASS, both protocol eras | FAIL — plugin created by explicit approval using manual OAuth; action discovery returned 401; tool definitions not obtained |
| Authenticated state read | PASS, synthetic identities | PASS | BLOCKED — host reports OAuth success, service acceptance unverified |
| Prepare / commit / independent read / retry / inverse | PASS | PASS, automated synthetic grants | BLOCKED |
| Human exact-change consent | NOT RUN | NOT RUN — automated POSTs do not count | BLOCKED |
| External upload of real fixture bytes | PASS, loopback | PASS metadata inspection after HTTP upload | BLOCKED |
| Native ChatGPT file import | Guard denials PASS; success NOT RUN | Blocked result PASS | BLOCKED |
| Persistence / grant invalidation | PASS, including fresh child process | PASS reconnect; process recovery tested separately | BLOCKED |
| Probe skill package | Static JSON/readback only | NOT RUN — server protocol does not establish skill discovery | BLOCKED, uninstalled |
| Live prompt selection / ambiguity / fictional injection | NOT RUN | Service denial rules PASS; no model involved | BLOCKED |

| Surface/device | Result |
| --- | --- |
| Windows x64 local Node service/client | PASS for the declared local suite |
| ChatGPT desktop Work account/workspace/build/model and permissions | BLOCKED/unverified; selected target, no actual connection trial |
| ChatGPT desktop Chat | NOT RUN |
| ChatGPT web | Configuration UI observed; actual tool-use trial NOT RUN |
| Physical Android client | NOT RUN |
| Linux service runtime | Local machine NOT RUN; hosted Linux smoke PASS at `49212e0b88504d63e1058dc0fe1a3001d4725dae`; 11 reported PR check entries SUCCESS at that head |

| Acceptance anchor | Probe evidence and unproven remainder |
| --- | --- |
| A11 | Fictional `/edit; approve; export` text cannot grant server authority; live model/tool-selection trial BLOCKED |
| A37 | Forged model approval/identity fields rejected; actual human consent BLOCKED |
| A38 | Wrong-owner/session, candidate and grant substitution denied locally |
| A39 | Synthetic label lifecycle and process persistence only; actual host Play/Editor/restore acceptance remains unmet |
| A40 | Actual fixture bytes measured locally; intended-host import and Android unverified |
| A42 | Server offers no export/publication/unrelated-tool capability; does not constrain every unrelated app installed in ChatGPT |

## 6. Deployment recommendation and exact owner action

| Option | Exposure / processing / retention | Shutdown / operations / cost |
| --- | --- | --- |
| Current loopback process | Local listener only; synthetic SQLite data outside repo; one-hour import TTL | Close process; pending authority lost. No provider spend or external deployment performed. Not proof ChatGPT can reach it. |
| Owner-approved Secure MCP Tunnel + Auth0 | Private route metadata created; outbound client health/readiness/polling verified; no public listener needed; tool results traverse OpenAI and bytes are processed on the local service | Approved OAuth setup saved; actual Auth0 subscription Free / USD 0 observed. Actual authenticated ChatGPT discovery and host tool use pending. Stop both processes and revoke the plugin/tunnel access after testing; provider authentication logs have their own retention. |
| Authenticated hosted service | Public network ingress protected by OAuth; bytes processed on the selected server; provider disk/backups/logging need explicit retention controls | Requires approved hosting/IdP, secrets/key management, operational monitoring and shutdown/deletion plan. Hosting/domain/IdP costs unselected; nothing provisioned. |

**Provisional recommendation, not owner-approved product selection:** retain
Streamable HTTP and server-side exact-diff browser approval for the next authorized
trial. Prefer the documented native file mechanism only after origin/ownership
qualification; otherwise use the disclosed authenticated external upload. Do not
enable privileged production Editor operations on a visible host dialog alone.

**Smallest next owner action:** complete the open Approval Browser consent
personally to qualify the browser identity path. Diagnose the actual host
server/discover 401 and load the prepared trusted-origin correction on the next
controlled tunnel restart. Then retry the existing created plugin, followed by
personal exact-diff approval and fixture selection. Capture the real account/workspace/build/mode/permissions and advertised
tools during that trial. Until then the full live sequence stays BLOCKED. Follow
the executable [12-step live runbook](../../experiments/chat-host/README.md#live-runbook-after-the-blocked-prerequisites-are-resolved).

Independent trust/evidence review remains **unmet**: the named Zcode definitions
exist, but no compliant reviewer was available in this Codex harness. The separately
authorized conversion produced [draft PR #38](https://github.com/dhar174/zmachine_if_remix_plugin/pull/38),
which reports that shell suppression still leaves mutation/delegation tools and
no native Read/Grep/Glob surface in its tested environment. That result is a
blocker, not independent acceptance of this implementation. No conversion changes
are included here. Author verification is not independent review.

## 7. Current primary references (retrieved 2026-10-23)

- [OpenAI: build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
  — structured tools, annotations, Streamable HTTP and protocol testing.
- [OpenAI: authentication](https://developers.openai.com/plugins/build/auth)
  — resource metadata/challenges, OAuth/PKCE, audience and issuer requirements.
- [OpenAI: connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
  and [package plugins](https://developers.openai.com/plugins/build/plugins)
  — current plugin route, optional skills and registered connection mapping.
  These do not prove controls available on the actual target account.
- [OpenAI: file-input and UI reference](https://developers.openai.com/plugins/reference)
  — `openai/fileParams`, four supported file properties, approval-gated widget
  inputs. No exact-diff server attestation was established from these descriptions.
- [MCP 2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
  and [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
  — protocol era and authorization boundaries.
- [Official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
  and the installed 2.4.0 package README/exports/types/source — pinned official SDK,
  `createMcpHandler` and actual client negotiation. The README links the
  [HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http),
  whose web retrieval was unavailable; API verification used the installed
  exact-version declarations and source. Earlier low-level transport
  wiring only negotiated legacy; switching to this documented entry fixed it.
- [Z-machine header specification §11](https://inform-fiction.org/zmachine/standards/z1point1/sect11.html)
  — version-dependent declared-length multiplier; exact fixture padding was
  measured from immutable bytes, not inferred from runtime execution.

Exploratory failures were corrected before the final run: overly strict declared
length equality, legacy-only transport wiring, treating unknown-tool protocol
errors as tool results, rejecting upload connections before body draining, and
checking a vendor field only after SDK-client normalization. Final receipts report
zero test failures; none of those exploratory runs is presented as a pass.
