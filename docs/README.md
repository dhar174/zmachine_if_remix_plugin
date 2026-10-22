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
