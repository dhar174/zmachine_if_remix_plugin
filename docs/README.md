# Documentation map

**Review status:** v0.2 is a documentation-only proposal. The user has specified the chat-first experience, initial directives, fidelity default, and Play/Editor distinction. The detailed algorithms and contracts below still require review.

## Reading order

1. [Design v0.2](superpowers/specs/2026-10-21-chat-first-remix-design.md): what we are building and why.
2. [Policy](architecture/world-policy.md), then [turn resolution](architecture/turn-resolution.md): the core behavioral contract.
3. [State/VM bridge](architecture/state-and-vm-bridge.md), then [plugin contract](architecture/plugin-contract.md): boundaries and failure handling.
4. [Worked session](examples/session-walkthrough.md) and [acceptance matrix](quality/acceptance-matrix.md): what the rules mean in practice.
5. [Decision record](decisions/0001-chat-first-authority.md) and [roadmap](ROADMAP.md): approvals, recommendations, and milestone gates.

## Draft contracts

[remix-directive.schema.json](contracts/remix-directive.schema.json) specifies a **normalized policy document**, not a complete engine or a guarantee of semantic correctness. [initial-policy.json](examples/initial-policy.json) is a synthetic example. Initial state edits use a separate proposed world patch, as explained in the policy document.

The schema is a design artifact. Valid JSON proves neither user authorization, correct interpretation of English, nor that a story adapter can perform a requested change. No executable runtime uses this contract yet.

## Normative ownership

Within this proposal, policy semantics are defined in `architecture/world-policy.md`; turn order in `architecture/turn-resolution.md`; persistence in `architecture/state-and-vm-bridge.md`; host and tool boundaries in `architecture/plugin-contract.md`. Examples illustrate these contracts rather than override them. A contradiction is a documentation defect to resolve before implementation, not a reason to select whichever text is convenient.

[References](REFERENCES.md) distinguish external technical facts from our proposed design. [v0.1](design_draft_v0.1.md) remains archived. Its private audit attachment is not distributed here.

No runtime behavior, native compatibility, mobile compatibility, test pass, or deployment may be inferred from the presence of these documents. Documentation validation is separate from product validation.

## Engineering documentation

Agent-assisted engineering work (Zcode specialist subagents) is configured separately from the product design docs above:

- [agents/team-coordination.md](agents/team-coordination.md) — canonical coordination policy: roles, routing table, assignment and return contracts, shared invariants, platform loading behavior.
- [agents/README.md](agents/README.md) — roster, installation into `~/.zcode/agents/`, invocation examples, and the fresh-session verification checklist.
- `.zcode/agents/` (repository root) — versioned source templates for the specialist definitions; installed copies are not stored in the repository.

## Evidence records

Feasibility-probe evidence (executed experiments, not design documents — each record states its own evidence layers and limitations):

- [evidence/g1-native-io.md](evidence/g1-native-io.md) — G1-A native fixture and interpreter I/O probe (Issue #11): fixture identity and reproducibility, interpreter comparison, measured results, and the conditional G1-B handoff.

Probe implementation lives outside `docs/`: fixtures under `tests/fixtures/zmachine/`, the experimental harness under `experiments/vm-io/`. Probe code is not a production adapter and must not be promoted without separate review.

## Approved decision consolidation (Issue #10)

- [Decision register: D01–D37 and exact approval sources](decisions/decision-register.md)
- [Contract reconciliation and unresolved scope/technology gates](decisions/contract-reconciliation.md)
- [Supplemental acceptance matrix S01–S24 (planned)](quality/decision-acceptance-supplement.md)
- [G1-A interpreter I/O probe brief](superpowers/plans/2026-10-22-g1-a-native-io-probe.md)
- [G1-B checkpoint/recovery probe brief](superpowers/plans/2026-10-22-g1-b-checkpoint-probe.md)
- [G1-C actual chatbot host/approval/import brief](superpowers/plans/2026-10-22-g1-c-chat-host-probe.md)

The older v0.1 draft remains historical. The v0.2 schema is a proposal and does **not** cover all newly approved future quest, identity, sharing or time policies; do not silently use absent schema fields as runtime support. D38 is not approved; the G1 runtime, language, hosting, security-approval and device details remain evidence-dependent.
