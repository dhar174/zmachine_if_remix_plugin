# experiments/vm-checkpoint — G1-B checkpoint probe (Issue #12)

Experimental probe code for Issue #12: prove that a pinned native interpreter
(the vendored ifvms.js ZVM at the G1-A-pinned revision) can be **checkpointed
at real line/character input boundaries, destroyed, restored into a fresh
process, and continued identically** — and that discarded speculative
candidates cannot affect the baseline. Probe code, **not** a production
adapter or a product checkpoint format; nothing here freezes a contract.

Baseline dependencies (never duplicated): `experiments/vm-io/` (adapter,
glksim, vendored ifvms) and `tests/fixtures/zmachine/fixture.z5`
(SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`,
88,576 bytes). The only shared-code change is the additive
`__g1bInternals()` accessor on the ifvms adapter (exposes the live shim
state, ZVM instance, Glk object, and `settle()`; no behavior change).

## Run

```sh
cd experiments/vm-checkpoint
node --test          # 33 tests: format validation, round-trip matrix, isolation
```

Node >= 18 (tested on v24.13.0, Windows). Zero npm dependencies. Run from
this directory only (`node --test` does not honor .gitignore when sweeping
wider trees). Evidence and scratch files land in gitignored `results/`.

## Design (envelope v1)

A checkpoint is a versioned, **data-only** JSON envelope
(`lib/checkpoint-format.js`): identity (story digest/size, runtime name +
pinned runtime revision, adapter name, schema version), boundary kind
(`line`/`char`/`halted`), payload
(Quetzal `IFhd`+`UMem`+`Stks` from the upstream `vm.save_file(pc, 1)`
primitive, plus the RNG seed/mode, the plain-data `io` object, the pending
`read_data`, window text/cursor state, published transcript, request log),
an integrity digest over the payload, and a capability statement. Executable
code is never serialized (the JIT cache is rebuilt lazily).

**Capture** (`lib/checkpoint-core.js`): `vm.save_file(vm.pc, 1)` plus the
explicit supplement sections above, at a boundary where a request is pending
(or halted).

**Restore** (always into a fresh interpreter): full envelope validation
*before* any ZVM exists (format/version/identity/boundary/structure/size,
**deep validation of the nested `io`/windows/`readData` state restore
consumes — the `io` stream slots are validated down to their contents per
the vendored runtime's slot semantics (slot 0 = input stream, slot 1 =
screen flag, slot 2 = transcript state, slot 3 = the memory-output-stream
stack, slot 4 = command-recording state), cross-section
transcript↔window consistency after the digest verifies**, and **rejection
of unseeded RNG payloads — `E_RNG`**); a fresh
adapter runs its normal startup so windows/origram/stack exist, then
`vm.restore_file(quetzal, 1)` re-verifies story identity
(release/serial/checksum) and rebuilds memory/stacks/pc; the
interpreter-owned header block `[0x00..0x40)` is written back verbatim
(`update_header()` recomputes screen-size fields in a window-set-dependent
way and must not stand in for the source values); `io`, RNG seed (re-applied
*after* restore because `update_header()` zeroes it), pending request (re-
issued against the restored `read_data` buffer), and the published
transcript are then applied, and the output-delta watermark is synced so no
prefix text is ever republished. **Capture runs the same validation on its
own output**, so a state the envelope cannot carry is refused at the source
with the same codes restore uses.

**RNG policy:** checkpointable boundaries require the game to be in **seeded
(predictable) mode**. Unseeded capture is refused at the source (`E_RNG`)
and unseeded envelopes are rejected at validation: draws in that mode come
from host `Math.random`, whose state can be neither captured nor
reconstructed across processes, and restoring one would silently switch the
RNG semantics — forbidden by state-and-vm-bridge §8 and Issue #12's
fail-explicitly rule. Seeded continuation is exact (identical draws and
seed across process death).

Three rules the harness learned the hard way (documented in code comments
and `docs/evidence/g1-vm-recovery.md`):

1. The vendored ZVM **mutates the story buffer in place** — every interpreter
   gets its own copy of the story bytes.
2. Interpreter-owned header fields must be checkpointed, not recomputed.
3. The current frame's in-buffer `sp` slot is stale in a live interpreter
   (authoritative `sp` is a VM field) — it is dead storage and is excluded
   from the stack fingerprint.

**Fresh-process restore** (`lib/runner.js`): a child process restores from
the checkpoint file plus the pinned fixture path only — no closure,
singleton, or shared buffer survives the process boundary. Protocol:
`{"ready":true,...}` on stdout, then one JSON request per stdin line
(`input`, `op:fingerprint`, `op:serialize`, `op:exit`). All argv is static;
no environment value reaches an argv element or a file path. **Exit codes:
0 clean; 2 checkpoint rejected; 3 output limit exceeded; 4 candidate
execution failed** (an adapter step reporting `error`, or a thrown
exception — the failure evidence is still emitted, so the transcript of a
failed run survives, but exit-code callers can never mistake a failed
candidate for a clean run; EOF after a failure also exits 4). The
`--selftest step-error | throw` flag is test scaffolding that
deterministically drives the two failure-accounting paths (real pinned
stories cannot be driven to a VM error on demand).

## Tests

- `tests/format.test.js` — envelope validation: magic/version/identity/
  boundary/digest/structure/size rejections (A34), and the VM-level Quetzal
  IFhd rejection behind them.
- `tests/roundtrip.test.js` — the boundary matrix, each case run twice and
  compared against an uninterrupted reference run: full output/grid/markers
  equality after every suffix step (never marker-only), machine-state
  fingerprint equality (ram/stack/globals digests, pc, frames, seed, request
  log), no-republish, pending-request reconstruction. All captures are
  **seeded** (unseeded capture is refused with `E_RNG` — covered as its own
  case). Cases: post-movement/failed-action/daemon-chime prompt; parser
  disambiguation; read_char menu pending; boundary after a menu answer (no
  duplicate delivery); seeded RNG across draws and reseeding (exact draws +
  seed); endgame prompt → halt; the unseeded capture gate; restored-halt
  input refusal; declared-unsupported undo safety.
- `tests/isolation.test.js` — candidate discard (two sequential candidates;
  baseline checkpoint byte-identical, transcript unchanged, continuation
  equal to a never-candidated control) (A15); kills during bootstrap, at the
  boundary, during the serialization phase, and pre-publication; unbounded
  spinloop child preempted by a parent deadline and reaped; output limit;
  thirteen hostile-checkpoint variants rejected in children — nested-state
  malformations (empty io, missing main window, empty char readData,
  transcript/window disagreement, pending memory-output-stream stack
  entries) and an honest unseeded envelope (`E_RNG`)
  alongside the identity/digest/boundary/corrupt-quetzal cases (A34); and
  the runner's failure accounting (exit 4 for returned errors and thrown
  exceptions, via the selftest modes).

## Declared unsupported (with source evidence, not silent)

Timed input (`read_data.time` stored but never used; Flags1 timed-input bit
clear), sound and graphics (no-op / absent opcodes), Glk file streams
(glksim records them as unexpected), interpreter number/version header
fields (never written), **pending `output_stream 3` memory-stream writes
and redirected input — nonempty memory-stream stacks, file-backed
transcript/command stream state, and non-keyboard input are rejected with
`E_STRUCTURE` at capture and at validation: the write-back path has no
round-trip evidence and live Glk stream references cannot cross a data-only
envelope** (the fixture never selects these streams), **unseeded RNG
checkpoints (rejected with `E_RNG` at capture and at validation — host
`Math.random` state is not reconstructable across processes)**, and
in-memory undo history (dropped on
restore, matching upstream ifvms autosave semantics — `@restore_undo` after
restore is safe and empty; tested).

The full state-inventory classification, the Bocfel 2.6 checkpoint-route
investigation, acceptance mapping (A15/A16/A28/A29/A31/A34), and the
go/no-go recommendation live in `docs/evidence/g1-vm-recovery.md`.
