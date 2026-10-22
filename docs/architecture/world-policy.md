# World policy and directive compilation

**Proposed contract v0.2.** This document defines meaning; the [JSON schema](../contracts/remix-directive.schema.json) defines structural shape only. See the [example](../examples/initial-policy.json).

## 1. What the initial prompt compiles into

A natural-language directive produces a **DirectiveBundle**, not just a system prompt:

| Component | Meaning | Example |
| --- | --- | --- |
| Policy amendment | Persistent permissions, prohibitions, and invariants | “Generate new districts outside the original map.” |
| World patch | One-time state changes at the chosen revision | “Start me with a brass key.” |
| Presentation preferences | Tone and display guidance, not world facts | “Use concise descriptions.” |
| Unresolved clauses | Ambiguity, conflicts, missing mappings/capabilities | “Make everything more realistic.” |
| Source map | Source text, spans, interpreted rule IDs, approval reference | Rule P2 came from the second sentence |

Preserve source text verbatim. Source-span offsets are zero-based Unicode code-point offsets with an exclusive end, not byte offsets. The proposed compiler shows the user a plain-language summary and any conflicts. Initial policy activation and initial world patch are committed together only when the entire requested activated subset is supported and approved. A partially unresolved bundle remains uncommitted unless the user explicitly approves a listed subset.

A policy document's `sources` and `source_id` fields provide traceability. They are not proof that the model accurately copied a user message. Authorization is established independently, as described in the [plugin contract](plugin-contract.md).

## 2. Four kinds of directive, four different lifetimes

**Assignment:** establishes a current fact once. “Give the player three coins.” Ordinary subsequent play can spend them.

**Invariant:** constrains future states or transitions. “The original protagonist identity must not be replaced.” It persists until explicitly amended.

**Permission:** allows a type of generation or intervention in a scope. “You may add shops outside the original map.” This is permission, not an obligation to generate a shop every turn.

**Preference:** guides presentation or lower-stakes choices. “Keep descriptions brief.” It does not grant world-editing authority.

Historical edits are not ordinary assignments with an earlier timestamp. They need a retcon capability and a dependency-aware preview. The first milestone may reject them as unsupported while allowing present-time changes.

## 3. Fidelity default

Original authored fiction and mechanics are preserved unless explicitly changed or within a user-approved generation envelope. Preserve **authored behavior**, not a frozen copy of every opening-state value. Original doors can open, inventory can move, scenes can advance, and characters can die if the original game's rules produce those outcomes.

The default is no unrequested generative content, no implicit retcons, and no unsupported effects disguised as narration. Faithful execution is permitted even when a complete semantic model of the binary is unavailable. A synthesized intervention that may touch an unmapped protected gate is not.

Native facts, editor assignments, and ordinary gameplay events are provenance categories, not three permanently competing truth layers. Current mutable facts are obtained by replaying valid committed transitions from the correct baseline. A dropped editor-created key stays dropped. Persistent invariants are evaluated separately.

## 4. Scope

Every generation rule and invariant has a scope with `origins`, `entity_ids`, `region_ids`, and `domains`. Values within a nonempty selector list are ORed. Different selectors are ANDed. Empty entity/region lists impose no additional filter. `origins` and `domains` are explicit nonempty lists.

- `native` identifies original-game content or behavior.
- `remix` identifies added content.
- Domains distinguish topology, identity, characterization, dialogue, inventory, progression, and presentation.
- Region membership and native/remix provenance are engine-maintained; the model cannot self-label a native room as remix to evade protection.

A change's **effect footprint** includes both direct writes and known affected relations/dependencies. Adding an exit from an original room affects original topology even when the new destination is a remix entity. Deleting a room affects contained entities, exits, scheduled events, and references. Permission for the new room alone does not authorize those other effects.

Scopes use stable IDs, never first-match display names. Unknown region membership or unknown effects do not match an allowance by default. Adapters declare the effect coverage they can verify.

## 5. Rule resolution

Do not use a global “latest sentence always wins” list.

