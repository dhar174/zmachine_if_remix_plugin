# G1-C bounded-route closeout recommendation

**Owner issue:** [#13](https://github.com/dhar174/zmachine_if_remix_plugin/issues/13).
**Status:** Ready for an owner decision on bounded G1-C closure, subject to
independent review of this closeout. Issue #13 remains OPEN; R5 is pending that
separate decision. This recommendation neither changes the original issue's
checkboxes nor claims full product acceptance.

## Scope and sources

The owner approved the synthetic web Chat and Classic desktop Chat route on
November 2, 2026: the existing private tunnel, scoped Auth0, separate exact-diff
browser approval and disclosed external fixture upload. The owner accepted the
R1 host-definition limit on November 3. The [acceptance audit](g1-chat-host-acceptance-audit.md)
records these decisions and the retained evidence; the [host report](g1-chat-host.md)
preserves dated trial details. The owner has not yet accepted final closure.

The probe merged in [PR #39](https://github.com/dhar174/zmachine_if_remix_plugin/pull/39)
on November 2 at `6beaebf70450fdc24603a6992f4793dcb26f5892`, with head
`0d06ea3d49949e334470bcdd6dfc292fd2ab5670`. Its final tested runtime source was
`89268050bfcb0644b1223c8b306273dc903c5a18`. The audit merged in
[PR #53](https://github.com/dhar174/zmachine_if_remix_plugin/pull/53) on
November 3 at `6c18134823513978de23ded80d82ded8576c738a`; the R1–R3 update
merged in [PR #54](https://github.com/dhar174/zmachine_if_remix_plugin/pull/54)
on November 3 at `12d1f7bf7a1cf6476d82d5e5d027d607feec3745`. Dates of
observations below refer to the recorded trials, not these merge dates.

## Issue #13 acceptance mapping

Each disposition is for the owner-approved bounded route only. “No additional
evidence blocker” is a recommendation for that route, not an owner waiver or a
pass for the corresponding full-product acceptance case.

| Issue criterion | Source, date and bounded evidence | Exclusion and proposed disposition |
| --- | --- | --- |
| Real chat read, scoped write and readback | [Audit §3](g1-chat-host-acceptance-audit.md#3-evidence-ledger), [web trace](../../experiments/chat-host/evidence/live-web-2026-10-28.json) (October 28) and [Classic trace](../../experiments/chat-host/evidence/live-classic-2026-10-29.json) (October 29), retained in PR #39: authenticated reads and separately approved synthetic forward/inverse writes with receipts and readback. | The Classic forward answer falsely said no commit; later state and receipt reads reconciled it. The combined installed skill/edit lifecycle and full A39 product sequence were not demonstrated. No additional evidence blocker for the bounded route. |
| Forged, stale, wrong-session, replayed or modified-diff approvals cannot authorize a write (A37–A38) | [Audit §4](g1-chat-host-acceptance-audit.md#4-acceptance-mapping-and-closure-gates), PRs #39 and #54: deterministic negative cases, actual unapproved/stale rejection and exact personal approvals; on November 3 the real second non-allowlisted identity received HTTP 401 and `OWNER_NOT_ALLOWED` at service entry, with owner state unchanged. | Live two-allowed-principal object authorization and cross-owner import-handle denial were not proven. Same-turn inverse replay is evidenced; cross-turn lost-reference retry and original Classic forward replay are not. No additional evidence blocker for the bounded route. |
| Story text cannot change mode, authorize uploads or request unrelated tools (A11, A42) | [Audit §4](g1-chat-host-acceptance-audit.md#4-acceptance-mapping-and-closure-gates) and [host report](g1-chat-host.md), October 28, PR #39: one combined hostile-fiction trial and the probe's restricted tool surface. | No production Play/Editor mode implementation, general prompt-injection immunity or host-wide control over unrelated apps is established. No additional evidence blocker for the bounded probe route. |
| Import, consent and persistence on each claimed host; Android separately tested or unverified (A40) | [Audit §§3, 5–6](g1-chat-host-acceptance-audit.md#3-evidence-ledger), October 28–29, PR #39: real fixture bytes via authenticated external upload, owner/session-bound handle metadata, service deletion and restart persistence; personal exact-diff approvals were observed separately. | Upload was agent-operated, not proof of a personal picker. Native attachment-to-service import remains blocked and disabled; service deletion does not prove ChatGPT attachment deletion. Native Work write/approval/import and Android are unqualified. No additional evidence blocker for the expressly limited route. |
| Probe needs no second provider API call merely to use the host model | [Probe README](../../experiments/chat-host/README.md) and [audit §2](g1-chat-host-acceptance-audit.md#2-proposed-acceptance-target), PR #39, October 28–29: ChatGPT selected the probe tools through the host route; the probe has no provider API dependency or callback into the subscription. | This does not establish production architecture or prohibit separately authorized future provider calls. No additional evidence blocker for the bounded route. |
| Installation success only after actual invocation; unsupported transports are blockers | [Audit §§2–3](g1-chat-host-acceptance-audit.md#2-proposed-acceptance-target), October 28–29, PR #39: actual web/Classic tool invocation; a standalone cloud skill was separately invoked for web Work reads. R1 records seven host names/descriptions; on November 3 the owner accepted the missing full definitions for this probe. | Full host schemas, strictness, annotations and scopes remain unverified; local protocol definitions are not host capture. Complete packaged-plugin installation and combined skill/edit flow are not proven. No additional evidence blocker for the approved bounded route. |

## Decision boundaries

- R1 is an **owner-accepted limit**, not a schema pass. R2 proves denial at
  service entry only. R3 is a pass for the observed Personal workspace route,
  not other workspaces. R4 approved the bounded route, not production hosting,
  language or budget. The earlier independent audit review is retained; it is
  not independent review of this new closeout diff.
- The [receipt-recovery record](../../experiments/chat-host/evidence/receipt-recovery-2026-10-29.json)
  separates deterministic, protocol and actual host evidence: receipt lookup
  does not prove the original mutation replay, and a missing receipt does not
  prove that no commit is in flight. The
  [independent probe review](../../experiments/chat-host/evidence/independent-review-2026-11-02.json)
  is dated November 2; its then-open R1–R3 observations are superseded only by
  the later, bounded dispositions above.
- Native Work reads, the standalone web Work skill and the external upload are
  distinct observations; none establishes a skill-driven edit, native import,
  personal picker, all-client support or deletion of a ChatGPT attachment.
  General story execution, durable production transactions and reliable model
  narration remain unproven. No production language, deployment or budget is
  selected.
- The prior probe and tunnel shutdown observations are dated in the audit. No
  new port check, runtime, live-model, approval, upload or device trial is
  claimed by this documentation closeout. G1-B Issues #12 and #40 remain
  separate; this recommendation does not approve D39 or start #14.

## Proposed owner decision

If independent review confirms the mapping and the owner accepts these limits,
the smallest remaining action is the owner's explicit bounded closure decision:

> I accept G1-C as complete for the documented synthetic web Chat and Classic
> desktop Chat route, including the disclosed external fixture-upload and
> separate exact-diff approval flows, with the retained evidence limitations.
> This decision does not establish product readiness, approve D39, start Issue
> #14, qualify broader clients or native attachment import, or authorize
> restarting the service.

Until that decision is made, leave #13 open. A demand for a broader capability
would require a separately scoped decision and evidence; it is not inferred here.
