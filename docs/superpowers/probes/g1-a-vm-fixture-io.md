# G1-A feasibility probe: native fixture and interpreter I/O

**Owner issue:** [#11](https://github.com/dhar174/zmachine_if_remix_plugin/issues/11) under [#4](https://github.com/dhar174/zmachine_if_remix_plugin/issues/4). **Status:** proposed probe brief for authorization after #10 review; **not executed**.

## Question
Can a pinned Z-machine runtime execute a small redistributable v5 story faithfully through line and character input, report original startup side effects, and provide a suitable bounded I/O interface?

## Probe scope
1. Build a purpose-written redistributable Z5 fixture with original source and documented build permission. Cover startup effects, successful/failed commands, actual failed-action time cost, character menu, duplicate names, locked gate, controlled randomness and designated extension anchor.
2. Compare the earlier candidate (ifvms.js ZVM) with one maintained alternative behind the same minimal experimental I/O harness; verify versions and licenses at execution time.
3. Run startup, LOOK, INVENTORY, input transitions and failure tests; capture exact prompts, output, VM input kind, timers/events and story/compiler/runtime SHA/digests.
4. Try malformed/truncated fixtures under bounded execution; document host safety limits.

## Evidence / go-no-go
Record exact commands, runtime and tool versions, fixture digests, raw/redacted transcript, failures and unsupported semantics in `docs/evidence/g1-native-io.md`. Do not claim conformance from merely reaching a prompt. Advance to #12 only if the fixture and input boundary are reproducible; select a runtime only after #12 recovery results.

## Constraints and stop
No user's uploaded game, copyrighted story in CI, provider calls, hosted service, production adapter or native mutations. No automatic promotion of throwaway probe code. Stop on incompatible input model or isolation failure, and report the blocker.
