# G1-C supported-route acceptance audit

**Prepared:** 2026-11-02. **Owner issue:** [#13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13).
**Status: DRAFT / BOUNDED ROUTE OWNER-APPROVED. Complete #13 acceptance remains BLOCKED.**
This is an audit of retained evidence, with proposed dispositions. It records
no new ChatGPT invocation, personal approval, file import or device trial.

## 1. Authority, baseline and merge receipt

The owner authorized: mark PR #39 ready and merge it, leave #13 open, prepare
this supported-route audit, keep the probe offline and do not start #14.
That approves the experiment's publication; it does not approve its proposed
production route, an evidence waiver, a new credential, a runtime restart or a
later roadmap gate.

- [PR #39](https://github.com/dhar174/zmachine_if_remix_plugin/pull/39) merged
  on November 2 at **`6beaebf70450fdc24603a6992f4793dcb26f5892`**.
- Exact merged PR head: **`0d06ea3d49949e334470bcdd6dfc292fd2ab5670`**;
  all **11 reported checks SUCCESS**, zero pending/failed, verified before merge and rechecked against the [PR #39 check rollup](https://github.com/dhar174/zmachine_if_remix_plugin/pull/39/checks) on November 2.
- Independent Zcode GUI source/evidence review covered
  **`d35c9bf0183a2db4d77a14f915ecaf2c56dab6c7`**. The subsequent three-file
  documentation correction changed no runtime, tests, manifest or schema.
  See the [review disposition](../../experiments/chat-host/evidence/independent-review-2026-11-02.json)
  and [report section 6.15](g1-chat-host.md#615-independent-gui-review-and-disposition--2026-11-02).
- Tested final runtime: **`89268050bfcb0644b1223c8b306273dc903c5a18`**,
  service/schema **0.1.1**. Its [recovery receipt](../../experiments/chat-host/evidence/receipt-recovery-2026-10-29.json)
  binds 16 source/test/manifest hashes and the local test results. Earlier live
  checkpoints have their own source identities; they are not relabeled v0.1.1.
- PR #39 had a GitHub closing-issue association. Merge closed #13 at
  **19:03:02 UTC** despite the PR body's non-closing wording. The coordinator
  reopened it at **19:03:44 UTC**, verified OPEN, and retains that correction
  here. This audit must not add a closing association or close the issue.

This audit uses an isolated worktree at the merge commit. The older worktrees,
branches, private synthetic database and primary checkout's existing untracked
plan are preserved. The service and tunnel stay offline. Merge-head CI is not
substituted for the exact PR-head checks above; this audit's checks are separate.

## 2. Proposed acceptance target

**Owner-approved bounded target (November 2):** retain the following combination as
the target for completing the bounded G1-C feasibility decision.

| Part | Proposed boundary | Evidence and limit |
| --- | --- | --- |
| Chat surfaces | ChatGPT web **Chat** in Chrome on Windows x64; Classic desktop **Chat** | Actual authenticated read/write/approval cycles. Web checkpoint: Chrome 155.0.8059.86, UI-selected GPT-5.6 Sol / Medium. Classic 1.2026.190.0; exact model ID not captured. These are dated builds, not support promises for every current client. |
| Service connection | Existing private Secure MCP Tunnel to the loopback HTTP MCP probe; Streamable HTTP | Actual discovery and calls through the approved route. No public service provisioned. Availability depends on the owner's computer, service, tunnel client and valid restricted runtime key. |
| Caller identity | Existing scoped Auth0 OAuth for MCP; separate authenticated browser session for approval/upload | The service verifies issuer, audience, subject, expiry and operation scope. A model-supplied owner ID or consent string is never identity or authorization. |
| Edit consent | Option B: immutable exact-diff page, personally approved by the owner | Forward and inverse approvals were separate; grant binds owner/session/candidate/digest/revision/operation/expiry and is single-use. OAuth consent and ChatGPT Allow once are different signals. |
| Private import | Explicitly disclosed, authenticated **external upload flow** using the immutable fixture | Real bytes reached service storage; ChatGPT inspected opaque-handle metadata. Upload was agent-operated under explicit fixture authorization, not a personal file-picker interaction or native ChatGPT attachment integration. |
| Skills | Server-only web/Classic lifecycle is the primary proven result | One standalone cloud skill was separately installed, discovered and invoked with reads in web Work. A combined installed-skill plus approved-edit lifecycle in the chosen Chat surfaces is not demonstrated. |

No production language, infrastructure budget, permanent hosted deployment,
general story support or broad Editor lease is selected. Exact-diff approval
remains required for each new protected edit; earlier broad delegated permission
does not turn an agent click into evidence of a personal interaction.

## 3. Evidence ledger

PASS refers only to the named layer and bounded trial. FAIL is an observed
failure; BLOCKED is a missing prerequisite; NOT RUN means no trial; UNVERIFIED
means an observation did not establish the fact. None marks a full product
acceptance case passed.

| Evidence layer | Retained result | Audit disposition |
| --- | --- | --- |
| Local deterministic tests | PASS: final 35/35, zero fail/skip; six syntax checks at runtime 8926805 | Synthetic principals and automated grants only. Not rerun for this audit. [Source-bound commands](../../experiments/chat-host/evidence/receipt-recovery-2026-10-29.json). |
| Actual MCP protocol | PASS: official HTTP client, dedicated 4/4 at 137ebbd before the CLI-only startup version correction; those cases included in final 35/35 | Inspector-equivalent protocol evidence, not ChatGPT. [Initial six-tool wire receipt](../../experiments/chat-host/evidence/local-protocol.json) plus seventh definition/assertions in the recovery receipt do not constitute a retained full seven-tool catalog from ChatGPT. |
| Actual ChatGPT web Chat | PASS bounded forward/inverse, readback, stale/unapproved rejection and same-turn inverse replay | Cross-turn retry lost the consumed reference and is NOT RUN; changed-payload reuse was denied. [Web trace](../../experiments/chat-host/evidence/live-web-2026-10-28.json). |
| Actual Classic Chat | PASS bounded read/stage/negative writes, personally approved forward and later personal inverse; latest inverse replay returned the same receipt | Initial forward narration incorrectly said no commit: FAIL, reconciled by state/receipt reads. Expired handoffs and delegated cleanup/setup remain distinct. [Classic continuation](../../experiments/chat-host/evidence/live-classic-2026-10-29.json). |
| Actual human approval | PASS personally approved exact forward/inverse on web and Classic; separately approved restart-only candidate invalidated before expiry | Does not qualify simulated grants, delegated clicks, host Allow once, production leases or a new proposed edit. |
| Actual fixture import | PASS real external bytes, measured metadata, restart persistence, deletion and old-handle denial | Native service-byte import BLOCKED; live cross-owner import-handle denial NOT RUN. Never execute the fixture. |
| Actual restart/reconnect | PASS retained committed state/receipts/import and invalidated pending candidates/grants, including active human grant before expiry | One local service process only; not combined VM restore or production crash transactions. |
| Actual web Work skill | PASS standalone cloud skill plus explicitly selected existing app for state/receipt reads | Initial missing link_id failed; complete packaged-plugin installation and skill-driven edit lifecycle NOT RUN. [Remaining-check receipt](../../experiments/chat-host/evidence/remaining-checks-2026-10-29.json). |
| Actual native Work | PASS state/receipt reads; cloud skill unavailable in tested catalog | Writes, personal approvals and import NOT RUN; not in the approved write-qualified surface set. |
| Actual native attachment | Attachment picker acceptance PASS; path-shaped tool argument observed; response rendering FAIL | Valid host file object, service byte receipt, exact tool error and ChatGPT copy retention/deletion UNVERIFIED. Do not claim a specific live HOST_IMPORT_BLOCKED error. |
| Actual physical Android | NOT RUN | Explicitly unverified; no desktop/emulator substitution. |
| Independent review | Completed actual Z.ai API / GLM-5.3-Flash / Max child source/evidence review; no merge-blocking code defect found | Read/Grep/Glob inspection plus disclosed report-only return channel; commands NOT RUN. The separate PR #53 audit review is recorded in section 8. |
| Hosted CI | PASS 11/11 at merged PR head 0d06ea3 | CI uses synthetic tests, not live credentials or actual user approvals. It does not complete #13. |

The latest retained private-state observation is **Probe Chamber / revision 6**,
six receipts, zero candidates and zero imports. That is historical evidence,
not a fresh database read in this audit. The latest personal Classic inverse
and immediate identical replay share receipt `3C1tvcQD4hmDx5YVT_DvUaIYKYCo4PdP`.
No new approval click is needed to establish that already completed cycle.

## 4. Acceptance mapping and closure gates

Owning sources are [Issue #13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13),
the [G1-C probe plan](../superpowers/plans/2026-10-22-g1-c-chat-host-probe.md),
[plugin contract](../architecture/plugin-contract.md),
[acceptance matrix](../quality/acceptance-matrix.md) and
[S24 evidence discipline](../quality/decision-acceptance-supplement.md).
The probe plan remains a historical proposed plan; executing the experiment
does not make its other proposals owner-approved.

| Anchor | Evidence applicable to this probe | Unproven boundary / proposed disposition |
| --- | --- | --- |
| A11 | One combined fictional/indirect/malicious-text trial used only probe_get_state; one ambiguous remark caused no tool call or revision change | Bounded observation plus server authority checks. No production Play/Editor mode system or general prompt-injection immunity. |
| A37 | Local forgery negatives plus actual personally approved immutable diffs and committed receipts | Probe exact-change authorization demonstrated; host-provided exact-diff attestation was not established. Full product authority remains future work. |
| A38 | Deterministic wrong-owner/session, altered candidate/grant, expiry and stale/replay tests pass | Real second-principal rejection remains required live evidence for the narrow route; synthetic principals cannot substitute. |
| A39 | Actual model selected tools for synthetic edits, readback, receipt recovery and process recovery | Full initial-directive/Play/Editor/combined-restore sequence is outside this probe and NOT RUN. Do not require building the remix engine to finish G1-C or mark A39 fully passed. |
| A40 | Actual authenticated external fixture bytes and opaque-handle metadata, deletion/restart; agent-operated upload explicitly labeled | External fallback is permitted by plugin-contract section 7 and the task. Native import and Android stay unqualified; do not claim human picker use, all-client support or host-side attachment deletion. |
| A42 | Probe exposes no export/publication/arbitrary-tool capability; malicious fictional instruction did not authorize it in the bounded trial | Cannot constrain every unrelated app installed in ChatGPT. No general host-wide disclosure-prevention claim. |
| S24 | Failures, unsupported surfaces and evidence layers remain explicit | Audit is a proposal; no planned test, model narration, source file or green CI is promoted to runtime proof. |

The following table tracks acceptance for the owner-approved bounded route. The table records which observations are complete and which still need evidence.

| ID | Current status / why it matters | Smallest next action after explicit authorization |
| --- | --- | --- |
| R1: host tool definitions | OWNER ACCEPTED LIMIT (2026-11-03). ChatGPT showed seven names and descriptions (Write 3 / Read 4). Full host schemas, strictness, annotations and scopes were not captured. | The owner accepted the observed catalog for this bounded feasibility probe. Full host definitions remain unverified. |
| R2: real second identity | PASS at the service entry point. Auth0 issued a fresh probe access token to a second real identity. The probe returned HTTP 401 and recorded `OWNER_NOT_ALLOWED`. Owner reads matched before and after. | Live loopback evidence recorded below. Cross-owner object access remains covered by deterministic tests. |
| R3: workspace identity | PASS for the observed route. The signed-in ChatGPT profile showed Personal account on November 2 in the browser context that showed the existing probe. | The October 29 redacted receipt separately records that the configured tunnel matched and its selected workspace UUID matched the fresh skill-draft account context. The November 2 observation supplies the account type. |
| R4: route and resource decision | Owner approved the bounded section 7 route on November 2. | Production hosting, language and budget remain undecided. |
| R5: audit review and closeout | Independent audit review completed at a413eec. Issue #13 is OPEN. | Review the resulting evidence and obtain separate closure authorization. |

On November 3, 2026, the pinned 0.1.1 service ran on loopback with disposable
synthetic data and the unchanged single-owner allowlist. The operator signed
in separately as the owner and a second Auth0 database user through the
Native test app using authorization code with S256 PKCE and user-delegated
`probe:read`. The second user's access token produced HTTP 401 and the
service's MCP authentication diagnostic was `OWNER_NOT_ALLOWED`. The owner's
authenticated reads matched on session, label and revision (0 before and
after). The redacted runner receipt reported PASS and an unchanged owner
configuration. The disposable directory was removed, all four known local
ports refused connections, and GitHub reported #13 OPEN.

On November 2, the cached ChatGPT Apps dialog exposed the seven names and
descriptions but no full definitions. During the bounded live window the
tunnel doctor and local endpoint passed their checks. The inspected ChatGPT
views did not expose Refresh, and no new discovery was verified. The
downloaded plugin ZIP contained only `.app.json` and
`.codex-plugin/plugin.json`, with no input or output schemas. The
[connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
documents Refresh and a separate API Playground diagnostic path. Neither
the exported archive nor a direct MCP client establishes the exact schema
advertised inside the tested ChatGPT surface.

For R2, the current service rejects a valid signed token whose subject is not
allowlisted before accessing session state (`OWNER_NOT_ALLOWED`, returned as an
authentication rejection). A real non-allowlisted identity trial qualifies that
outer gate only. Cross-owner behavior between two *allowed* principals remains
deterministic evidence unless a separately reviewed setup authorizes both;
do not widen the allowlist simply to turn the demo green. A live import-handle
denial also needs a newly authorized disposable import if no handle remains.

## 5. Limits that need disclosure, not a new green demo

The approved route carries these limits. The outstanding observations are tracked in the acceptance table.

- **Native attachment import:** excluded from the bounded target until a valid
  supported host file object, origin/ownership/expiry controls and actual bytes
  are proven. Keep native fetch disabled. The external-upload result is not
  relabeled native integration.
- **Native Work and Android:** native Work remains read/receipt-only evidence;
  Android remains NOT RUN. Neither is advertised as write/import compatible.
  Android can remain explicitly unverified under Issue #13's stated alternative.
- **Combined skill plus edit flow:** not demonstrated. Keep the server-only
  lifecycle and standalone web Work skill trial separate. If the owner requires
  a complete installed skill-driven edit experience now, that becomes a further
  acceptance item; do not implement #19's four product skills here.
- **Cross-turn lost-reference retries:** do not promise them. Same-turn inverse
  replay is proven; read-only receipt recovery is proven. A missing receipt does
  not prove no in-flight commit or authorize a new edit. Original Classic forward
  replay is still NOT RUN/UNVERIFIED.
- **Model narration:** the observed Classic false no-commit answer is a material
  UX limit even though server state and receipts were correct. No claim of
  reliable narration without independent receipt/state reconciliation.
- **General prompt injection and unrelated apps:** this server's narrow powers
  and one combined hostile-fiction trial are the demonstrated boundary. No
  host-wide tool restriction or general immunity is claimed.
- **General story execution and product acceptance:** no VM execution/import
  validator for arbitrary stories, engine mode semantics or production authority
  kernel was built. A11/A37-A40/A42 mapping remains probe evidence only.

## 6. Private import, exposure and operations

Only the redistributable immutable [fixture](../../tests/fixtures/zmachine/README.md)
is in scope: **88,576 bytes**, Z5, server-measured SHA-256
**`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`**.
The external upload sends bytes to the authenticated local probe service, which
stores a private SQLite BLOB and issues an opaque owner/session-bound handle.
ChatGPT receives bounded tool metadata/results. This flow does not require the
story bytes in chat. The separate failed native trial did upload the fixture to
ChatGPT; its host copy retention/deletion remains UNVERIFIED, even though service
import rows were deleted. Service cleanup cannot prove host cleanup.

Import TTL is one hour; explicit deletion and expired/old-handle denial are
tested. Restart retains unexpired imports but drops pending authority and
browser sessions. SQLite logical deletion is tested; forensic erasure, backups
and all provider log retention are not qualified. Tokens, approval secrets,
complete uploads and private chat transcripts must not be logged or published.
OAuth providers and OpenAI have their own processing/retention boundaries.

The local approval/upload pages remain separate browser flows. The MCP tunnel
does not itself prove those pages are reachable from another computer or Android.
No remote browser accessibility or mobile approval UX is inferred.

| Option | Current evidence | Selection / cost / shutdown boundary |
| --- | --- | --- |
| Existing private tunnel + local service + Auth0 | Actual bounded web/Classic calls and byte storage; no public listener provisioned | Preferred next feasibility target, still not owner-selected for production. Both processes must be running for future trials. Existing one-day runtime key expired October 30. Prior Auth0 Free / USD 0 observation is dated, not a current price or future spend guarantee. Stop processes to remove availability; account configuration and provider logs can remain until separately removed. |
| Authenticated hosted service | Requirements comparison only; NOT RUN | Hosting, domain, secret management, storage/log retention, shutdown and costs unselected. No hosting or public endpoint is authorized by this audit. |

Concrete limits remain **test-only**: 16 KiB request/result, 32 KiB protocol
envelope/catalog, 64-character label, 256 KiB upload ceiling, 8 candidates,
2 imports, 5-minute candidates, 1-minute grants, 30 requests/minute/principal,
5s/10s body deadlines and bounded OIDC/browser sessions. They are not approved
product defaults or an SSE response-lifetime guarantee. Four optional hardening
items remain in the [review disposition](../../experiments/chat-host/evidence/independent-review-2026-11-02.json);
in particular, native URL-to-consent binding must be resolved before enabling
that presently disabled route. No changes are made to satisfy them here.

## 7. Owner decision

On November 2, the owner explicitly approved the following bounded route in this task:

> Select web Chat and Classic desktop Chat with the existing private tunnel,
> scoped Auth0 identity, separate exact-diff browser approvals and the disclosed
> external fixture-upload flow as the target for completing G1-C. Retain native
> attachment import, native Work writes, combined skill/edit workflows and
> Android as the explicitly limited/unverified surfaces listed here. Keep #13
> open pending the required evidence and final review. This does not select
> production hosting/language/budget, authorize a restart or credential, approve
> D38/D39, or start #14.

The decision selects the target for completing G1-C. R2 is verified at the service entry point. The owner accepted the R1 evidence limit for this probe on November 3, 2026. Full host definitions remain unverified. No new timed approval
handoff is scheduled. If the owner later authorizes live R1/R2 work, first prepare
one compact run plan and all non-expiring material. Ask only for the actual
identity/credential or personal action required, with safe local input. The probe and tunnel are offline after the bounded trials.

[#12](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12) and its
[#40](https://github.com/dhar174/zmachine_if_remix_plugin/issues/40) checkpoint
follow-ups are separate; immediate blockers #41-#44 are not worked here.
[#14](https://github.com/dhar174/zmachine_if_remix_plugin/issues/14) requires
accepted #12 and #13 evidence. It has not been started by this audit.

## 8. References and audit verification

Primary OpenAI references were retrieved again on **2026-11-02**. They describe
supported integration routes; they do not establish controls or behavior in
this specific account:

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server):
  Streamable HTTP and inspection; annotations do not replace service controls.
- [Authentication](https://developers.openai.com/plugins/build/auth): OAuth
  metadata, PKCE S256, exact management-page redirect URI and token checks.
  No authentication flow or credential was changed in this audit.
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt):
  separate direct MCP testing from actual tool selection; private tunnel
  testing is distinct from public plugin submission.
- [Package plugins](https://developers.openai.com/plugins/build/plugins):
  package/install testing is separate from a registered MCP connection. No
  complete template installation is inferred from the standalone skill trial.

Pinned probe dependencies remain official MCP server/client/core **2.4.0**,
JOSE **6.2.13**, Zod **4.6.7**, with Node **24.13.0** / npm **11.12.1** in the
retained source-bound runs. No package installation or SDK migration occurred.
The guide's general SDK install example does not override these tested pins.

Audit verification is documentation/source inspection only: resolve relative
links, check exact source/evidence identities and unchanged runtime hashes,
read back changed files, inspect the allowlisted diff, check whitespace and
credential patterns, and confirm the known service/tunnel ports refuse
connections. Record actual results in the publication handoff. Do not rerun the
VM, execute the fixture, start the probe or call a live model to validate prose.
The independent Zcode review completed on November 2 at
`a413eec593f41d6e92e81e53a6ff960e95ba4bfc`. GLM-5.3-Flash via Z.ai
reviewed the documentation with Read, Grep and Glob and a report-return channel.
The coordinator verified the invocation and profile. The reviewer reported no
merge defects and two low-severity documentation findings. This follow-up
clarifies the port observations, links the GitHub check evidence and records
the owner's decision. The reviewer relied on coordinator-attested revision
identity and retained evidence for command and live results.

The October shutdown observation covered ports 3213 and 34339. The November 2
review checkpoint covered 3213 and 42111. These were separate observations.
During this follow-up a local TCP listener inventory showed no listeners on
any of those three ports.

Completed coordinator checks on November 2: all three changed documents read
back; **39 relative file links and 4 heading anchors** resolved; all **16
runtime/test/manifest hashes** and the fixture/manifest digest matched; only the
one G1-C status paragraph changed in the decision register; credential-pattern,
scope and whitespace checks passed; older worktrees were preserved. Ports 3213 and 42111 refused connections at the November 2 checkpoint. Runtime, VM, live-model, human,
file-import and device trials were **NOT RUN** for this documentation audit.
Audit publication and hosted CI are separate checks reported on its draft PR.
