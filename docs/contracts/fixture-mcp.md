# Private fixture runtime

The [v1 skill reference](../../plugin/references/fixture-mcp.v1.md) describes model-facing calls. The service listens on loopback and uses a local SQLite file. Default mode after a service start is Play. Private story files use the opt-in, authenticated Issue #22 route.

## Local configuration

Build in `engine/` with `npm ci` and `npm run build`. After private-route authorization, start the runtime with `npm run start:fixture -- <local configuration file>`. Keep the configuration, database and any installation mapping outside Git. Use one coordinator per database file.

The configuration is a strict JSON object with `listen_port`, `database_file`, `auth`, and optional `audit_tool_status`. Audit output contains tool names and result statuses. The auth object supplies the accepted Auth0 `issuer`, `audience`, `public_origin`, `authorization_endpoint`, `token_endpoint`, `browser_client_id`, allowlisted `subjects`, and public `jwks`. If required by the existing browser client, `client_secret_env` names the environment variable holding its secret. Use the exact approved control origin and callback path `/oauth/callback`. The login and consent entry points are `/login` and `/session`. The MCP endpoint is `/mcp` and advertises protected-resource metadata.

The fixture uses the previously scoped probe grants where their semantics match. `probe:import` redeems a fixture launch consent, `probe:read` reads projections or retrieves the browser control link, and `probe:stage` and `probe:commit` authorize the corresponding tool operations. Auth0 access never supplies Editor authority. All fixture directive commits require the exact independently confirmed browser candidate. The underlying browser authority also retains the #17 lease contract.

Use `/mcp` without query parameters. Authenticated MCP POSTs with query parameters return HTTP 400 `QUERY_NOT_SUPPORTED`. Requests exceeding the body limit return HTTP 413 `REQUEST_LIMIT`.

## State and replay

The browser creates a short-lived launch handle. Once redeemed it remains mapped to the same owner and fixture session. The private draft base has a review revision but no active head, clocks, or pending input visible to the player. Initial compilation records are inactive. The browser selects against the full digest and approves the resulting exact diff. The normal transaction publishes the first active head and receipt together.

An initial directive that contains only one-time assignments advances the world revision and retains policy revision 0. The exact browser approval and durable receipt still apply. Initial activation that adds a protection, generation rule, preference, or unresolved policy record updates the policy snapshot.

The v2 SQLite migration retains existing v1 history. It adds the fixture draft and control records and durable candidate/diff bindings. Old kernel receipts remain available to their existing callers. V1 rows lack the new exact MCP replay binding. A fixture retry binds the original target and action, candidate, and digest. Receipt recovery runs before any live-head or grant check. The tool applies current visibility when projecting stored receipts. In Play, an owner-only receipt retains the recovery metadata and withholds content. The same projection applies to history, exact inspection, prepare replay, and commit replay. An authenticated Editor view may read the full receipt. Restart clears active Editor authority and retires uncommitted Editor stages. Re-establish authority with a new browser-recorded request when needed.

The additive v3 upgrade retains prior checkpoints and receipts. It adds `checkpoint_links` for ancestry, `saved_sessions` for private saves, and `recovery_requests` for restore approval and durable request outcomes. See the [restore runbook](issue-21-restore-runbook.md) for compatibility and restart behavior.

Fixture data and authorized source text may travel to the ChatGPT model during a trial. The local database retains source and receipt history for verification. Remove the operator-owned store after the agreed retention period. That removal concerns the local store. ChatGPT retains chat according to the account's settings. Combined save and restore use the same private store. For browser-based portable export and supported raw Z5 upload, see the [private transfer runbook](issue-22-private-transfers.md).
