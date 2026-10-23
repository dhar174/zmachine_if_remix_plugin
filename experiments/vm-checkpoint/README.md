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
(`lib/checkpoint-format.js`): identity (story digest/size, runtime + adapter
revision, schema version), boundary kind (`line`/`char`/`halted`), payload
(Quetzal `IFhd`+`UMem`+`Stks` from the upstream `vm.save_file(pc, 1)`
primitive, plus the RNG seed/mode, the plain-data `io` object, the pending
`read_data`, window text/cursor state, published transcript, request log),
an integrity digest over the payload, and a capability statement. Executable
code is never serialized (the JIT cache is rebuilt lazily).

**Capture** (`lib/checkpoint-core.js`): `vm.save_file(vm.pc, 1)` plus the
explicit supplement sections above, at a boundary where a request is pending
(or halted).

**Restore** (always into a fresh interpreter): full envelope validation
*before* any ZVM exists (format/version/identity/structure/digest/boundary/
size; stable `E_*` codes); a fresh adapter runs its normal startup so
windows/origram/stack exist, then `vm.restore_file(quetzal, 1)` re-verifies
story identity (release/serial/checksum) and rebuilds memory/stacks/pc; the
interpreter-owned header block `[0x00..0x40)` is written back verbatim
(`update_header()` recomputes screen-size fields in a window-set-dependent
way and must not stand in for the source values); `io`, RNG seed (re-applied
*after* restore because `update_header()` zeroes it), pending request (re-
issued against the restored `read_data` buffer), and the published
transcript are then applied, and the output-delta watermark is synced so no
prefix text is ever republished.

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
no environment value reaches an argv element or a file path.

## Tests

- `tests/format.test.js` — envelope validation: magic/version/identity/
  boundary/digest/structure/size rejections (A34), and the VM-level Quetzal
  IFhd rejection behind them.
- `tests/roundtrip.test.js` — the boundary matrix, each case run twice and
  compared against an uninterrupted reference run: full output/grid/markers
  equality after every suffix step (never marker-only), machine-state
  fingerprint equality (ram/stack/globals digests, pc, frames, seed, request
  log), no-republish, pending-request reconstruction. Cases: initial prompt;
  post-movement/failed-action/daemon-chime prompt; parser disambiguation;
  read_char menu pending; boundary after a menu answer (no duplicate
  delivery); seeded RNG across draws and reseeding; unseeded RNG (draws are
  per-process entropy and are normalized — everything around them must
  match); endgame prompt → halt; restored-halt input refusal; declared-
  unsupported undo safety.
- `tests/isolation.test.js` — candidate discard (two sequential candidates;
  baseline checkpoint byte-identical, transcript unchanged, continuation
  equal to a never-candidated control) (A15); kills during bootstrap, at the
  boundary, during the serialization phase, and pre-publication; unbounded
  spinloop child preempted by a parent deadline and reaped; output limit;
  seven hostile-checkpoint variants rejected in children (A34).

## Declared unsupported (with source evidence, not silent)

Timed input (`read_data.time` stored but never used; Flags1 timed-input bit
clear), sound and graphics (no-op / absent opcodes), Glk file streams
(glksim records them as unexpected), interpreter number/version header
fields (never written), and in-memory undo history (dropped on restore,
matching upstream ifvms autosave semantics — `@restore_undo` after restore
is safe and empty; tested).

The full state-inventory classification, the Bocfel 2.6 checkpoint-route
investigation, acceptance mapping (A15/A16/A28/A29/A31/A34), and the
go/no-go recommendation live in `docs/evidence/g1-vm-recovery.md`.
