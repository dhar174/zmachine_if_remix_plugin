# Issue #19 implementation and live trial runbook

The fixture MCP entry point uses the engine's Node.js 24 ESM build and Streamable HTTP. The Auth0 bearer token supplies the server-side principal and tool scopes. Tool adapters bind that principal and the session, branch, generation, revisions and request ID to the transaction service. The model proposes a typed interpretation from an authenticated browser source reference. The compiler previews the proposal, the owner selects supported clauses, and the browser shows the exact diff for approval. The same transaction publishes the approved state and durable receipt. The four instruction-only skills guide the host from launch through inspection. See the [runtime contract](fixture-mcp.md) and [skill reference](../../plugin/references/fixture-mcp.v1.md).

## Prepare the private route

1. Record the PR base, head, package and schema versions. Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:schema` and `npm test` from `engine/` for a runtime revision that needs qualification. Record the command exits and the hosted Windows and Ubuntu checks.
2. Use the existing #13 Auth0 and tunnel settings. Place the fixture startup configuration and a fresh SQLite database path outside Git. Set `audit_tool_status` to `true` for timing and tool-count evidence. Supply the existing Auth0 browser-client secret and a valid restricted tunnel runtime key through the private launch process. Check the exact configuration with the installed tunnel client's `doctor --profile-file` command. The runtime setup and private route are documented in the [fixture contract](fixture-mcp.md) and [#13 closeout](../evidence/g1-chat-host-closeout.md).
3. With owner authorization, run `npm run start:fixture -- <local configuration file>` and start the tunnel using its existing profile. Check that the fixture listens on loopback, the OAuth metadata returns HTTP 200, an unauthenticated MCP request receives the expected HTTP 401 challenge, and the tunnel reports readiness. Record startup failures and stop at any credential, identity, connectivity or scope blocker.
4. In the private ChatGPT web installation, record the account type, host mode and model label. Verify that the four packaged skills and write-capable MCP tools are available together before the playthrough. Use the owner's separately authenticated browser control page for consent, source entry, subset selection and exact-diff approvals.

## Run one fixture session

| Step | Evidence to record |
| --- | --- |
| Initial directive | Record a label assignment, protection for a separate original fixture inscription, and an unresolved memory clause. Inspect the inactive draft, select the supported clauses, and obtain exact approval. Confirm the first receipt and the unchanged clock. |
| One-time Editor assignment | Approve a new label assignment. Compare the receipt with the readback and check that Play resumes with no additional time cost. |
| Ordinary Play | Attempt a fixture command. Compare the narration with the committed output and time cost. |
| Protected edit | Ask to change the protected inscription. Record the conflict and read back the revision and clock. |
| Policy amendment | Record and separately approve replacing the inscription protection with label protection. Read back policy lineage, revision and clock. |
| Replay and inspection | In a later turn, relay the identical original commit request. Compare the receipt with the saved one, then inspect authorized facts and confirm the revision and clock stayed fixed during recovery and inspection. |
| Quoted instructions and capability checks | Treat quoted `/edit`, export text, and forged authority as story or chat data. Exercise mixed input and the unsupported restore request. Record any unauthorized tool selection or narration unsupported by receipts. |

Record every attempt in the [evidence report](../evidence/g2-live-kernel.md). Retain exact revisions, tool choices, result statuses and redacted receipt comparisons. Keep account identifiers, credentials, raw transcripts and private URLs in local operator custody. Review the evidence against A09, A11–A12, A35, A37–A39 and A42. A39 remains partial because combined restore belongs to #21. Stop the trial service and tunnel after the bounded session and verify their listeners are closed. Leave the draft PR and Issue #19 open for owner disposition.