1. Enforce host/service authorization and supported engine capabilities. Editor authority is fictional authoring authority, not permission to bypass service security.
2. Determine which committed policy rules are active at the current revision. Only an explicit, valid amendment supersedes an existing rule.
3. For ordinary native gameplay, preserve authored execution unless an applicable explicit policy requires a tested override.
4. For synthesized generation/intervention, collect rules matching the complete effect footprint and trigger. No matching allow means deny. Among simultaneously active matching allow/deny rules, deny wins.
5. Evaluate all applicable protected invariants, including effects on dependencies. Permission does not cancel an invariant.
6. Where a clause is qualitative or coverage incomplete, return a semantic review/clarification requirement rather than claiming a mechanical proof.

### Explicit override, without silent weakening

A newer editor instruction can override an earlier directive. The amendment must identify the superseded rule IDs, changed scope, and intended replacement. If only part of a rule changes, split the rule so unaffected protections survive. The schema's `supersedes` list captures lineage; a semantic validator checks active IDs, scope changes, and authorization.

“Make everyone more friendly” does not silently repeal “never change character A's personality.” Show the conflict and offer a precise exception or a narrower edit. A deliberate later instruction such as “Replace the personality protection for A with this new characterization” can be approved and committed.

One-shot editor operations do not need a standing play-generation permission, but still require explicit user authority, applicable invariant checks, and real capabilities. An editor permission to change one room is not general permission to bypass every puzzle.

## 6. Generation envelope

The draft schema supports bounded action names, triggers, and scopes. Initial action categories are `generate.location`, `generate.character`, `generate.item`, `generate.connection`, `generate.rule`, `dialogue.adapt`, and `presentation.embellish`.

Triggers distinguish `player_attempt` from `autonomous_event`. Permission to flesh out a location when the player explores it does not imply permission to spawn unsolicited events everywhere. “Spontaneous” needs an explicit trigger policy.

Native mutation and editor policy changes are separate privileged capabilities, not another spontaneous generation category. Generated rules may call only registered effect primitives; an allowed description cannot smuggle in a new executable mechanic.

An allowed rooftop garden might still be blocked if attaching it requires altering a protected original exit or bypassing a gate. The system should explain that specific conflict, not conclude that all creative additions are impossible.

## 7. Structural checks versus semantic judgments

The JSON schema checks required fields, enums, basic limits, and record structure. It cannot prove that a proposed room preserves a murder mystery, that a character stays in personality, or that a quoted clause came from the user.

Semantic validation additionally checks:

- unique rule/source IDs and valid source spans;
- story identity, active revision, and entity/region membership;
- valid supersession with preserved unaffected scope;
- capability/effect compatibility and native adapter coverage;
- a guard ID registered by the engine or adapter, with supported parameters;
- an approval digest bound to the actual policy/world patch;
- semantic constraints and unresolved source clauses.

`guard.enforcement` is `structural`, `adapter`, or `semantic`. A semantic guard requires an explicit evaluation result and confidence/evidence report; it is not a deterministic theorem. High-impact unresolved semantic conflicts block commit. Low-impact style preferences may use best-effort model compliance and are labeled accordingly. Unknown guard IDs or executable code in parameters are rejected.

An LLM cannot grant itself permission by setting `protected: false`, inventing an approval token, or marking its own interpretation trusted.

## 8. Time and retroactivity

Policy changes are prospective by default. Disallowing future generation does not erase previously committed rooms or rewrite history. Deleting, retiring, or retconning existing content is a separate explicit operation.

Editor turns, inspections, and clarification do not advance fictional time. Play-time costs depend on the selected route and original game behavior. Read-only inspection does not call native `LOOK` merely because the output would be convenient.

Policy revisions are restored with the world during a branch restore, but authorization and freshness counters are not rolled back. The user is shown which policy is now active.

## 9. Minimal example

The synthetic [initial-policy.json](../examples/initial-policy.json) allows location and character generation in an approved exterior remix region, allows adaptive dialogue under a personality invariant, and preserves authored puzzle behavior. It does not grant a native topology bridge or imply that the illustrative region already exists in any real story. A fixture supplies its identity and membership for testing.

An initial “give me a key” clause would appear in the separate world patch, not as a perpetual policy entry. This separation is mandatory even when both parts originate in the same prompt.
