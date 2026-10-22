# G1-B feasibility probe: complete native checkpoint and isolation

**Owner issue:** [#12](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12). **Prerequisite:** tested fixture/I/O from #11 and accepted scope in #10. **Status:** proposed, not executed.

## Question
Can the chosen runtime checkpoint and recover a live native execution at both line and character input boundaries, with no leakage from rejected speculative actions?

## Scope
1. Inventory all state required to resume: dynamic memory, program counter, call frames/stacks, pending I/O/read continuation, applicable timers/sound/status, RNG mode/state or controlled random outcomes and runtime/story/schema identifiers.
2. Save a checkpoint, kill/recreate runtime, restore, run the same subsequent commands and compare state fingerprints, outputs, timers and RNG outcomes.
3. Run speculative actions in isolated candidate instances; discard a time/RNG-consuming candidate and verify unchanged baseline including unpublished output.
4. Inject corrupt/mismatched checkpoint, wrong story hash/runtime version, timeout and failed reconstruction.
5. Identify any unsupported timed input, terminal behavior or startup hook required by D07/D09; report capabilities precisely.

## Evidence / gate
Record exact commands, digests, code pin, comparator methods, successful/failed runs and known limits in `docs/evidence/g1-vm-recovery.md`. **Production native staging is blocked** without complete relevant recovery; a RAM-only snapshot is insufficient. This proof does not establish atomic database commits or live ChatGPT compatibility.

## Exclusions
No user story publication, product state store, paid models, public deployments or general retcon/merge mechanics.
