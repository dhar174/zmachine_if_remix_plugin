# Auth0 preparation for the G1-C probe

Prepared 2026-10-23 after the owner requested inspection of existing Google
configuration and then Auth0 compatibility/cost preparation **before creating
anything in Auth0**. The subsequent owner-approved configuration checkpoint below
supersedes the original preparation status. It does not establish a successful
end-user authentication flow, ChatGPT tool call, or exact-change approval.

## Applied account-configuration checkpoint

After the owner personally signed in and explicitly approved the scoped saves,
the actual development tenant's Teams subscription page showed **Free / USD 0**.
The dashboard also showed 22 trial days remaining; visible trial controls are
not evidence of permanent Free-plan entitlements. No paid features were selected.

The tenant already had Resource Parameter Compatibility Profile and Include
Issuer in Authorization Responses enabled. Its real public OIDC metadata was
retrieved: exact HTTPS issuer/auth/token/JWKS endpoints, `S256`,
`client_secret_post`, and issuer-response support were present. CIMD and DCR
were disabled and left disabled. Two public signing keys were retrieved and
private JWK fields were explicitly rejected before writing local configuration.

Saved configuration, checked through the real dashboard:

- `G1-C Synthetic Probe`: Auth0 JWT profile, RS256, 900-second maximum and
  implicit/hybrid access-token lifetimes, per-app user-delegated authorization,
  machine-to-machine access denied. Lifetime values were read back after saving.
- `G1-C ChatGPT Client`: third-party regular web application, user-defined
  registration, `client_secret_post`, authorization-code grant only. Its exact
  callback came from the real ChatGPT plugin draft and was read back after
  navigation. The API table confirmed exactly the four probe permissions.
- `G1-C Approval Browser`: first-party regular web application,
  `client_secret_post`, callback `http://127.0.0.1:3213/oauth/callback`,
  authorization-code grant only. Callback and reduced grant set survived reload.
  It has no API scopes; its ID token establishes the browser identity.
- `Username-Password-Authentication`: promoted to domain level after the owner
  explicitly approved that this makes the login connection available to
  registered third-party clients. The value survived reload. API grants and
  the service's subject allowlist remain separate restrictions.
- Auth0 also created `G1-C Synthetic Probe (Test Application)` with the API.
  Its table row has zero delegated permissions and denied machine access under
  the API policy. It was not used for login or calls. The existing Default App
  also has zero permissions for this API.

The API audience follows the official tunnel-client 0.0.18 documentation's
`https://api.openai.com/v1/mcp/{tunnel_id}` endpoint. Its agreement with the
actual rewritten metadata and issued JWT audience still needs the live flow.
Account/client/tunnel IDs and callback suffixes are retained only in local
setup records. The ChatGPT plugin remains an unsaved draft; no client secret
was retrieved, logged or stored in files by the agent.

The owner personally created one probe user. Its provider-issued User ID was
read from the selected real profile and bound as the sole allowed subject in a
private local config. The existing auth module accepted that real-provider
configuration with exactly one owner and the expected loopback origin; this
check did not read a secret or start a service. The earlier pending template
retains an empty allowlist and is not the startup file.

A local service launcher was read back, passed PowerShell parsing, and actually
exited 2 before requesting a secret when the final owner-bound config was absent.
After binding, the owner entered the browser secret through hidden input and
reported `LISTENING_LOCAL_ONLY`. Independent direct TCP and HTTP checks reached
`127.0.0.1:3213`: resource metadata returned 200 with the configured resource,
issuer and four scopes; unauthenticated MCP returned 401. The Node child belongs
to the launched PowerShell process. Windows CIM/netstat did not consistently
show a LISTEN row, so the live socket inventory alone does not prove exclusion
of every other interface; the tested source explicitly binds 127.0.0.1.
No issued token or completed browser login is established by these checks.
An open Auth0 consent page showed `invalid_request` with a missing-session
message; login must be restarted from the application before it can count.

The launcher keeps the browser-client secret in process environment only. A
separate hidden-input tunnel launcher was opened, and a one-day runtime-key
draft was prepared with exactly Tunnels Read + Use and all other permission
categories unset. The owner must create and transfer that key personally.
These launchers are local account-specific artifacts, not public repository
files. The owner subsequently reported doctor PASS and left the client running.
Independent `tunnel-client health --port <observed-loopback-port> --pid <observed-pid>
--require-control-plane-poll --json` returned exit 0: running process, health/ready
HTTP 200, successful control-plane poll. The readiness body explicitly states
MCP initialize requires authentication; it does not establish authenticated
MCP discovery. The redacted runtime checkpoint is separate from ChatGPT evidence.
Browser control lost its attachment to the existing draft; a fresh Plugins view
loaded Personal with no probe plugin, then also became unavailable. The owner
was asked to retry discovery and transfer only the ChatGPT client secret directly
to the existing draft. No plugin was installed by the agent.

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

## Findings and cost gate

