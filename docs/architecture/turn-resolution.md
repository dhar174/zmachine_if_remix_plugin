# Play/Editor turn-resolution algorithm

**Proposed algorithm v0.2; not implemented.** [World policy](world-policy.md) defines permission semantics; [state/VM bridge](state-and-vm-bridge.md) defines persistence; [plugin contract](plugin-contract.md) defines the host boundary.

## 1. Design objective

Use the LLM as interpreter, creative author, character performer, and narrator while keeping authority, state mutation, and recovery explicit. A player action is an attempt. An editor instruction specifies a desired change. Neither is guaranteed successful until the engine commits a supported result.

The engine returns facts and compact decision explanations, not hidden model reasoning. A valid plan identifies its state reads, intended effects, source directives, native/overlay owners, policy rules, and required capabilities.

## 2. Request and result records

A conceptual `TurnEnvelope` contains `session_id`, `branch_id`, `request_id`, `expected_revision`, `expected_policy_revision`, the server-owned mode/lease reference, user input, input provenance level, and optional explicit intent metadata. It never accepts a self-authorizing `is_editor: true` flag.

A `TurnProposal` contains normalized intent, resolved entity IDs, route, requested operations, complete known effect footprint, applicable rule/guard IDs, unresolved items, time semantics, and bounded generation requests. Generated content is data, not executable code. The server resolves operation implementations and cannot be instructed to skip validation.

A `TurnReceipt` contains outcome, committed revision if any, pre/post hashes or checkpoint references, native output, committed events, permitted narration facts, visibility limits, time cost, policy references, warnings, and retry guidance. Invalid proposals may create an operational audit entry but must not change world state or fictional time.

Outcomes distinguish `COMMITTED`, `NEEDS_CLARIFICATION`, `NEEDS_APPROVAL`, `POLICY_CONFLICT`, `CAPABILITY_MISSING`, `STALE_REVISION`, `VALIDATION_FAILED`, and `ABORTED`. A receipt can be `COMMITTED` with an in-fiction failed action: a failed native attempt may legitimately consume a turn and run a timer. This is not the same as a pre-execution validation failure.

## 3. Common preflight

**A. Authenticate and deduplicate.** Verify user/session access. Look up `(principal, session, branch, request_id)` with a canonical request digest. An identical completed request returns its saved receipt; reuse with a different payload is an error. Concurrent duplicates join or report the same in-flight operation rather than advancing twice.

**B. Establish control semantics.** Read server-owned mode and pending VM input type. Proposed syntax is `/edit` alone for persistent Editor, `/play` for persistent Play, and `/edit <instruction>` for a one-turn editor request that returns to the prior mode. These are control conventions, not yet installed commands. Explicit controls change mode or specify a single-turn override only using trusted authorization. A quoted “/edit” inside NPC/player dialogue is not a control. A Play instruction that seems authorial returns a clarification, not silent privilege escalation. Mixed mode/action requests must be explicitly segmented or clarified.

**C. Read a consistent revision.** Fetch policy, current location, visible entities, relevant relationships/memories, existing rules, outstanding VM prompt, capability manifest, and the input revision. This is a bounded projection, not a raw dump of globals, hidden puzzle answers, or the entire binary. Duplicate names are resolved with IDs and context.

**D. Classify the request.** Help and inspection are read-only queries. Editor changes take the Editor path. Play actions take the Play path. A factual “what am I carrying?” query may use the read-only projection; explicitly executing a native command is a different request with the story's own time semantics.

Clarifications, explanations, and model thinking do not tick game clocks. The coordinator does not hold the commit lock while waiting for the model or user.

## 4. Play path

### P1. Interpret intent without assuming success

Extract action, targets, speech acts, and any sequential subactions. “I tell the guard I have permission” creates a claim; it does not grant permission. “I open the locked door” is an attempt; it does not remove the lock.

Use the original scene and policy to interpret synonymous phrasing, not to give the player hints they did not request. A model may already know a game from training; limited retrieval alone cannot guarantee spoiler avoidance. Evaluate actual outputs for spoiler leakage.

### P2. Check evidence and route

