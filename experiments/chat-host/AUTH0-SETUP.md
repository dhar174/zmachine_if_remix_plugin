# Auth0 preparation for the G1-C probe

Prepared 2026-10-23 after the owner requested inspection of existing Google
configuration and then Auth0 compatibility/cost preparation **before creating
anything in Auth0**. This is a proposed configuration, not an installed account,
tenant, OAuth client, grant, or successful authentication trace.

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
Responses**. These are proposed changes for a dedicated test tenant, not changes
already applied to an existing shared tenant.

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
4. **ChatGPT OAuth client:** prefer manually registered CIMD using the exact
   metadata URL supplied by the real host, public-client `none` plus S256 PKCE
   if supported by its actual controls. Otherwise review the documented
   predefined-client route with the exact host callback URI and a supported
   token endpoint method. Do not guess a CIMD URL/callback or enable open DCR as
   a workaround. Verify actual plan entitlements for the selected method.
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

## Current blockers and references

No authenticated Auth0 dashboard session, real tenant metadata, test-user
subject or approved client configuration is available yet. The tunnel metadata
record was created after explicit owner confirmation, and its local profile
was read back. `doctor --explain` exited 2 because the runtime-key environment
variable was missing. The client, live ChatGPT tools, real human approval and
actual user import have not run. Costs/compatibility are documentation findings.

References retrieved 2026-10-23:

- [Auth0 pricing](https://auth0.com/pricing)
- [Auth0 authorization quickstart](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server)
- [Auth0 resource and issuer settings](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)
- [Auth0 manual CIMD registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Official tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)
- [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
