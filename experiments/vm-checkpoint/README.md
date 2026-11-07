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
88,576 bytes). The shared ifvms adapter exposes `__g1bInternals()` and records the original
story digest and size for checkpoint capture before the runtime mutates the
supplied story buffer.

## Run

```sh
cd experiments/vm-checkpoint
node --test          # format, identity, continuation, timed-input gates, round trips, isolation
```

Node >= 18 (tested on v24.13.0, Windows). Zero npm dependencies. Run from
this directory only (`node --test` does not honor .gitignore when sweeping
wider trees). Evidence and scratch files land in gitignored `results/`.

## Design (envelope v2)

A checkpoint is a versioned, **data-only** JSON envelope
(`lib/checkpoint-format.js`): identity (story digest/size, runtime name +
pinned runtime revision and build digest, adapter name and build digest,
Node/V8 version, platform, architecture, schema version), boundary kind
(`line`/`char`/`halted`), payload
(Quetzal `IFhd`+`UMem`+`Stks` from the upstream `vm.save_file(pc, 1)`
primitive, plus the RNG seed/mode, the plain-data `io` object, the pending
`read_data`, window text/cursor state, published transcript, request log),
a checksum over all envelope fields other than `integrity`, and a capability
statement that must exactly match the active implementation. Executable code
is never serialized (the JIT cache is rebuilt lazily).

**Identity, integrity and compatibility (Issue #43):** Capture binds the
original story bytes recorded when this adapter was created. Restore derives
the expected story digest and size from its own supplied bytes. Before a VM is
created, it compares the runtime/adapter names, pinned revision, runtime and
adapter source-build digests, Node and V8 versions, platform, architecture,
and schema against local implementation data. The runtime digest covers the
vendored `src` JavaScript tree; the adapter digest covers the adapter, Glk shim,
checkpoint contract/core/format, fingerprint and runner. This adapter file list
is explicit: when another file joins that execution surface, extend the list
and capture a new checkpoint. Identical source bytes at another path match.
Fingerprints are sampled on module initialization and assume source files
remain unchanged while the process runs; they do not attest the Node binary,
OS, or in-process code.

V2 uses SHA-256 over `zirp-g1b-envelope-v2\n` followed by experiment-specific
canonical JSON for every top-level field except `integrity` (object keys sorted
by JavaScript string order, array order preserved). The integrity object itself
has an exact checked shape. This unkeyed checksum detects changes only when it
is not recomputed: it is **not authentication**, a signature, or proof that
checkpoint data is trustworthy. Independently, imported capabilities must equal
the local statement and the pending line request's `maxlen` must be zero, as
passed by this pinned runtime; a recomputed checksum cannot expand those
capabilities or change that request metadata. Other well-formed payload data is
not protected against an author who can recompute the checksum. V2 permits
unknown top-level and payload keys; they are checksum-bound but ignored by the
current restore code. They do not grant capabilities. Reassess this contract
and its version before assigning restore semantics to such fields.

V2 intentionally rejects v1 with `E_VERSION`; there is no migration. Exact
build and Node/V8/platform/architecture comparisons also refuse restore on a
different build or host identity, even if it might otherwise be compatible.
Changing capability text or array order requires a new compatible capture.
Issue #44 changes `runner.js`, which is in the adapter-build fingerprint: a v2
checkpoint captured at baseline `3a7a00b` was rejected before readiness with
`E_RUNTIME` on the changed build. Capture a new checkpoint; no migration is
provided.
Validation first checks format/version and local story/runtime identity, then
boundary and payload structure and unsupported-state gates, then checksum,
then request/capability and cross-payload consistency. Thus an earlier error
can take precedence over a digest error (e.g. `E_RUNTIME` or `E_TIMED_INPUT`);
otherwise stale metadata is `E_DIGEST`, rehashed nonzero `maxlen` is
`E_BOUNDARY`, and rehashed capability differences are `E_CAPABILITY`.

**Capture** (`lib/checkpoint-core.js`): `vm.save_file(vm.pc, 1)` plus the
explicit supplement sections above, at a boundary where a request is pending
(or halted).

**Restore** (always into a fresh interpreter): full envelope validation
*before* any ZVM exists (format/version/identity/boundary/structure/size,
**deep validation of the nested `io`/windows/`readData` state restore
consumes — the `io` stream slots are validated down to their contents per
the vendored runtime's slot semantics (slot 0 = input stream, slot 1 =
screen flag, slot 2 = transcript state, slot 3 = the memory-output-stream
stack, slot 4 = command-recording state), read-continuation address/span
validation against the checkpointed memory image (Issue #41: an
honest-digest envelope pointing `bufaddr`/`parseaddr` at 0xFFFFFF used to
restore `ready:true` and fault on the first input — the continuation's
text-buffer and parse-table writes must fit writable dynamic memory
`[0x40, static base)`, with the buffer length tied to the checkpointed
capacity byte, `parseaddr = 0` kept as the no-tokenise sentinel, and
`parseaddr` barred from the text continuation write span; out-of-range
starts, near-end overflowing spans, and truncated tables are rejected
`E_BOUNDARY`, capacity/header inconsistencies `E_STRUCTURE`), quetzal
container validation that makes the validated memory image the image
restore actually applies (FORM area must equal the buffer exactly — no
trailing bytes — chunk headers may not straddle the declared area, and
compressed or multiple memory chunks are refused; `E_STRUCTURE`),
cross-section transcript↔window consistency after the digest verifies**, and
**rejection of unseeded RNG payloads — `E_RNG`**); a fresh
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