Identify native, remix, or bridged execution from registered capabilities and current ownership, not from the model's confidence alone.

- **Native:** authored logic is applicable and not intentionally superseded; use the native command/input capability.
- **Remix:** the action is governed by supported overlay mechanics or a permitted generated rule.
- **Bridged:** the effect crosses owners and a tested adapter declares how to synchronize it.
- **Unresolved:** ambiguity, unmapped critical state, unknown ownership, or unsupported input type requires clarification or a capability limitation.

Distinguish “the original parser does not recognize that phrasing,” “the game explicitly establishes that this is impossible,” and “we do not know.” Absence from an object dump is not sufficient proof that a fictional detail does not exist.

### P3. Plan permitted invention, only when needed

When the original cannot represent the requested action, the LLM may propose an extension only within active generation rules. It may create a persistent location, item, character, or bounded rule, but must enumerate consequences and required connections.

A permission to explore outside the original map does not imply permission to invent an unlocked back entrance into a protected puzzle room. Evaluate the whole proposed chain, including dependencies and routes. Avoid generating novelty merely because permission exists; prefer established facts and capabilities where they meet the intent.

### P4. Validate before speculative execution

Check schema, identity, mode, active policy, source provenance, operation whitelist, ownership, preconditions, invariant applicability, effect coverage, budgets, pending input, and checkpoint capability. A missing native adapter is `CAPABILITY_MISSING`, not permission to emulate a successful native edit in prose.

Separate deterministic checks from semantic judgments. Qualitative constraints may require a bounded model evaluation; high-impact unresolved judgments block the proposal. A model-written assertion that “all policies passed” has no authority by itself.

### P5. Stage one logical turn

Create an isolated candidate from the verified combined checkpoint. Execute the selected route there, with VM and rule-engine budgets. Do not publish output or stream consequential narration before commit. The candidate may return a new input boundary, a finished game, or a handled fault.

Native commands are not tried on the live state merely to see whether they fail. Parser outcome detection requires adapter instrumentation; searching output for “can't” is not sufficient. If reliable speculative rollback or classification is unavailable, run one explicitly selected native attempt and report its actual result, or stop before execution. Do not add an AI fallback after an already committed native failure without a new authorized turn.

At a native character/menu prompt, route input through the required character interface. Do not send a natural-language line command to a `read_char` prompt. Editor operations while such a prompt is pending require verified checkpoint and mutation support for that boundary; otherwise defer or report the limitation.

### P6. Resolve effects and events

Compute the actual known effect footprint and time outcome. Apply overlay rules only through registered declarative primitives. An initial event budget is proposed at a maximum of 32 triggered effects per turn and an acyclic bounded rule expansion; tune after testing, never silently drop excess effects. Exceeding the configured budget aborts the candidate rather than committing a partial cascade.

Record exact causal outcomes and random draws. Native timers follow native semantics. Overlay clocks follow the supported clock bridge. Do not run native code a second time solely to advance time for an overlay action unless a tested clock capability defines that operation.

Dialogue that changes knowledge, promises, relationships, or commitments has explicit events. Stage exact consequential speech with its effects before commit, or record it in a separately ordered dialogue transaction before showing it. Pure stylistic narration is not another unlogged state transition.

### P7. Verify and commit

Verify postconditions, ownership consistency, full snapshot restorability, and protected invariants with declared coverage. Postcondition checks occur inside the candidate. If native hidden state may have been affected outside the adapter's verified coverage, a synthesized protected intervention cannot be certified safe.

Acquire the short commit lock and compare the current branch/session and policy revisions with the proposal. On mismatch discard the candidate and return `STALE_REVISION`; do not automatically apply the old plan to fresh state. On success durably store the candidate checkpoint and event records, then atomically publish the new head and receipt as described in the state contract.

### P8. Narrate from the receipt

The host model receives verified public facts and committed events. It may phrase them naturally but cannot invent new exits, ownership, promises, outcomes, or knowledge. Native output is available for faithful rendering. Hidden outcomes are represented as private engine events and excluded from the public narration projection unless discovered or explicitly requested in authorized Editor inspection.

