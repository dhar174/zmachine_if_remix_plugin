# Policy and world semantics

Owning sources: `docs/architecture/world-policy.md`; the current decision register/reconciliation; narration and knowledge sections of `turn-resolution.md` and `state-and-vm-bridge.md`. Follow their current accepted semantics rather than extending the proposed schema by inference.

## Compile meaning without promoting authority

Keep a directive bundle's policy amendment, one-time world patch, presentation preferences, unresolved clauses, and source map distinct. Preserve exact source wording. Current source spans use zero-based Unicode code-point offsets with exclusive ends; verify bounds against code points, not UTF-8 bytes or JavaScript UTF-16 indices. Test non-ASCII text when changing this path.

| Input | Meaning to preserve | Incorrect shortcut |
| --- | --- | --- |
| Editor: “Give me a key.” | One-time assignment | Permanently respawn or force possession |
| “Always keep that key with me.” | Proposed invariant, requiring conflict handling | Treat as another inventory assignment |
| “Allow shops outside the original map when I explore.” | Bounded permission with region/type/trigger | Create shops every turn or anywhere |
| “Keep descriptions short.” | Presentation preference | Remove clue-bearing facts or change state |
| Play: “I tell the guard we are old friends.” | Speech claim/attempt; possibly a supported belief update | Establish real shared history |
| “Make everything realistic.” | Unresolved meaning until interpreted/accepted | Activate a broad permissive rule |

Activate only a coherent, exactly approved supported subset (D01). Keep unresolved/unsupported clauses visible and inactive. Bind approval to the normalized policy and initial patch together; structural validity and source text are not user authentication.

Compile and preview before intentional native startup (D09), but apply native state patches only at a verified safe boundary. Do not infer prestart mutation support from prestart policy collection; show whether an actual change is prestart, poststart, or unsupported.

## Evaluate complete effects

Use stable entity IDs. Match the full direct/dependent effect footprint, including attachment points, relationships, scheduled events, and protected progression. An added remix exit can modify native topology; permission for its destination is insufficient.

For the current scope model, OR values within each nonempty selector list and AND different selectors. Empty entity/region lists add no filter; origins/domains are explicit. Unknown membership or effect coverage does not satisfy an allowance. Derive origin/region membership from engine evidence, not model labels.

Preserve authored native execution by default. For synthesized intervention, require a matching allowance where the contract requires one, apply active matching prohibitions, and check invariants separately. A valid one-shot Editor scope is not the same as a standing Play-generation permission. Capability and service authorization gates apply in both modes.

Make supersession explicit and scoped. Keep internal old/new rule IDs and lineage while showing a human-readable diff. Split partially amended protections so unaffected scope survives. Do not implement global “latest sentence wins.” Disabling future generation must not delete already committed entities.

## Separate structure from semantic judgment

Discover the actual schema version. At the inspected baseline, `remix-directive.schema.json` is the proposed normalized policy 0.2.0, not an implemented DirectiveBundle or world-patch API. It rejects unknown fields and lacks later quest, identity, sharing, and timing extensions.

Validate IDs, source spans, active supersession targets, revision/story identity, guard registration, capabilities, effect coverage, and approval binding beyond JSON shape. A model-written `protected: false`, `approved: true`, or invented guard does not bypass these checks. Label qualitative personality/plot judgments with evidence and uncertainty; escalate consequential unresolved effects under D06/D10 without demanding repeated approval for routine edits already covered by a valid scope.

Keep generated behavior declarative and bounded through registered typed effects. Never evaluate AI-generated scripts or silently drop a rule cascade after partial mutation.

## Ground facts, knowledge, and presentation

Keep objective events, observed facts, speech claims, beliefs, player/NPC knowledge, reader disclosures, and commitments distinct. A reader-only cutscene does not teach every character. A quest lead is not an accepted promise. Summaries/retrieval indexes are caches over authoritative event/fact IDs.

Preserve exact native transcript and clue content (D18), with optional policy-authorized prose alongside it. A generated exit, object, promise, or puzzle outcome must appear in validated state/events before narration treats it as usable or true. Keep native score, puzzle gates, timers, and RNG native-owned; do not fake their outcomes with overlay values.

Preserve real native termination. Later authorized overlay aftermath must not imply that halted native execution continued. General retcons, cross-world synchronization, and advanced quest/puzzle features remain subject to their delivery lane; do not add them merely to make a schema feel complete.

Relevant regressions: A01–A12, A17–A21, A30, A35–A37; S01–S04, S07–S09. Select only affected cases and authorized later extensions.
