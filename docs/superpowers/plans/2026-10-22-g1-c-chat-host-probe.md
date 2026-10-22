# G1-C feasibility probe: chatbot host, approvals and import

**Owner issue:** [#13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13). **Status:** proposed, not executed; host/client, service options and allowed budget require explicit review.

## Question
Can the actual intended ChatGPT client invoke authenticated read/write tools, demonstrate user-bound exact-change approval and privately supply a redistributable story file to the engine without assuming attachment filesystem access?

## Probe
1. Deploy/run an isolated fixture-only read plus harmless reversible write tool; test actual host discovery and tool calls. The host model's natural-language claim is not approval.
2. Compare native supported confirmation with a minimal authenticated exact-diff approval surface bound to user, session, candidate digest, revision, scope and expiration. Test forgery, replay, stale target and cross-user handles.
3. Test explicit private import and access of a purpose-built Z-machine fixture through the *actual target host*, using opaque owner-bound handles and documented data flows. Test retention/cleanup paths.
4. Separately record web, desktop, and real Android host behavior, with unknown/inaccessible surfaces called out rather than inferred.
5. Compare a private/tunnel service and an authenticated hosted service on security, data retention, recoverability, cost and model tool compatibility. No unrelated app/account tools.

## Evidence / gate
Produce `docs/evidence/g1-chat-host.md` with exact tool definitions, host/model/client versions, redacted traces, consent displays, negatives, costs and blockers. If user authorization cannot be proven, Editor privileged commits remain blocked. If import is unavailable, do not claim local story loading. No public deployment or model spend without further authorization.
