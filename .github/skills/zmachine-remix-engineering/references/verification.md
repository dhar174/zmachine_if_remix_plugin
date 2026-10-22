# Verification and evidence

Owning sources: `docs/quality/acceptance-matrix.md`, `decision-acceptance-supplement.md`, the task's approved scope, and `docs/agents/team-coordination.md`. At the inspected baseline, A01–A42 and S01–S24 are planned cases, not executed tests.

## Select proof by changed behavior

Discover actual commands from the current repository manifests, test configuration, CI, or documented probe harness. If none exist, say so. Do not manufacture `npm test`, an interpreter runner, an installed host tool, or a passing baseline. Recommend a narrowly scoped harness only when the task authorizes creating one.

| Changed surface | Focused proof | Existing planning anchors |
| --- | --- | --- |
| Directive/schema | Classification, exact supported subset, scoped supersession, code-point spans, rejected unknown fields and forged authority | A01–A12, A30, A37; S01–S04 |
| Native I/O/startup | Opening effects, success and failed-action timers, line/character boundary, stable IDs, genuine read-only projection | A10, A13–A16, A19, A23; S06 |
| Bridge/ownership | Exact-digest mismatch, full effect/dependency coverage, no dual writer, protected gate preserved | A07, A17–A20, A22; S07 |
| Rules/clocks/sequences | Bounded/cyclic events, rejection without partial cascade, no idle ticks, interruption and per-subturn retry behavior | A14–A15, A21–A24; S05, S10–S11 |
| Transactions | Duplicate/same-ID-different-payload, concurrent candidates, stale policy/head, failure before/after commit | A25–A30; S12 |
| Recovery | Recreate process, line and character continuation, RNG/time equivalence, combined native/overlay restore, invalidated authority | A15–A16, A31–A34; S03, S12 |
| Narrative/knowledge | Receipt-grounded facts, preserved clue text, lie versus belief versus truth, perspective/spoiler leakage | A35–A36, A41; S08–S09 |
| Host/import | Real scoped invocation/approval/import, forgery/replay/cross-user denial, actual platform evidence | A37–A40, A42; S24 |

Add new IDs only through the repository's accepted process. Keep A/S identifiers stable. Do not run every case for a small change or make deferred S17–S23 mandatory without new scope. For a low-impact wording correction, link/consistency checks can suffice; runtime regressions are unnecessary unless behavior or an executable contract changes.

## Establish the right oracle

- **VM semantics:** cite the relevant primary specification and assert the affected state transition, not only text output. Test only relevant supported versions, including a changed version boundary. Document intentional compatibility deviations.
- **Story semantics:** use authored fixture behavior or a verified exact-story adapter. Object numbers and parser text are not a universal semantic oracle.
- **Policy:** pair positive cases with meaningful denied, ambiguous, and unsupported effects. Assert unchanged world/time where rejection must be nonmutating.
- **Persistence:** compare continuation after process recreation, including state fingerprints, events, pending input, timers, and controlled/recorded randomness. Do not merely serialize and deserialize the same incomplete object.
- **Model behavior:** record actual trials and failures with a denominator. Score state correctness separately from fidelity, spoilers, unnecessary clarification, narrative quality, latency, token/tool costs, and host selection.

Differential interpreter agreement is corroboration, not proof. Explain legitimate differences such as RNG algorithms and declared presentation behavior. Use byte comparison where the contract requires exact output; do not normalize away clues or mismatch evidence.

## Build fixture evidence responsibly

For authorized G1-A, follow its complete fixture list and Issue #11: original source and redistribution permission, pinned compiler/runtime/library versions, digest manifest, reproducible build instructions (or documented nondeterminism with tested binary digest). Include startup counter, ordinary success/failure, timer-advancing failure, character menu, controlled randomness, duplicate display names, locked gate, movable non-player item, and extension anchor.

Keep that probe in `experiments/vm-io/` with fixtures in `tests/fixtures/zmachine/` only when the approved task authorizes their creation. Compare the specified candidate and one viable alternative through the same I/O protocol. Record malformed/truncated/unsupported input under bounded execution. Do not use a user's uploaded game as a public fixture or infer whole-standard conformance from reaching its first prompt.

For G1-B, reuse the reviewed fixture; prove save/recreate/restore/continue and discarded speculative state. For G1-C, use actual authorized host tools and private import. Do not substitute one probe's evidence for another or run paid models/deployments outside scope.

## Report evidence with provenance

For each meaningful check, record:

> Case/requirement; source revision and changed surface; fixture digest and story version; compiler/runtime/adapter/schema versions; input kind, policy/mode, and pre/post generation; exact command/configuration; expected and observed result; exit status or trial denominator; evidence location; limitation or failure.

Use the subset relevant to the layer. Preserve redacted reproduction detail without private story content. A skipped, blocked, not-run, or known failing check is not a pass. Existing documentation-validation receipts are historical; do not rewrite their hashes to conceal changes.

Run targeted checks and required gates first. Broaden only for a concrete remaining risk or repository requirement. Stop optional testing once the change is adequately verified. Documentation-only work does not justify executing the product or a feasibility probe.

## Independent review and handoff

For substantive work, give a read-only reviewer the diff, exact source snapshot, owning contracts, affected decision/acceptance IDs, and raw evidence. Require precise defects and missing proof; do not ask for confirmation of the author's intended conclusion. The coordinator makes fixes and obtains fresh review when substantive changes warrant it.

Distinguish author self-check from independent review. If the required reviewer is unavailable, report that gate as unmet. Separate findings about the written skill/design from runtime validation; a successful agent exercise proves only behavior on that exercise, not correctness of the unbuilt engine.