**Timed-input policy (Issue #42):** the pinned `read` and `read_char`
methods copy the optional `time` and `routine` arguments into `read_data`,
but neither the runtime nor the Glk shim schedules their callbacks. Missing
arguments are JavaScript `undefined` and disappear when the envelope is
cloned to JSON. Envelope v2 accepts an absent field or integer `0`; `null`,
negative and non-integer values are malformed (`E_STRUCTURE`). Either nonzero
operand is conservatively rejected at capture and restore (`E_TIMED_INPUT`),
including when the other is absent or zero. This is a checkpoint policy, not a
claim that a single nonzero operand creates a timer under the Z-machine
standard; [standard 1.1 §15](https://inform-fiction.org/zmachine/standards/z1point1/sect15.html)
describes periodic callbacks when both operands are supplied and nonzero. No
additional timer sentinel is supported. A halted envelope has no pending
`readData`; the shim has no timer event to reconstruct. These checks do not
intercept timed opcodes as they execute or implement clock reconstruction.

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

**Runner failure contract (Issue #44):** Exit `0` means clean termination;
`2` means a runner-argument or checkpoint rejection; `3` means the output limit
stopped the child; `4` means a protocol error, adapter error or caught request
exception. Parent-enforced timeouts kill and reap the child; they do not have a
portable numeric exit code. After readiness, malformed JSON, non-object JSON,
unknown operations and serialization without `--out` emit a structured
`{error, failed:true, detail}` response. An unknown `op` is rejected even if
an input accompanies it. Empty lines are ignored.

Failure is sticky across requests: later requests may still execute and their
responses describe those operations, but EOF or `op:exit` returns `4`. The
`detail` in protocol/exception errors retains the first failure; `error` names
the current error. An output-limit stop takes precedence and exits `3` even
after an earlier failure. Explicit exit stops processing later buffered lines
and closes stdin without waiting for the parent to close its pipe. With a
working stdout reader, queued responses drain before normal termination; a
broken pipe or killed process does not guarantee delivery. A parent must check
the final status before using candidate output or a serialized candidate;
this probe does not implement durable publication or receipt recovery. The
`--selftest step-error | throw` flag is test scaffolding that deterministically
drives the two adapter/exception paths (real pinned stories cannot be driven to
a VM error on demand).

## Tests

- `tests/runner-protocol.test.js` — ordinary-child protocol failures with EOF
  and explicit exit, sticky failures across requests, queued-output drain,
  clean input/serialization, and distinct output-limit/checkpoint exits; the
  live baseline is rechecked after each case.
- `tests/identity-integrity.test.js` — trusted capture/restore story identity,
  v1 rejection, canonical checksums, runtime/adapter and build mutations,
  metadata and capability mutations with stale and recomputed checksums,
  pre-VM rejection, and identical-source/different-path restore controls.
- `tests/format.test.js` — envelope validation: magic/version/identity/
  boundary/digest/structure/size rejections (A34), and the VM-level Quetzal
  IFhd rejection behind them.
- `tests/continuation.test.js` — read-continuation address/span validation
  (Issue #41, A34): the reported `bufaddr`/`parseaddr = 0xFFFFFF` repro and
  near-end/truncated-span/capacity/header mutants are rejected with
  `E_BOUNDARY`/`E_STRUCTURE` before any interpreter exists, through the
  ordinary restoring child (no `--selftest`) with exit 2 and a byte-identical
  baseline recapture after every rejection; genuine seeded line/char/halted
  captures stay valid, and `parseaddr = 0` remains the legal no-tokenise
  sentinel. Spans are derived from the checkpointed UMem image at runtime —
  no fixture addresses are hardcoded.
- `tests/timed-input.test.js` — capture and ordinary-child restore reject
  honest-digest nonzero timer operands at both line and character boundaries
  with matching `E_TIMED_INPUT` diagnostics; malformed fields reject with
  `E_STRUCTURE`, baseline recaptures stay byte-identical, and zero/absent
  controls remain valid. Direct calls to the pinned read methods verify which
  operands they store; they are not timed-opcode execution trials.
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

Timed input (the runtime stores `read_data.time`/`routine` but does not schedule
callbacks; Flags1 timed-input bit clear; nonzero operands reject at capture
and validation with `E_TIMED_INPUT`), sound and graphics (no-op / absent
opcodes), Glk file streams
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
