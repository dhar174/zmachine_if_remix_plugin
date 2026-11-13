# G2-B directive compiler

[Issue #15](https://github.com/dhar174/zmachine_if_remix_plugin/issues/15) starts from `eeb2cf5336f38ca8d56e36ac865f37442f1189a7`, the merge of the accepted #14 foundation.

## Implementation and ownership

- `engine/src/policy/directive-contracts.ts` owns versioned compiler input, model interpretation, inactive result and subset selection. It reuses #14's schemas. The public model JSON Schema is generated from the same definition.
- `engine/src/policy/directive-compiler.ts` validates source and context binding, assigns clause dispositions, builds v1 proposal payloads, selects exact subsets, and renders previews. `directive-scopes.ts` checks explicit replacement and retained scopes against the caller's active snapshot.
- `engine/tests/directive-compiler.test.ts` verifies A02–A06 and A09 at the proposal boundary, exact Unicode source coverage, lineage, guard definitions, digest and subset behavior.
- [Compiler contract and prompt reference](../../contracts/directive-compiler.md) defines the handoff. #16 owns effect evaluation, #17 owns authority, #18 owns publication and #19 owns live-model evidence.

## Validation and delivery

Run the focused Node test, schema tests, full engine suite, build, typecheck and lint on Node 24. Verify the PR's Windows and Ubuntu checks and separate Node 26 job. Supply the exact diff and local receipts for independent Zcode GLM-5.3-Flash review with a verified read-only tool surface. Resolve substantive findings and review again before opening one PR against main. Leave the PR and issue open. Record a review blocker if the required model or tool restriction is unavailable.