Read-only inspection of the selected Google project found one IAP web OAuth
client and two service-account clients. Firebase, Identity Toolkit and Secure
Token APIs were absent from its successfully read enabled-service inventory.
The consent configuration was External/Testing, with incomplete branding and
inactive-client warnings. No existing client or setting was changed. This
inspection does not describe other projects or establish live MCP authentication.
Private project/account identifiers and test-user addresses are omitted here.

[Auth0 pricing](https://auth0.com/pricing), retrieved 2026-10-23, advertises Free
at USD 0/month without a credit card and includes Auth for MCP. Its table lists
one tenant and one day of log retention. Custom domains require card verification;
use the provider's tenant domain. Confirm the actual tenant's plan and entitlements
before configuring it. No paid subscription, upgrade or add-on is authorized.

The experiment uses one explicitly allowed person, one API and two client roles.
It does not need Auth0 RBAC roles, Token Vault, CIBA, custom token exchange,
machine-to-machine grants, custom domains or cross-application SSO. Independent
sign-in to each client is acceptable. The server's existing subject allowlist,
operation scopes and exact-change approval remain mandatory.

## Compatibility assessment

| Requirement from the current probe | Preparation result | Live verification still required |
| --- | --- | --- |
| OAuth discovery, authorization code and S256 PKCE | Documented by the OpenAI authentication guide and Auth0 MCP guide | Fetch the selected tenant's real metadata and perform both code flows |
| Access token issued for this MCP API | Auth0 documents Resource Parameter Compatibility Profile | Exact `resource`/API identifier and returned `aud` must agree through Tunnel |
| RFC 9207 `iss` callback parameter | Auth0 documents Include Issuer in Authorization Responses | Verify the real redirect; the probe rejects a missing or different issuer |
| RS256 JWT plus public JWKS | Configurable API signing; existing verifier supports RS256 | Pin public keys, exact issuer including trailing slash, audience, subject and scopes |
| Same owner in MCP and browser | Use the same tenant user independently in both clients | Compare verified `(iss, sub)`; matching email alone is insufficient |
| Browser callback | Proposed `http://127.0.0.1:3213/oauth/callback` for this Windows experiment | Tenant must accept the exact URI and the user must sign in on the listener's device |
| Human approval | Existing server-held candidate-bound browser grant | User personally checks and approves the exact diff; OAuth consent is separate |

The [Auth0 resource compatibility guide](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)
documents both required tenant toggles under Settings / Advanced / Settings:
**Resource Parameter Compatibility Profile** and **Include Issuer in Authorization
Responses**. Both were already enabled in the inspected tenant; no change to
these tenant toggles was needed.

Auth0 is therefore a **documented candidate**, not a live PASS. No Auth0 SDK,
Management API credential, replacement server, or new dependency is needed for
this preparation. The installed probe remains server/schema 0.1.0 with official
MCP SDK 2.4.0 and JOSE 6.2.13. No implementation was changed for Auth0.

## Proposed resource sheet (review before provisioning)

1. **Tenant:** a dedicated development tenant for `zirp-g1c`; select Free and an
   owner-selected region. Obtain the real tenant domain from its dashboard.
   Dashboard administration and the probe's end-user identity are separate.
2. **API:** `G1-C Synthetic Probe`, RS256, access-token lifetime 900 seconds.
   Determine its canonical HTTPS resource identifier from the actual Tunnel
   discovery path before saving it. Do not invent a hosted endpoint or use an
   unrelated IAP audience. Verify that the identifier returned in protected-resource
   metadata is what ChatGPT requests and Auth0 issues as `aud`.
3. **Permissions:** `probe:read`, `probe:stage`, `probe:commit`, `probe:import`.
   Use per-application delegated authorization for the chosen host client, with
   only these permissions. No blanket third-party grant or client-credentials
   access is required. Stage persists a candidate; commit still requires a
   separately created exact-change browser grant.
4. **ChatGPT OAuth client:** the inspected host supports User-Defined OAuth
   Client and supplied a concrete callback. This predefined third-party regular
   web client with `client_secret_post` is the selected route. CIMD/DCR remain
   disabled. The owner must transfer the client secret directly to the host's
   secret field; the agent does not retrieve it. S256 is advertised and selected
   in the draft; actual code exchange remains to be tested.
5. **Approval/upload browser client:** `G1-C Approval Browser`, a separate regular
   web client with authorization code + S256 PKCE and `client_secret_post` (or
   the supported public-client `none` route after review). Allow only the exact
   local callback above; no wildcard callbacks. Keep any secret in the explicitly
   named local environment variable, never JSON, command arguments or Git.
6. **One probe user:** the owner personally establishes a dedicated tenant
   login. Use that same user in ChatGPT linking and browser approval. Configure
   only its provider-issued subject in the local `subjects` allowlist. A
   dashboard account, model-supplied owner, service-account token or claimed
   email address cannot replace this verified user.

The [manual CIMD registration guide](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd)
describes importing approved client metadata and validating the resulting
application. The [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth)
also documents predefined clients and token endpoint methods. The choice must
match the actual plugin controls and tenant metadata.

## Sequence after owner sign-in and provisioning approval

1. Owner signs in at the [Auth0 Dashboard](https://manage.auth0.com/). If creating
   an account, the owner completes signup/terms, verification and any password
   entry personally. Stop on a required payment, upgrade or missing entitlement.
   At preparation time the browser showed the login page; no tenant was inspected.
2. Read the real plan/domain/region and review the resource sheet above before
   granting access or creating clients. Capture only redacted metadata. Do not
   install the broad Management API CLI grant from a generic tutorial merely to
   follow its sample commands.
3. Verify the local listener's exact storage, callback and metadata behavior.
   Start only with explicit real-provider configuration; never test grants or
   bypass authentication in live mode. Verify the canonical Tunnel resource
   identifier before binding the API audience. Keep native attachment import
   blocked pending its separate origin/ownership evidence.
4. Supply the restricted OpenAI tunnel runtime key through hidden local input;
   use an environment reference in the tunnel profile. This key is not the
   Auth0 browser secret or an end-user token. Re-run `doctor --explain`, then
   verify readiness/polling before plugin discovery.
5. Verify real Auth0 metadata: exact issuer, HTTPS auth/token/JWKS endpoints,
   `S256`, supported registration/client method and issuer-response support.
   Retrieve only public keys for pinning. No private JWK fields are accepted.
6. Owner authenticates both clients. Verify signature, issuer, API audience,
   issued-at/expiry (15-minute probe maximum age), allowed subject and operation
   scopes. Independently verify browser state/nonce/PKCE/callback issuer.
7. Continue the [live runbook](README.md#live-runbook-after-the-blocked-prerequisites-are-resolved):
   real ChatGPT read/prepare; human approval; commit/read/retry; denied stale or
   unapproved changes; separately approved inverse; external fixture upload and
   deletion; restart/reconnect. Preserve each evidence category separately.

Auth0 receives authentication requests and account/user login data, and retains
provider authentication logs according to the selected plan. It does not need
story bytes, candidate diffs or private chat transcripts. Those are not included
in configuration or provider logs by this probe. ChatGPT receives tool results;
the local service stores synthetic state and approved fixture bytes. Tunnel
transport privacy is not a claim that all processing occurs locally.

## Verified follow-up, 2026-10-24

The real approval-browser OIDC flow now succeeds, and the existing ChatGPT web
plugin discovers six tools and returns Probe Chamber / revision 0. Fixed-category
local diagnostics identified JWT_IAT rejection; only future issued-at skew now
permits five seconds, with strict exp/nbf and a 900-second age limit retained.
Pinned public keys matched the actual provider. No issuer/audience/owner/scope
check was weakened. The explicit owner authorization to use existing credentials
permitted repair/reconnection: the existing browser client secret was transferred
from its provider UI Copy control directly to a private launcher process, never
printed, embedded in an argument, saved literally to config or published. The
clipboard was cleared after transfer. No password or account permission changed.

The actual external browser upload accepted the immutable 88,576-byte fixture,
measured its expected SHA-256, survived service restart and was deleted; reusing
the handle returned NOT_FOUND. These were agent-operated fixture operations, not
human exact-diff approval or native ChatGPT attachment integration. HTML now uses
strict-origin so native forms supply the required Origin while retaining CSRF.
Two expired duplicate host account links were removed, leaving the current one.
OAuth access remains the reviewed four scopes; no new API/client/tunnel was made.

The tunnel client's prepared issuer-origin trust change remains unloaded;
automatic metadata discovery is not repaired. Manual OAuth did establish the
working web discovery/read path. The API's 900-second token lifetime can require
routine reconnection; longer sessions/refresh support are not qualified here.
Actual desktop Work, exact workspace UUID mapping, human edit approval, live
commit/inverse and native file import remain unverified. The terminal recovered; source follow-up 98a9751863f8ef872b10398f18c2566cd8e22ba4
is bound to the 31-test receipt, with hosted CI/publication tracked separately;
[the evidence report](../../docs/evidence/g1-chat-host.md) is the current status.

## Historical blockers and references (superseded by the follow-up above)

The account configuration and single-user binding checkpoints above are complete.
The local service and private tunnel runtime are responding after personal
secret entry. Successful end-user OAuth and the installed ChatGPT connection
remain pending.
The tunnel metadata record was created after explicit owner confirmation, and
its local profile was read back. `doctor --explain` exited 2 because the
runtime-key environment variable was missing; that earlier failure is retained.
Subsequent independent daemon readiness/polling checks passed. Live ChatGPT
tools, real human exact-change approval and actual user import have not run. The Free
subscription and provider metadata are observed; end-to-end compatibility is
still unverified.

References retrieved 2026-10-23:

- [Auth0 pricing](https://auth0.com/pricing)
- [Auth0 authorization quickstart](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server)
- [Auth0 resource and issuer settings](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)
- [Auth0 manual CIMD registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Official tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)
- [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
