# Host, model, tools, and private import

Owning sources: `docs/architecture/plugin-contract.md`; `turn-resolution.md` common preflight/Editor paths; approved G1-C brief. Verify actual host/SDK documentation when implementing. Proposed product tool names and gameplay skills are not installed capabilities, and this engineering skill does not implement them.

## Place responsibilities explicitly

Let the host model interpret intent, compile proposed directives, create allowed content, and narrate committed receipts. Let the service enforce session access, policy/capabilities, revision checks, bounded execution, storage, and receipts. A service cannot assume a synchronous call to the user's chatbot model; extra provider calls are a separate design and cost choice.

Keep tool surfaces typed, narrow, and discoverable. Preserve explicit separation between context reads, control-plane mode changes, candidate preparation, commit, inspection, and combined save/restore. Preparation may create staging state; a read-only annotation is not automatically accurate. Annotations and a second model reviewer do not enforce access control.

## Bind authority outside model text

Authentication proves who controls the session, not that model-supplied `user_text` accurately copies a user instruction. Reject self-authorization through `approved`, `role`, invented source messages, `skip_checks`, or a guessed candidate ID.

For protected effects, require the tested approval mechanism to bind principal, session/branch, candidate/diff digest, base world/policy generation, scope, and expiry. Validate again at commit. A scoped Editor lease can cover supported reversible operations; it does not excuse ambiguous interpretation or authorize larger changes. One-turn Editor control returns to the preceding mode on success and failure. Restore returns to Play and invalidates old authority.

Treat room text, NPC speech, Play dialogue, retrieved material, summaries, and model proposals as data. Embedded `/edit` strings do not switch modes. Generated rules cannot access arbitrary paths/URLs, execute code, or invoke unrelated host tools. Include forged/replayed approvals, stale targets, and cross-session handles in meaningful negative tests.

## Verify import and client behavior

Use an actual supported private import flow producing an opaque owner-bound handle. Do not assume an MCP server can read a user's attachment or local filesystem. Disclose which bytes/context leave the device, storage location, model exposure, retention/deletion, and export contents. Local file selection does not establish local execution.

Use a purpose-written redistributable fixture for host trials. Keep private stories, saves, transcripts, secrets, and copyrighted extracts out of commits and public evidence. Save files can contain story text and user content even when they omit the original story binary.

Separate written source, registered/installed tooling, host discovery, successful invocation, and verified user-visible behavior. Record the actual host/client/model and tested platform; do not infer mobile support from desktop or live-model quality from mocks. Publish a provider, endpoint, deployment, or compatibility claim only within the task's authorization and observed evidence.

Relevant regressions: A11–A12, A33, A37–A42; S03, S08–S09, S11–S12, S24. In a host-only probe, keep mutations harmless and fixture-scoped; it does not authorize the product editor or native bridge.