A chat host may still hallucinate outside tool calls. The engine can prevent that prose from becoming state, but cannot mathematically guarantee every free-form sentence. Skills, constrained fact packets, output audits, and acceptance tests reduce this risk. When detected, correct the narration; do not retroactively mutate the world to make the hallucination true.

## 5. Editor path

### E1. Compile the specification

Classify each clause as a one-time state assignment, persistent policy change, protected invariant amendment, preference, or historical retcon. Resolve stable IDs and future scope. Show unresolved meanings and do not silently interpret them permissively.

### E2. Produce an effect and policy diff

Preview changed entities/fields, rule additions/replacements, source clauses, dependency impacts, native versus overlay ownership, capabilities, affected existing facts, expected time cost (normally zero), and known limitations. A current explicit edit is not automatically a lasting rule.

For changed protections, identify exact superseded rule IDs. Keep unaffected portions of broader rules. A future-generation prohibition leaves already generated content intact unless removal is separately specified.

### E3. Confirm authority where needed

Follow host/service approval requirements. Unambiguous reversible edits within an already authorized editor scope can use that scope. Protection weakening, retcons, deletion with dependencies, external publication, and new permission scopes require exact-change approval. External publication is outside the first engine capability set.

Where the host does not attest the user message, model-supplied text is not enough for hard authorial provenance. Use a tested user confirmation boundary tied to the diff digest, or refuse privileged commit. Mode-switch UX and this transport limitation must be described honestly.

### E4. Apply atomically

Validate, stage, verify, and commit the complete approved bundle using the same coordinator as Play. No fictional time passes. No implicit catch-up timer runs when returning to Play. Failure leaves policy and world unchanged together, not a newly activated policy with half-applied content.

A native personality/dialogue takeover requires control of all relevant interaction surfaces or a clearly bounded, approved takeover. If original scripts would still contradict the new facts and no bridge controls them, block the claimed complete change and explain the narrower supported alternative.

### E5. Return a useful receipt

Describe what changed, what stayed protected, the new revision and policy revision, and the supported undo/branch mechanism. Do not enter Play and execute an implied player action unless the user explicitly included it.

## 6. Conceptual pseudocode

This is explanatory pseudocode, not an implemented runtime API. In ChatGPT, the model-side steps span tool calls; an MCP server does not call an imaginary local `ChatGPT()` function.

```text
resolve(request):
    authorize_session(request)
    return_saved_receipt_or_reserve_idempotency_key(request)
    context = read_consistent_projection(request.expected_revision)
    control = resolve_explicit_control(context, request)
    if ambiguous(control): return NEEDS_CLARIFICATION
    if is_read_only_query(request): return render_safe_query(context)

    proposal = host_model_proposal(context, control, request)
    check_authority_policy_capabilities(proposal, context)
    if unresolved(proposal): return precise_nonmutating_outcome(proposal)
    obtain_required_approval_bound_to_proposal_digest(proposal)

    candidate = restore_isolated_combined_checkpoint(context.checkpoint)
    actual = execute_one_logical_turn(candidate, proposal, budgets)
    verify_actual_effects_and_invariants(candidate, actual, context.policy)
    receipt = commit_if_head_unchanged(candidate, actual, request)
    return receipt
```

A staging handle can survive multiple model/tool round trips, but it expires and is invalidated by branch, policy, mode, or revision changes. Abandoned candidates never become live state.

## 7. Recovery and concurrency cases

A crash before head publication leaves an unreachable candidate for cleanup. A crash after durable commit but before response returns the same saved receipt on retry. No client retry may repeat the native action. A failed engine attempt and an in-fiction failed action have different records.

Restoring or undoing creates a new monotonic session generation/head referencing the selected historical world; it never reuses the old freshness counter. Old proposals, approvals, and mode leases expire. Full-engine replay uses stored events and recorded draws, not fresh LLM generation.

For “go north, open the door, take the key,” execute separate subturns with an explicit stopping policy, normally stop on ambiguity or failure. A blocked first action must not cause the later actions to execute in the wrong room.

The [acceptance matrix](../quality/acceptance-matrix.md) supplies observable tests for these cases.
