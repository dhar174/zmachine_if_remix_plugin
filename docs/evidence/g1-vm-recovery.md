# G1-B evidence: native VM checkpoint, recovery, and candidate isolation probe

**Historical status (2026-11-08):** The experimental probe for [#12](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12) merged in [PR #37](https://github.com/dhar174/zmachine_if_remix_plugin/pull/37) on 2026-10-23 (2026-10-24 UTC). Final head: `4f37f6a327459554f3c2cedfb08496a9f391e66d`. Merge: `73e7a6ebc86263201e7a2cdcc21ddd05304e5506`. [Probe brief](../superpowers/plans/2026-10-22-g1-b-checkpoint-probe.md). D39 was proposed and owner-unapproved. See [the current evidence baseline](#current-evidence-baseline-2026-11-08) and [acceptance mapping](#9-acceptance-mapping).

The [November 9 owner decision](../decisions/decision-register.md#d39-owner-decision)
accepts D39 for the documented seeded Z5 fixture scope. Statements below about
the proposal record its status at the time of the probe and follow-up reviews.

## 1. Executive findings

**Conditional recommendation for the pinned ifvms.js ZVM.** Seeded line, character, and halted checkpoint round trips matched the supported state, transcript, and continuation of the fixture controls. The current interruption suite uses acknowledged barriers, including before capture and after the separate test writer produces a partial file. Discarded candidates and cancellation after clean child exit left the baseline and simulated publication store unchanged. The acceptance mapping below identifies the scope of each result.

Unseeded (random-mode) RNG checkpoints are **rejected outright** (stable code `E_RNG`) at capture and at restore-validation: draws in that mode come from `Math.random` (the only host-entropy point in the vendored tree), whose state the envelope can neither capture, inject, nor record — restoring one would silently switch the RNG semantics to the restoring process's entropy, which `docs/architecture/state-and-vm-bridge.md` §8 forbids and Issue #12 requires to fail explicitly. The demonstrated matrix is therefore the **seeded path**: checkpointable boundaries require the game to be in seeded (predictable) mode, seeded continuation is exact (identical draws and seed across process death), and the unseeded opening prompt of the canonical fixture is refused at the source. The restoring runner also exits nonzero (4) after an adapter error, a caught request exception, or the protocol errors covered by Issue #44; an output-limit stop uses exit 3. The detailed precedence and delivery limits are recorded in §3.

**Bocfel 2.6 remains an independently tested reference, without a complete alternative checkpoint qualification.** The [#51 pinned-source harness and retained evidence](bocfel-autosave-2026-11-08/README.md) reproduce seeded line continuation `(5, 4)` and the historical canonical-menu restore error in 3/3 trials each. That menu uses a **zero-operand read_char**, not the standard's required device operand 1; a separate conforming character control restores successfully (3/3, key 98 and seeded roll 1). The old failure therefore does not establish a general valid-character restoration defect. Random mode omits Rand and does not recover the controlled `-Z` file cursor (uninterrupted 6,1 versus restored 1,2). These fixture/build-specific results do not select or integrate Bocfel. The ifvms proposal remains grounded in its own passing checkpoint tests.

## 2. Test environment

### Historical observations

| Item | Value |
| --- | --- |
| Date | 2026-10-23 |
| OS | Windows 10.0.26340 x64 (Git Bash; WSL2 for Bocfel) |
| Node | v24.13.0 |
| Branch / base | `codex/issue-12-g1b-vm-checkpoint`; probe code and evidence recorded from the branch as it grew (probe suite commit `4a4b5e3`, evidence `ca618a5`, review hardening in the final commit; base main @ `8c330ce` — PR #36 merge verified present, no newer commits at probe start) |
| Fixture | `tests/fixtures/zmachine/fixture.z5`, SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, 88,576 bytes (verified from the checkout; Inform 6.44 + Library 6.12.8, unmodified from G1-A) |
| Primary candidate | vendored ifvms.js ZVM, revision `6ac63e6b61144d4353a168df16c4ad5c22526f88` (MIT; `experiments/vm-io/vendor/ifvms`) |
| Bocfel reference | Bocfel 2.6 non-Glk build via WSL2; tarball SHA-1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da` (`experiments/vm-io/tools/bocfel-2.6.tar.gz`, pinned by G1-A) |
| Suite | `experiments/vm-checkpoint` (`node --test` from that directory), zero npm dependencies: 33 tests at the original report `ca618a5`, 47 at `7935cc8`, and 49 at PR #55 final head `bf71725` |

Baseline verification runs recorded before probe work (actual counts, not assumed): fixture integrity suite 3 tests / 2 pass / 1 machine-dependent skip (pinned Inform compiler absent; digest evidence stands); vm-io harness suite at its then-current size (54 tests) **54 / 52 pass / 1 machine-dependent skip / 1 fail reproduced 5/5 runs** — a pre-existing G1-A defect, fixed in an isolated commit (see §8; the suite grew to 57 tests when the lock-regression tests were added, and post-fix it records 57 / 56 pass / 1 skip / 0 fail).

### Current evidence baseline (2026-11-08)

The [original PR #37 draft head `22fba7a`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/22fba7a1fcfad0aea7769736893af887879e1c16) described a normalized unseeded comparison and seven hostile variants. The final head rejected unseeded capture and restore with `E_RNG` and recorded thirteen hostile child variants (twelve stable codes and one VM-level rejection). These are historical observations from different revisions. At merge `73e7a6e`, [checkpoint CI](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/40047065287) passed 33/33 on both Windows and Ubuntu. [Probe CI](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/40047065355) passed VM-I/O 39/41 on Windows (2 skips) and 37/41 on Ubuntu (4 skips). The hosted VM-I/O skips were two Bocfel availability cases on both platforms and two Windows-path cases on Ubuntu. Fixture integrity passed 2/3 on each platform (pinned compiler absent).

The current evidence is pinned to `b3569ff671a8ff8de49ab866e4f726345d5ceef2` (PR #70 merge). The 88,576-byte Z5 fixture and upstream ifvms revision are listed above. Runtime source build: `d225d898a0c93b7efc020549d16bda391561632c3cc5b06dc62119d498863454`. Checkpoint adapter build: `2fd2b4f6ffcd00759e8d73c76c09633f833595f47b3bb2d651e817494d36b736`. These are the builds recorded for #49 and retained through #51.

| Retained run | Observed result |
| --- | --- |
| [Checkpoint CI](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513868643) | 141/141 on Windows and Ubuntu, zero skips |
| [Probe CI](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513868570) | VM-I/O Windows 65/67 (2 skips), Ubuntu 62/67 (5 skips). Fixture 2/3 (pinned compiler absent) and checkout normalization 1/1 on each platform. |
| [#51 local verification](bocfel-autosave-2026-11-08/README.md#verification-and-acceptance-mapping) | VM-I/O 82/83 on Windows with WSL Bocfel installed (the no-WSL case skips). Distinct from the hosted inventory. |
| [Bocfel reference CI](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513868563) | Ubuntu 12/12 native comparisons and 21/21 Python units. Windows 15/21 units (6 POSIX skips). [Retained bundle](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513868563/artifacts/13630213945). |
| [CodeQL](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513868467) and [CodeQL including Python](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42513880309) | Successful at the same merge. The two older workflow-permissions alerts remain separate from checkpoint evidence. |

The checked child entries and closeout links are in [#40](https://github.com/dhar174/zmachine_if_remix_plugin/issues/40). The relevant merges delimit each result:

| Child | Merge evidence and disposition |
| --- | --- |
| [#41](https://github.com/dhar174/zmachine_if_remix_plugin/issues/41) | [`c58163e`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/c58163e0c06bc288c2e27e5ecb1221b354eafaef) adds continuation span and image validation. [`5e30823`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/5e308239ad66ede6b84aeaf2045c02deb89b3fa2) and [`5d5a974`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/5d5a974afa97d28850ba53c357b282f1ab838e4c) finish the closeout and VM-I/O diagnostics. |
| [#42](https://github.com/dhar174/zmachine_if_remix_plugin/issues/42) | [`8a5ad82`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/8a5ad82333996eb0c86b64ad17de6e71c93b58b3) rejects active timed operands at capture and restore. |
| [#43](https://github.com/dhar174/zmachine_if_remix_plugin/issues/43) | [`3a7a00b`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/3a7a00b0aa44a04471bc965f2bf746b0dc9cd9e0) binds v2 metadata and validates local identity and capabilities. |
| [#44](https://github.com/dhar174/zmachine_if_remix_plugin/issues/44) | [`842f404`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/842f4045aa450d6f941b83da91391b56fd402c86) makes protocol failure sticky with nonzero exit. |
| [#45](https://github.com/dhar174/zmachine_if_remix_plugin/issues/45) | [`006d3d6`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/006d3d66a605d2c02bc403739f7d6e29f203be71) adds full envelope recapture and chained-child evidence. [`b724125`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/b72412514d718c3a0e9245bb45c93223fedfc5b1) fixes hosted checkout and Bocfel test safety. |
| [#46](https://github.com/dhar174/zmachine_if_remix_plugin/issues/46) | [`5166d24`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/5166d24457aaf5bb0bdfd839f67ff9c395f9e0b2) separates snapshot recovery, entropy-dependent replay, and test publication eligibility. |
| [#47](https://github.com/dhar174/zmachine_if_remix_plugin/issues/47) | [`4857a42`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/4857a4226e238f3b5788d849863d05eef6d7f1c8) characterizes cache histories and rejects unsupported topology. |
| [#48](https://github.com/dhar174/zmachine_if_remix_plugin/issues/48) | [`025ca8d`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/025ca8d1e2b125deb821e47cc2fa8fff7c092a79) uses acknowledged interruptions and parent publication controls. |
| [#49](https://github.com/dhar174/zmachine_if_remix_plugin/issues/49) | [`b409cac`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/b409caca8841a347b790aa155efd658cbaf58c68) caps probe transport and bounds collection. |
| [#50](https://github.com/dhar174/zmachine_if_remix_plugin/issues/50) | [`6e36c0b`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/6e36c0b1edaaf1b7deabf02aae1be04d643d91c1) qualifies cooperating VM-I/O evidence publishers and reader visibility. |
| [#51](https://github.com/dhar174/zmachine_if_remix_plugin/issues/51) | [`b3569ff`](https://github.com/dhar174/zmachine_if_remix_plugin/commit/b3569ff671a8ff8de49ab866e4f726345d5ceef2) reproduces pinned Bocfel observations and separates canonical zero-operand failure from conforming character success. |

## 3. Checkpoint envelope and restore mechanism

The original envelope v1 was data-only JSON (historical description; v2 supersedes it below): no functions, never the JIT cache. Sections: `format`/`version`; `identity` (story SHA-256 + size, runtime name + pinned revision, adapter, schema); `boundary` (`line`/`char`/`halted` + pending line maxlen); `payload` (Quetzal from the upstream `vm.save_file(pc, 1)` primitive — `IFhd` identity, `UMem` raw dynamic memory, `Stks` in-use call stack — plus RNG seed/mode, plain-data `io`, pending `read_data` with its buffer, window text/cursor, published buffer+grid transcript, request log minus the pending entry, VM halt flags, undo disposition); `integrity` (SHA-256 over the canonical payload); `capabilities` (coverage + unsupported list carried with the data).

**Issue #43, 2026-11-07 — envelope v2:** At baseline `8a5ad823`, separate
runtime-name, adapter-name, line-`maxlen` and capability mutants retained the
old payload checksum yet each reached `ready:true` in the ordinary restoring
child; the changed `maxlen` also appeared in the restored request log. V2
rejects v1 (`E_VERSION`) without migration. Capture records story identity from
the adapter's original supplied bytes; restore derives its expected story
identity from its own supplied bytes. Before constructing an interpreter, it
also compares the exact local runtime and adapter names, pinned revision,
source-build digests, Node/V8 versions, platform, architecture, and schema.
The runtime fingerprint covers all JavaScript under the vendored `src` tree;
the adapter fingerprint covers the adapter, Glk shim, checkpoint
contract/core/format, fingerprint and runner. Both use sorted relative paths
and file hashes; identical sources in another checkout path match. The source
snapshot is taken at module initialization, assuming files stay unchanged while
the process runs; it does not attest Node, the OS, or in-process code. The
adapter file list is explicit and must be extended if another source file joins
that execution surface; the changed build then needs a new capture.

V2 hashes a domain prefix and experiment-specific canonical JSON of the entire
envelope except the exactly shaped `integrity` object. This detects unrecomputed
changes; the checksum is unkeyed, is not authentication, and cannot prevent an
author from recomputing it after changing payload data. Independently, capability
claims must exactly match the implementation-owned statement and a pending line
request's `maxlen` must be zero, as passed by this pinned runtime. A recomputed
checksum therefore cannot grant a claimed capability or change that request
metadata. V2 permits unknown top-level and payload keys: the checksum binds them,
but current restore ignores them, and they grant no capability. Assigning them
restore semantics would require reassessing this contract and its version.
Exact identity comparisons deliberately reject a different source
build or Node/V8/platform/architecture even when it could be compatible; any
capability wording or array-order change likewise requires a new capture.

Error precedence is format/version, story and implementation identity, boundary
and nested payload structure including unsupported-state gates, checksum, then
request/capability and cross-payload consistency. Consequently an earlier
`E_RUNTIME`, `E_TIMED_INPUT`, or structural error can precede `E_DIGEST`;
otherwise stale metadata rejects `E_DIGEST`, rehashed nonzero `maxlen` rejects
`E_BOUNDARY`, and rehashed differing capabilities reject `E_CAPABILITY`.

Restore (`lib/checkpoint-core.js`) always targets a fresh interpreter and follows upstream's own `do_autorestore` recipe plus additions the upstream never performs:

1. **Validate the envelope data contract before any interpreter exists**: format, schema version, story digest/size, runtime revision, boundary kind (+ maxlen range), per-section structure, size caps, envelope digest — plus **deep validation of the nested state restore consumes** (the full `io` scalar/stream-table shape **down to the individual stream slots' contents** — keyboard-only input stream, an empty memory-output-stream stack, and non-file-backed transcript/command-recording state, per the vendored runtime's slot semantics; required main window and well-formed window entries, `readData.storer`/`routine`/`time` per boundary kind, and — after the digest verifies — cross-section consistency of the published transcript against the window text), **read-continuation address/span validation against the checkpointed memory image (Issue #41)** — the pending read's text-buffer and parse-table continuation writes must fit writable dynamic memory `[0x40, static base)` derived from the checkpointed UMem header, the buffer length must match the checkpointed capacity byte at `bufaddr`, `parseaddr = 0` stays the legal no-tokenise sentinel, and when the caller supplies the trusted story bytes the image's version/static base are cross-checked against the story header; out-of-range starts, near-end overflowing spans, and truncated tables are rejected `E_BOUNDARY`, capacity/header inconsistencies `E_STRUCTURE` (observed defect: an honest-digest envelope with `bufaddr`/`parseaddr = 0xFFFFFF` restored `ready:true` and only faulted on the first input with `RangeError` and exit 4) — and rejection of unseeded RNG payloads (`E_RNG`). Rejections throw `CheckpointError` with stable codes (`E_FORMAT`, `E_VERSION`, `E_STORY`, `E_RUNTIME`, `E_DIGEST`, `E_STRUCTURE`, `E_BOUNDARY`, `E_SIZE`, `E_RNG`, `E_TIMED_INPUT`, `E_CAPABILITY`, `E_WINDOW_TOPOLOGY`). A second, VM-level identity gate sits behind the envelope: `vm.restore_file` verifies the Quetzal `IFhd` release/serial/checksum against the loaded story and returns 0 → `E_STORY_QUETZAL` (tested with an envelope whose payload is fixture-consistent but whose `IFhd` chunk claims a different release). **Capture runs the same validation on its own output before returning**, so an I/O state schema v2 cannot carry — pending `output_stream 3` memory-stream writes, file-backed transcript/command streams (open Glk references), redirected input — is refused at the source with the same codes instead of publishing an envelope restore would reject (the fixture never produces these states; a story that does simply cannot be checkpointed at such a boundary in v2). The restoring child uses exit 2 for argument/checkpoint rejection, 3 for an output limit, and 4 for protocol or candidate failure. Actual window topology is checked after startup and again after native restore. See the #47 and #49 qualifications below.
2. Fresh adapter runs its normal startup (windows, `origram`, pristine stack exist), then `restore_file` rebuilds memory/stacks/frames/pc.
3. The interpreter-owned **header block `[0x00..0x40)` is restored verbatim**: `update_header()` (called inside `restore_file`) recomputes screen-size fields as a sum of window heights, so a restored instance recomputes different bytes than the source last published (observed: `0x20`/`0x24` = 24 at capture vs 48 after restore, because the source computed them before the game opened the upper window). Interpreter-owned header state is checkpointed, not recomputed.
4. RNG seed re-applied **after** `restore_file` (its `update_header()` zeroes `xorshift_seed`; upstream `do_autorestore` does the same). Only seeded mode is accepted: seed 0 (unseeded, `Math.random` per draw — the only host-entropy point in the vendored tree) is rejected at capture and at validation with `E_RNG`, because host entropy can be neither captured nor reconstructed across processes (bridge §8; Issue #12 requires unsupported modes to fail explicitly rather than silently switch semantics).
5. Pending input reconstructed: restored `read_data` + re-issued `glk_request_line_event_uni`/`glk_request_char_event_uni` against the restored buffer, with the request log applied before the re-issue so the final log is byte-identical to the source's. The shared halt predicate (`state.halted || vm.quit`) drives halted restores: `quit=true` restored, no request re-issued, and the adapter refuses further input with no output or state change (tested).
6. Published transcript + window text/cursor applied from the envelope; the output-delta watermark synced — restore **neither republishes the opening text nor loses prior output** (asserted per step in every round trip).
7. Transient fresh-run leftovers discarded: startup output, startup request-log entries, undo entries (upstream autosave semantics drop undo; declared, tested).
8. Process isolation: restore always runs in a fresh child (`lib/runner.js`) fed only the checkpoint file path and the pinned fixture path — no closure, singleton, shared typed array, or hidden test cache crosses the boundary. All child argv is static (no environment-derived values reach argv or file paths).

**Issue #44 runner protocol policy (2026-11-07):** On baseline `3a7a00b`,
ordinary children emitted an error for malformed JSON, an unknown operation,
and `serialize` without `--out`, but exited 0 for each case after both EOF
and explicit exit. The runner now emits `{error, failed:true, detail}` for
these protocol errors and returns 4 on either termination. Non-object JSON and
an unknown `op` accompanied by input also reject; empty lines are ignored.
The first failure detail stays sticky while later requests may still execute;
their successful operation responses do not make the candidate clean. An
output limit stops processing with exit 3 even after a prior failure, and
argument/checkpoint rejection remains exit 2. Explicit exit stops later queued
input and closes stdin even if the parent keeps its pipe open. With a working
stdout reader, queued responses drain before normal exit; broken pipes and
forced kills do not guarantee delivery. The baseline also delivered all 2,500
responses in the cooperative-reader batch, so that batch is not a demonstrated
baseline truncation. A separate local paused-reader smoke delivered all 2,500
candidate responses after the reader resumed; the permanent regression also
checks 10,000 queued errors with the stdout reader temporarily paused.
Parent-enforced timeouts are observed kills/reaping, not a portable numeric exit
class. The parent must check final status before using a candidate or its
serialized output; durable publication
and receipt recovery remain outside this probe. Because `runner.js` is included
in the adapter-build fingerprint, a v2 checkpoint captured at baseline
`3a7a00b` on the same local host rejected before readiness with `E_RUNTIME`
when restored by the changed runner (exit 2, empty stderr). A new capture is
required; no checkpoint migration is provided.

Local verification on Windows/Node v24.13.0: after review follow-up, the focused
protocol suite passed 23/23 and the full checkpoint suite passed 86/86. The
VM-I/O and fixture suites ran before that follow-up, which changed only tests
and documentation: VM-I/O passed 60 with one skip (WSL Bocfel is installed);
fixture integrity passed two with one skip (the pinned compiler is absent).
All commands exited 0 with empty stderr. The fixture SHA-256 remained
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`;
the regenerated VM-I/O receipt was restored to its pre-test bytes and both
tracked receipt hashes were verified. Hosted Windows/Linux outcomes belong to
the PR checks and are not inferred from this local run.

Three harness rules were learned during implementation and are documented in code and `experiments/vm-checkpoint/README.md`: the vendored ZVM **mutates the story buffer in place** (every interpreter gets its own copy — two instances sharing a Node Buffer leak game state into each other); interpreter-owned header fields must be checkpointed, not recomputed (item 3); and the current frame's in-buffer `sp` slot is stale dead storage in a live interpreter (authoritative `sp` is a VM field, synced only at save/call) — one stale byte was observed to differ at halt, and the stack fingerprint excludes exactly that slot for the current frame (caller slots are kept: `restore_file`'s frame walk reads them).

**Issue #42 timed-input policy:** The pinned `read` and `read_char` methods
copy their optional `time` and `routine` operands into `read_data`; no input
timer scheduling exists in those methods or the probe's Glk shim, and the
runtime advertises the timed-input flag as clear. An omitted argument is
`undefined` in the live object and is omitted from the JSON clone. V1 accepted and v2 accepts
absent or integer-zero operands, rejects `null`, negative or non-integer
values with `E_STRUCTURE`, and rejects either nonzero operand with
`E_TIMED_INPUT` at both capture and restore. This deliberately conservative
rule also rejects a lone nonzero operand even though the [Z-machine standard
§15](https://inform-fiction.org/zmachine/standards/z1point1/sect15.html)
specifies periodic callbacks when both operands are supplied and nonzero. No
other timer sentinel is accepted. A halted envelope carries no pending
`readData`; no shim timer event is reconstructed. The gate covers checkpoint
capture and restore, not interception of a timed opcode at execution time.

## 4. Recovery-state inventory

Owning objects are the vendored ZVM (`vm.*`), the headless Glk shim (`state.*`, closure-private `pending`), and the adapter. Classification per Issue #12 §1; validation test references are `experiments/vm-checkpoint/tests/*`.

| State family | Owning object | Capture | Restore / rebinding | Classification | Validation | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Dynamic story memory | `vm.m`/`vm.ram` (one buffer; writes confined to `[0..staticmem)`) | Quetzal `UMem` (raw) | `restore_file` + header block write-back | **Serialized** | ramSha256 equality in every round trip; A34 wrong-story rejection | None for v5 fixture surface |
| Original image identity | story bytes + Quetzal `IFhd` | Envelope digest + `IFhd` | Double gate: envelope digest, then `IFhd` release/serial/checksum | **Serialized** | wrong-story test (E_STORY, E_STORY_QUETZAL) | — |
| Header state (Flags 1/2, screen size, font units, spec rev) | `ram` header bytes; recomputed by `update_header()` | Header block `[0x00..0x40)` base64 | Written back verbatim after `restore_file` | **Serialized** (found necessary — recomputation diverges) | ramSha256 covers `[0..0x40)` | Interpreter number/version header fields (0x1E/0x1F) never written by the vendored ZVM — **unsupported**, source-verified |
| PC / continuation | `vm.pc` (Pauser advances pc past the read opcode before pausing) | Quetzal `IFhd` 24-bit pc | `restore_file` sets pc | **Serialized** | pc equality in every fingerprint | — |
| Operand/eval stack, call frames, locals, return destinations | `vm.stack`/`frames`/`frameptr`/`sp` (+ `s`/`l` views) | Quetzal `Stks` (in-use region) | `restore_file` rebuild + `make_stacks` | **Serialized**; `s`/`l` views **reconstructed** by `make_stacks` | stackSha256 (call-chain walk) in every fingerprint | Current frame's in-buffer sp slot is stale dead storage — excluded from fingerprint (see §3.3) |
| Pending line/char request; input buffers; parse/store addresses | `vm.read_data` + shim `pending` + `vm.glk_event`/`state.pendingEvent` (object-identity handoff) | `read_data` clone (buffer array, bufaddr, parseaddr, routine, storer, time) + boundary kind + maxlen | Fields restored; request re-issued against the restored buffer; fresh event reused (same-object handoff preserved) | **Serialized** (shim `pending` itself is closure-private and re-issued via the public API) | ready-fingerprint log tail pending of the right kind; disambiguation + menu round trips | — |
| Unanswered vs consumed event | `state.pendingEvent` / answered event fields | Implied by boundary kind + request log tail | Re-issue regenerates unanswered state; answered history via request log | **Serialized** | no-duplicate-delivery case (menu answer exactly once) | — |
| Parser-disambiguation state | Story-owned parse buffers in dynamic memory + pending read | `UMem` + `read_data` | Same as above | **Serialized** | disambiguation case (`examine token` → restore → `blue`) | — |
| RNG mode, state, reseeding | `vm.xorshift_seed` | Envelope `rng {seed, mode}` — **seeded mode only; unseeded capture refused and unseeded envelopes rejected (`E_RNG`)** | Re-applied after `restore_file` | **Serialized (seeded path)** | seeded draws + seed equality across restore; reseed case; unseeded capture/validation rejection tests | Unseeded (`Math.random` per draw, runtime.js:532 — the tree's only host-entropy point) cannot be reconstructed across processes → **rejected, per bridge §8 and Issue #12's fail-explicitly rule**; `random(0)` = seed 0 = unseeded (source-verified); deliberate standard deviation: upstream does not implement sequential predictability mode |
| Window/cursor/style, output streams, pending text, status/upper window | shim window objects (`vm.mainwin`/`upperwin`/`statuswin`), `vm.io`, `state.output`/`gridOutput` | Window text/cursor + `io` clone + transcript strings | Text/cursor written only to matching fresh window roles/presence (Issue #47 guard); `io` assigned; transcript overwritten; watermark synced | **Serialized**; shim `currentWindow` **reconstructed** from `io.currentwin` (VM's notion; the VM re-syncs the shim on every print) | gridOutput equality per step; no-republish per step | Style calls are no-ops in the shim (styles not part of transcript evidence — G1-A scope); upper-window quote-box state carried inside `io` (plain data) |
| Transcript publication position | adapter `lastOutputLen` watermark + `state.output` | Published output string | Overwritten + watermark synced via exposed `settle()` | **Serialized** | per-step full-transcript equality | — |
| Story turn counters / daemons | Story globals + daemon list in dynamic memory | `UMem` (+ globals digest) | Via memory restore | **Serialized** | `[F06:turn=N]` continuity + chime timing in round trips | Timed events (`read_data.time`/`routine`): stored by upstream but **never used** (Flags1 timed-input bit clear; io.js TODO) — **unsupported**, source-verified |
| Halted/error state | `vm.quit`, shim `state.halted`, `state.errors` | `vmFlags.quit` + boundary kind | Halt predicate fields restored; no request re-issued | **Serialized** | halted-restore refusal test (no output, no state change) | — |
| Undo machinery | `vm.undo`/`undo_len` | Not captured | Cleared on restore | **Explicitly unsupported** (upstream autosave drops it) | `@restore_undo` after restore is safe and empty (tested) | Documented, not silent |
| JIT code / decoded-text caches | `vm.jit` | Never serialized | Fresh-start entries retained; later entries lazy | **Conditional, not generally reconstructed** | pinned fixture and #47 immutable controls pass | Mutable dictionary/code histories can diverge; see #47 below |
| Host entropy/time dependencies | `Math.random` only (runtime.js:532); **no `Date.now`/time calls anywhere in the vendored tree** (grep-verified) | n/a | n/a — unseeded checkpoints are rejected before any interpreter exists | **Unsupported (rejected)** | unseeded capture refusal + child `E_RNG` rejection | Unseeded cross-process reproducibility: **blocked by design and enforced by rejection**; a controlled host-entropy capture/injection mechanism would be a new evidence gate |
| Timed input, sound, graphics | upstream opcodes / Flags | n/a | n/a | **Unsupported** (no-op/absent opcodes; Flags1 timed bit clear; Flags2 cleared & 0x57) | Timed input: nonzero `time` or `routine` rejected at capture and restore (`E_TIMED_INPUT`); see Issue #42 | No timed execution or clock recovery claimed; sound/graphics declarations do not establish a rejection gate for every opcode |
| Glk file streams / filerefs | glksim | n/a | n/a | **Explicitly unsupported** (recorded as `unexpected`) | in-game `save`/`restore` not exercised in the checkpoint suite (G1-A scope) | Production save/restore interception is a turn-layer duty (state-and-vm-bridge §8), out of G1-B scope |
| Runtime/adapter/checkpoint identities | envelope `identity` | Serialized | Validated before restore | **Serialized** | E_STORY/E_RUNTIME tests | — |

The original fixture behavioral comparisons passed, but did not prove that all derived caches were rebuilt. Issue #47 below distinguishes startup-derived reuse from lazy cache population and reconstructed `s`/`l` views; its unsupported cases do not belong to the passing recovery matrix. **No comparison was made to pass by excluding an unexplained difference**: the only allowed variance field is `undoDepth` (declared unsupported, restored ≤ source, monotonicity asserted). The former unseeded-draw normalization allowlist was removed together with the unseeded mode itself: every compared pair of runs is seeded, so equality — including the RNG seed and every draw — is exact.

## 5. Round-trip results (ifvms.js, per boundary — seeded path)

Every case: independent capture → fresh child restore → identical input suffix → comparison against an uninterrupted reference run. Each case executed twice (independent repetitions). Comparison: full transcript + grid + marker ordering equality after every suffix step, plus final machine-state fingerprint equality (§3) — exact, with no normalization and no allowlists beyond the declared undoDepth rule. **Every capture is taken in seeded mode** (the capture prefixes seed the game first); the two unseeded situations are covered as explicit rejections (rows 1 and 8).

| # | Boundary | Prefix state at capture | RNG mode | Result | Evidence (test) |
| --- | --- | --- | --- | --- | --- |
| 1 | Capture gate — the opening prompt is necessarily unseeded | Startup only | unseeded | **Rejected by design** — capture throws `E_RNG` at the source; once seeded, the very next boundary is capturable and restores cleanly | roundtrip: unseeded capture is refused… |
| 2 | Line — after movement, failed action, daemon chime (turns 1–5, `[F06:event=chime]` in captured transcript) | Nonempty | seeded | **Demonstrated** (2/2 reps) | roundtrip: line prompt after movement… |
| 3 | Line — parser disambiguation, unresolved input | Two "brass token" objects | seeded | **Demonstrated** (2/2) | roundtrip: parser-disambiguation… |
| 4 | Character — menu pending, unanswered | `[F07:menu-open]` | seeded | **Demonstrated** (2/2) | roundtrip: read_char menu… |
| 5 | Line — immediately after a menu answer | `[F07:menu-choice=beta]` exactly once | seeded | **Demonstrated** (2/2) — no duplicate delivery | roundtrip: boundary immediately after… |
| 6 | Line — seeded draws + reseed | `seed 42`, `roll` | seeded | **Demonstrated** (2/2) — identical draws and seed across restore; reseed to 7 honored | roundtrip: seeded RNG… |
| 7 | Line — endgame prompt (`deadflag=2`, RESTART/RESTORE/QUIT pending) | Victory | seeded | **Demonstrated** (2/2) — suffix `quit` halts identically | roundtrip: endgame prompt… |
| 8 | Unseeded envelope (hand-built, honest digest) | n/a | unseeded | **Rejected** — child refuses restore, exit 2, code `E_RNG`, baseline untouched | isolation: hostile `unseeded-rng` |
| 9 | Halted (post-`@quit`) | Terminal | seeded | **Demonstrated** — restore succeeds; new input refused with zero output and zero state change (shared halt predicate) | roundtrip: restored halted execution… |
| 10 | Undo after restore | ≥1 turn | seeded | **Demonstrated** — `undo` handled safely; no undo history; restored depth ≤ source | roundtrip: in-memory undo… |

**Issue #45 regression, 2026-11-07:** `tests/envelope-recapture.test.js`
compares the complete canonical v2 envelope, including integrity, and exact
JSON bytes after immediate fresh-child restore and recapture at seeded line and
character boundaries. It checks nonempty fixture windows and cursor coordinates,
serialized I/O, pending read data, transcript/grid and RNG state. A separate
line → first child → pending character checkpoint → second child sequence
compares each input's result and request log against an uninterrupted reference;
the first child exits before the second starts. The final fingerprint and
envelope match, startup/menu markers occur once, and the original live baseline
and checkpoint file remain unchanged. Both children are observed exiting.
Only the declared-unsupported `undoDepth` difference is allowed for
fingerprints; the full-envelope comparisons have no field exclusions and no
unseeded-output normalization. These are fixture-scoped candidate-process
checks, not combined-world or durable-publication evidence.

On Windows / Node v24.13.0, from `experiments/vm-checkpoint`,
`node --test tests/envelope-recapture.test.js` exited 0: 3 passed, 0 failed,
0 skipped; `node --test` exited 0: 89 passed, 0 failed, 0 skipped. Both
commands produced empty stderr. Hosted Windows and Ubuntu results are recorded
with the PR checks.

Reproduce: `cd experiments/vm-checkpoint && node --test`. The earlier local
Windows run recorded 47 tests, 0 failures and 0 skips at `7935cc8`. For the
final [PR #55](https://github.com/dhar174/zmachine_if_remix_plugin/pull/55)
head `bf71725`, [checkpoint CI run 41912746842](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/41912746842)
reported 49 passed, 0 failed and 0 skipped on each of Ubuntu and Windows. Its
checkout was synthetic merge `285b21fd298ebce3117a65ff22eb2d936421ac65`.

**Issue #41 verification, 2026-11-06:** On main baseline `dddc31c`, a local
Windows / Node v24.13.0 checkpoint-suite run reported 49 passed, 0 failed and
0 skipped. The suite includes 13 honest-digest continuation/image mutations
through the ordinary child runner, pre-readiness `E_BOUNDARY`/`E_STRUCTURE`
rejection with exit 2 and unchanged baseline recapture, plus seeded line and
character round trips. The fixture SHA-256 remained
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
The local fixture-integrity suite passed 2 tests and skipped recompilation
because the pinned compiler was absent. The local VM-I/O runner reported 56
passes, 0 failed and 1 skip, but emitted error traces during malformed-story
and runaway-story negative tests. The separate
[PR #57 probe CI run](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/42283459077)
reported success using synthetic merge `eeaee322bcb314e9636630139c0d8d204f5c3092`:
the VM-I/O suite reported 37 passes / 4 skips on Ubuntu and 39 passes / 2 skips
on Windows; fixture integrity reported 2 passes / 1 skip on each. Both hosted
VM-I/O logs also contain error traces from negative tests. This closeout does
not count either the local run or those hosted VM-I/O runs as a clean pass, so
it has not verified #41's all-current-G1-tests criterion. The hosted jobs used
probe and fixture sources unchanged from PR #55. This is fixture-scoped #41
evidence, not full A34 or production recovery acceptance. At that observation,
#12, #40 and #41 were open. The later diagnostic follow-up below and the current
baseline table record #41's disposition. D39 remains proposed.

**Issue #41 diagnostic follow-up, 2026-11-06:** On Windows with Node v24.13.0,
using baseline `5e30823` plus the VM-I/O test-harness changes in this follow-up,
the VM-I/O suite reported 60 passes, 0 failures and 1 skip. The skip was the
unavailable-Bocfel case, which cannot run when a real WSL Bocfel is installed.
Expected ifvms diagnostics were matched against the adapter's recorded errors;
within those checks, unexpected or additional `console.log` calls are forwarded
and fail the check. `console.error` and other output remain untouched.
The suite emitted no error traces and stderr was empty. The checkpoint suite
reported 49 passes with no failures or skips, and fixture integrity reported
2 passes and 1 skip because the pinned compiler was absent; both had empty
stderr and no error traces. The fixture SHA-256 remained
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.

[The last G1-C chat-host CI run](https://github.com/dhar174/zmachine_if_remix_plugin/actions/runs/41506289808)
reported 35 passes with no skips on each of Ubuntu and Windows on 2026-11-02 at
`6beaebf`; its relevant source, test, lockfile, workflow and fixture paths are
unchanged in this follow-up. That is historical CI evidence, not a fresh host
test or live-client qualification.
This follow-up does not approve D39 or close #12 or #40.

**Issue #42 local verification, 2026-11-07:** On Windows with Node v24.13.0,
using main baseline `5d5a974` plus the timed-input changes, `node --test` in
`experiments/vm-checkpoint` reported **57 passed, 0 failed, 0 skipped**; the
eight new timed-input tests include ten honest-digest ordinary-child variants.
`node --test` in `experiments/vm-io` reported 60 passed, 0 failed and 1 skip
(the unavailable-Bocfel case skips when WSL Bocfel is present); the fixture
suite reported 2 passed and 1 skip because the pinned compiler was absent.
All three runs exited 0, produced empty stderr and showed no error traces. The
fixture SHA-256 remained
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
The new negative states are injected into genuine seeded fixture boundaries;
the tests also call the pinned read methods directly, but do not execute a
timed story opcode or establish timed-input support. This does not approve D39
or resolve the remaining #12/#40 work.

## 6. Candidate isolation results

Baseline model: a live in-parent interpreter at a captured checkpoint; candidates are fresh child processes restored from the baseline's checkpoint file; the simulated publication store is a file only the parent ever writes (children structurally never receive its path), asserted unchanged after every phase.

| Requirement | Result | Evidence |
| --- | --- | --- |
| Candidate mutates inventory/location/time/RNG/output, then is discarded → baseline checkpoint byte-identical on re-capture, transcript unchanged, continuation equal to a never-candidated control | **Demonstrated** (A15) | isolation: discarded candidates… |
| Two sequential candidates from the same checkpoint (shared-memory / global-RNG / shared-Glk detection) | **Demonstrated** | same test, candidate 2 |
| Startup interruption | Historical unacknowledged pre-ready kill; superseded by #48 startup acknowledgment before loading/restoring the VM (not interruption inside startup). Baseline unchanged. | `interruption-phases.test.js`; #48 qualification below |
| Kill while idle at the restored boundary | **Demonstrated** after an explicit restored-boundary acknowledgment, with exact pending input/fingerprint and observed exit/pipe closure. | `interruption-phases.test.js` |
| Serialization/write interruption | Historical busy-stall was **before capture/write**, not inside either operation. #48 tests acknowledged pre-capture, post-capture and real partial-file barriers in a separate test writer; interruption inside the ordinary runner remains unproven. | `interruption-phases.test.js`; #48 qualification below |
| Before simulated publication | Historical timed post-dispatch kill did not prove mutation completion, and its helper already buffered stdout. #48 proves acknowledged mutation/finished-candidate kills and separately parent cancellation after clean exit; private output is consumed, but no publication occurs. | `interruption-phases.test.js`; #48 qualification below |
| Nonrecursive infinite loop, fresh child, parent-enforced deadline → killed, reaped (exit observed), nonzero | **Demonstrated** (G1-A additionally proves worker-thread preemption for in-process cases) | isolation: unbounded candidate… |
| Output limit stops a chatty candidate, exit 3 | **Demonstrated** | isolation: output limit… |
| Wrong story / wrong runtime / corrupt / truncated / digest-liar / bad-boundary / non-JSON checkpoints, plus nested-state malformations (empty io table, missing main window, empty character readData, transcript/window disagreement, pending memory-output-stream stack entries) and an honest unseeded envelope → rejected in child, exit 2, baseline re-capture byte-identical after every rejection; honest-digest read-continuation span/image mutants (bufaddr/parseaddr = 0xFFFFFF, near-end overflowing text-buffer span, truncated/overflowing parse table, parseaddr inside the text write span, buffer-capacity mismatch, forged static base, forged version byte, duplicate UMem chunk, straddling IFF chunk header, high-bit-mutated FourCC tags on FORM/IFZS/UMem) → rejected in child with `E_BOUNDARY`/`E_STRUCTURE` before readiness, with the remaining container constructions (compressed CMem chunk, FORM-size inconsistency, trailing bytes beyond the declared FORM area) asserted at the validation layer, and capture-side self-validation regression-tested by corrupting the live `read_data` addresses on a seeded adapter (capture refuses `E_BOUNDARY`, mutation restored, baseline recapture byte-identical) (Issue #41) | **Demonstrated** (A34) | isolation: malformed and hostile…; continuation: honest-digest continuation-span mutations… |
| Candidate execution failure — an adapter step reporting `error`, or a thrown exception while handling a request — emits its failure evidence AND exits nonzero (exit 4; EOF after a failure also exits 4; a clean run still exits 0) | **Demonstrated** for both failure paths via the runner's static-argv selftest modes (real pinned stories cannot be driven to a VM error on demand) | isolation: a candidate whose execution fails… |
| Protocol errors (malformed, unknown op, missing serialization output) on EOF and explicit exit; sticky failure and queued-output drain | **Demonstrated locally** in ordinary children; hosted Windows/Linux results are reported by the PR checks | `runner-protocol.test.js`; baseline checkpoint and fingerprint rechecked after cases |
| Timeout/incomplete runs exit nonzero, no surviving children (exit observed, never assumed) | **Demonstrated** (all kill/rejection paths assert exit) | throughout the isolation suite |

A28–A29 boundary note: the fixture tests establish the A28 candidate-process result. A29 is an outstanding durable-store requirement. Durable commit/idempotent-receipt recovery — crash before checkpoint/head publication and crash after durable commit — belongs to #18/#21; the production requirements this probe records for them (the third one demonstrated by execution here) are: serialize and verify the full envelope before publishing any reference to it; publish head+receipt atomically after the envelope is durable; a rejected/killed candidate must leave the baseline fingerprint byte-identical (this probe's re-capture discipline is the pattern to reuse).

## 7. Bocfel 2.6 checkpoint-route investigation (independent reference; earns its own evidence)

**Historical observations, 2026-10-23:** source inspection of the pinned tarball (extracted to a temp dir, never modified) plus scripted WSL2 runs against the same fixture. Source-verified behavior: `zread`/`zread_char` write an autosave (`do_save(SaveType::Autosave, SaveOpcode::Read/ReadChar)`) **at every input boundary** when the `autosave` option is enabled (env `BOCFEL_AUTOSAVE=1`, `BOCFEL_AUTOSAVE_DIRECTORY=…`); startup restores and continues from it (`process_instructions` → `Operation::Restore(saveopcode)`) unless `skip_autorestore`; `@quit` renames the autosave to `.bak`; the `Rand` chunk is restored when present (stack.cpp:977) but only written in predictable mode (G1-A §5).

| Case | Result | Evidence |
| --- | --- | --- |
| Line boundary: drive prefix → **SIGKILL** mid-session (stdin held open; no `@quit`) → fresh process auto-restores → identical input suffix | **Demonstrated** — marker/turn sequence and seeded draws (5, 4) exactly match an uninterrupted reference run; "Continuing last session from autosave" observed | WSL scripted runs, 2026-10-23; transcripts in `/tmp/g1b-bocfel/{runA,runB,runRef}.out` (session-temporary, commands reproduced below) |
| Seeded RNG continuation across restore | **Demonstrated** (Rand chunk present in predictable-mode autosave) | same runs: prefix `seed 42`+`roll`, suffix `roll roll` matches reference |
| Unseeded RNG continuation | **Blocked** — no Rand chunk in random mode; restored draws are fresh entropy (observed 3,5 vs reference 6,6; restore itself works) | same runs; consistent with G1-A §5 |
| Character boundary (menu pending → kill → restore → key `b`) | **FAILED** — reproducible interpreter error `[Save file error: invalid Args size for 1: 0]` during the char-boundary autosave restore; Bocfel falls back to a fresh start, so the delivered key reaches a line prompt ("That's not a verb I recognise") | repro: `BOCFEL_AUTOSAVE=1`, prefix `menu`, kill at a held-open stdin, restore, deliver `b`; 2/2 attempts |
| Upper window / status state across restore | **Not saved** (man page: history replays lower window only; upper window likely incorrect after autorestore) | bocfel.6 "Autosaving" section |
| Timed input / sound / graphics | Not claimed by Bocfel's route; out of scope | — |

Historical abbreviated command (2026-10-23, retained for provenance; **not current reproduction guidance**):

```sh
wsl.exe -e sh -c 'export BOCFEL_AUTOSAVE=1 BOCFEL_AUTOSAVE_DIRECTORY=/tmp/g1b &&
  mkfifo /tmp/g1b/in && "$HOME/.local/bin/bocfel" -C -m /mnt/…/fixture.z5 < /tmp/g1b/in > a.out 2>&1 &
  PID=$!; exec 3>/tmp/g1b/in; printf "look\nnorth\nseed 42\nroll\n" >&3; sleep 1.5;
  kill -9 $PID; exec 3>&-;   # destroy mid-session: the boundary autosave survives
  …repeat with suffix input in a fresh process; compare marker sequences…'
```

**Current reproduction and qualification, 2026-11-08 (#51):** use the [complete Python reference harness](../../experiments/bocfel-autosave/README.md) and [retained twelve-trial evidence/acceptance mapping](bocfel-autosave-2026-11-08/README.md). The source archive is verified before a fresh default Unix/non-Glk/curses build, stdin stays open, and expected output plus parsed BFZS state establishes every boundary before killing the owned native process. Full autosaves/build logs are retained as CI artifacts; raw comparisons/Args/Rand summaries are committed. The historical canonical character failure above is specifically zero-operand `read_char` (`f6 ff 01` at 0x124ac); the standard requires operand 1, and the new conforming original control passes. The controlled random-mode case establishes a concrete file-cursor limit, not natural-entropy recovery. Each result is frozen and repeated three times. Per Issue #11's review-set rule, neither these reference successes nor limitations substitute for complete candidate qualification; ifvms's proposed GO derives from its own independently passing tests (141 checkpoint regressions at this baseline), not Bocfel's failure.

## 8. G1-A regression status (incl. one defect found and fixed)

| Suite | Result before probe work | Result after probe work |
| --- | --- | --- |
| `tests/fixtures/zmachine` (worktree) | 3 tests / 2 pass / 1 skip (pinned compiler absent) | unchanged (fixture bytes untouched) |
| `experiments/vm-io` | **at 54 tests: 52 pass / 1 skip / 1 fail — deterministic (5/5 runs)** | 57 tests / 56 pass / 1 skip / **0 fail (3 consecutive runs after the lock fix, 3 more after the atomic-write fix)** |

The pre-existing failure was a genuine G1-A harness defect, found because this machine has WSL bocfel (CI skips those tests): `negative.test.js clearTampered()` recursively deletes `results/tmp-negative/` — which was also the evidence-lock directory — so deleting a held lock let a second writer tear `results/probe-bocfel.jsonl` mid-record (observed: run object truncated at `"start`, step records merged, tail fragment at EOF). Fixed in an isolated commit (`962e873`): locks moved to `os.tmpdir()/zirp-vm-io-evidence-locks` with a three-test regression suite (`tests/evidence-lock.test.js`) that failed pre-fix and passes post-fix. A **residual, rarer tear (~1 in 4 runs) with the same byte signature recurred after that fix** (recorded with forensics in commit `e9c70f1`): the per-adapter lock serializes writers, but not the OS-level interleave of an in-flight incremental `createWriteStream` against another writer's truncate/rewrite of the same path. Fixed in `e9c70f1` by writing the evidence atomically at end of run (buffered records → temp file → rename), so the canonical path never holds a partially written state and a concurrent writer fails loudly instead of interleaving. After both fixes: 3 consecutive full vm-io suite runs green with byte-clean evidence files. A second isolated commit (`416b248`) adds the additive `__g1bInternals()` adapter accessor the checkpoint code reuses (behavior unchanged; exercised end-to-end by this suite). Both probe-suite runs regenerate `results/probe-*.jsonl`; regenerated copies were restored — committed evidence bytes are unchanged.

## 9. Acceptance mapping

All test links below are pinned to the current evidence baseline. The [acceptance matrix](../quality/acceptance-matrix.md) owns the full product requirements.

| Row | Fixture result and reproducible control | Remaining obligation |
| --- | --- | --- |
| A15 | [isolation.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/isolation.test.js) exercises "discarded candidates leave the baseline completely unchanged (A15)" after fixture time, RNG, inventory, location and output change. Re-capture and continuation match a never-candidated control. [interruption-phases.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/interruption-phases.test.js) checks the parent gate with `cancel`, `publish` and `invalid-envelope` outcomes. | The simulated store proves the fixture publication control. Product turn state, clock ownership, and durable publication remain under #18/#21. |
| A16 | [roundtrip.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/roundtrip.test.js) exercises "round trips at every supported boundary match the uninterrupted reference", including the pending menu and its answer. The character request is reissued and delivered through the character path. [timed-input.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/timed-input.test.js) rejects active operands and retains zero/absent controls. | The native request path is covered. Enforcement of natural-language routing in a real host is a separate product requirement. |
| A28 | [interruption-phases.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/interruption-phases.test.js) exercises seven "acknowledged interruption at ..." cases, with unchanged baseline and simulated store. The test writer's partial file fails ordinary restore with `E_FORMAT`. The `cancel` case proves parent cancellation after clean child exit. | Durable orphan collection and real store crash recovery remain #18/#21. The ordinary runner's synchronous write was outside the interruption test. |
| A29 | Production requirement only. A saved receipt must be returned on retry after durable commit without re-executing the VM action. | #18/#21 must prove atomic head/receipt publication and crash/retry behavior. Candidate exit or simulated publication supplies no post-commit recovery evidence. |
| A31 | [roundtrip.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/roundtrip.test.js) compares seeded native line, character and halted continuation. [envelope-recapture.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/envelope-recapture.test.js) compares immediate full-envelope recapture and "two sequential fresh children preserve line-to-char continuation and the baseline". | Combined overlay, policy and clock restoration remain #21. A final seeded snapshot can restore its own continuation without proving replay of an earlier entropy-consuming turn. See [#46](#issue-46-rng-qualification). |
| A34 | Capture self-validation is exercised by the invalid live continuation in [continuation.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/continuation.test.js) and active operands in [timed-input.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/timed-input.test.js). Pre-VM rejection is exercised by "wrong runtime or adapter is rejected before adapter construction" in [identity-integrity.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/identity-integrity.test.js) and ordinary child hostile/span cases in [isolation.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/isolation.test.js) and [continuation.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/continuation.test.js). [format.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/format.test.js) exercises the VM-level Quetzal `IFhd` check with `E_STORY_QUETZAL`. [cache-window.test.js](https://github.com/dhar174/zmachine_if_remix_plugin/blob/b3569ff671a8ff8de49ab866e4f726345d5ceef2/experiments/vm-checkpoint/tests/cache-window.test.js) tests saved selector/role rejection and saved versus fresh topology after startup and after native restore. See [#47](#issue-47-cache-and-window-qualification) for the distinction between ordinary-child and guard-scaffolding cases. | Trusted-fixture validation and baseline invariance are covered. Production import, arbitrary-story compatibility, isolation and migration remain separate under #20/#21/#22/#30. |

**Historical A34 counts.** Issue #41 recorded 26 ordinary-child rejections at that revision: thirteen isolation cases and thirteen honest-digest continuation-span/image mutants. Capture-side invalid live continuation and the in-process Quetzal identity case were separate. This is an inventory of that run, not a cumulative v2 count.

Issue #42 adds ten honest-digest timer-operand child variants across seeded
line and character boundaries to the earlier twenty-six cases in the A34
row. They use the normal runner, reject before readiness with exit 2 and
`E_TIMED_INPUT`, and leave the baseline checkpoint byte-identical. The
corresponding capture checks use the same code and diagnostic; explicit-zero
controls restore and continue. These are fixture-scoped checkpoint tests, not
timed-opcode or clock-reconstruction trials.

Issue #43 adds normal-child identity, boundary and capability mutants,
including recomputed checksums, plus a direct pre-construction check, v1
downgrade rejection, and source-build mutation and identical-source relocation
controls. These are deterministic probe tests, not authentication or a claim of
cross-build portability. The previously stated A34 counts describe the earlier
#41 and #42 evidence rather than a cumulative total for v2.

**Issue #43 local verification, 2026-11-07:** On Windows with Node v24.13.0,
the checkpoint suite passed 63/63; the VM-I/O suite passed 60/61 with one skip
(the no-WSL-Bocfel environment case, because WSL Bocfel is installed); and the
fixture suite passed 2/3 with one skip (the pinned Inform compiler is absent).
All three commands exited 0 with empty stderr. The fixture SHA-256 remained
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`;
the two VM-I/O receipts regenerated by its suite were restored to their
pre-test bytes and verified. These results do not establish product readiness.

Not claimed: combined-world persistence, Android/host support, live ChatGPT integration, production DB atomicity, conformance beyond the tested surface (glksim is an 80×24 headless shim; cross-interpreter byte-identity is explicitly not an expectation).

## 10. Recommendation (proposed evidence — not an owner decision)

**Conditional recommendation for ifvms.js ZVM**, with this minimum adapter boundary for the tested fixture:

1. Capture at supported boundaries only: pending line, pending character, halted. Reject capture elsewhere (not at a boundary → explicit error).
2. Envelope v2 as implemented: data-only, versioned, identity-bound (story and local runtime/adapter build), checksum-verified, locally capability-validated; validate the envelope before constructing an interpreter. Check actual window topology after startup and again after native restore, with the VM-level Quetzal `IFhd` gate at native restore.
3. Restore into a fresh process using only the checkpoint, the pinned story bytes, and static configuration; re-apply interpreter-owned header state, RNG (post-`update_header`), pending request, transcript, and watermark; sync halt semantics through one shared predicate.
4. Candidate execution in killable child processes with parent deadlines, bounded transport, nonzero runner failures, and observed exit and pipe closure. Only the parent test gate can publish to the simulated store.
5. Declared-unsupported surface carried in the envelope capabilities: **timed-input operands — either nonzero operand is rejected at capture and validation (`E_TIMED_INPUT`)**; sound, graphics, Glk file streams, undo history and interpreter number/version fields; **pending `output_stream 3` memory-stream writes and redirected input — the `io` stream slots are validated down to their contents and nonempty memory-stream stacks / file-backed stream state / non-keyboard input are rejected with `E_STRUCTURE` at capture and at validation**; and **unseeded RNG — rejected at capture and at restore (`E_RNG`)**. The stated rejection gates do not establish that every other declared-unsupported opcode is intercepted. Seeded mode is the deterministic path; controlled host-entropy capture/injection would require new evidence.

Conditions/caveats: (a) Bocfel 2.6 remains an independent reference with bounded #51 evidence (seeded line and conforming character control pass; the canonical zero-operand character case fails; random-mode Rand/file-cursor recovery is absent), without complete alternative checkpoint qualification; (b) the vendored ZVM's quirks this probe compensated for — in-place story-buffer mutation, `update_header()` recomputation, stale in-buffer `sp` slot, no header-length validation (G1-A) — are exactly the kind of boundaries a production adapter must own at the adapter layer, never inside a modified vendor tree; (c) upstream's sequential-predictability RNG mode is deliberately unimplemented in the vendored revision — if a downstream consumer ever needs it, that is a new evidence gate; (d) production adoption still requires the #18/#21 durable-store half and the D39 decision-record acceptance.

Decision-register entry D39 records this as a proposed, evidence-gated recommendation in its own commit, per Issue #12's deliverable and the register's "G1 evidence decisions remain open" slot.

## Issue #46 RNG qualification

Recorded 2026-11-07 (America/New_York), from base main
`b72412514d718c3a0e9245bb45c93223fedfc5b1`, branch
`codex/issue-46-rng-qualification`, Node 24.13.0 on Windows x64, pinned ifvms
revision `6ac63e6b61144d4353a168df16c4ad5c22526f88`, unchanged v2
checkpoint implementation. The final source/review/CI SHAs are recorded in
the associated PR and issue closeout; this section records local evidence.
The canonical 88,576-byte fixture retains SHA-256
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.

The original library-free Z5 generated by
`experiments/vm-checkpoint/test-support/rng-story.cjs` is 2,048 bytes, SHA-256
`b137a5ad9174dc6616a95a36909abe90fcfd32f998ea9297e172e7c08672d514`
(asserted by the test). Its dictionary is in static memory and its full
96-word abbreviation table is separate from code, with entries pointing to an
empty packed string. It has its own story identity; the test does not patch
the canonical fixture, recompile Inform, or modify the runtime. Its commented
layout/opcodes implement predictable seed -> character boundary -> `random 0`
-> draw/retain/print -> same predictable seed -> character boundary -> seeded
draw/print -> halt. See [Standards 1.1 RNG](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect02.html)
and [opcode dictionary](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect15.html).

`tests/rng-transitions.test.js` supplies four deterministic cases:

| #46 deliverable / acceptance | Executed evidence and disposition |
| --- | --- |
| Restart/unseeded transition; no silently accepted unsupported boundary | Accepted `seed 42` snapshot -> `restart`, `yes` -> seed zero; live capture throws `E_RNG`. Controlled child rolls are exactly 1 versus 6. Ordinary restore runner serialization reports failure, exits 4, emits no `serialized:true`, and creates no output checkpoint. Baseline envelope, file, transcript/fingerprint and later seeded continuation remain unchanged. |
| Mid-turn entropy and final-boundary limitations | Both children restore the same minimal-story snapshot, consume exactly one host draw in the turn, print/retain 1 versus 6, and finish at seed -42. Current capture accepts both final snapshots; their output, RAM and global hashes differ. Thus final seed alone does not prove replay equivalence. Each final snapshot recaptures in full and continues identically to its own uninterrupted control under opposite host entropy, with zero further host draws. Earlier entropy reversibility is not established. |
| Candidate publication eligibility | Only the parent knows the simulated store path. Step output alone writes nothing. Restart/capture rejection and an invalid final-envelope checksum leave store/baseline bytes unchanged, despite speculative output and a clean test-scaffold exit. The positive seeded control writes once only after trusted validation, whole-envelope fresh recapture, matching continuation, and clean child exits. The minimal entropy story is excluded by this gate's fixed canonical-story route, not by a generic detector. |
| Runtime support and D39 remain conditional | Runtime/adapter/runner/schema/vendor files are unchanged. Unseeded capture/restore remain rejected; arbitrary-story replay/startup is not qualified. No production coordinator or entropy capture/injection provider is added. D39 remains proposed and owner-unapproved; #12/#40 remain open. |
| Future controlled-entropy startup gate | Before broader support, separately approve control or recording before the first startup instruction and through restart/mid-turn execution, bind that entropy/outcome history to recovery, and prove reconstruction. This gate is documented, not implemented. |

Controlled `Math.random` replacement exists only in a fresh test child. Counts
separate transient restore startup (100 canonical-library warm-up draws),
confirmed restart (another 100), and `roll` (one); the restart experiment totals
201, not one. The seeded publication controls have 100 transient startup draws
and zero turn/suffix host draws. The minimal fixture has zero startup draws.
This is bounded fixture recovery evidence, not proof that arbitrary startup
effects or host entropy have been reversed. The fixture's custom SEED command
is not an arbitrary-story capability.

Local commands/results (all exit 0, empty stderr):

| Working directory / command | Result |
| --- | --- |
| Repository root: `node --test experiments/vm-checkpoint/tests/rng-transitions.test.js` | 4 passed, 0 failed/skipped |
| `experiments/vm-checkpoint`: `node --test` | 93 passed, 0 failed/skipped |
| `experiments/vm-io`: `node --test` | 61 passed, 0 failed, 1 WSL-dependent skip |
| `tests/fixtures/zmachine`: `node --test` | 2 passed, 0 failed, 1 skip: pinned compiler absent |
| Repository root: `node --test tests/ci/checkout-normalization.test.js` | 1 passed, 0 failed/skipped |

Coordinator-retained stdout/stderr: `D:/projects/zirp-issue46-{rng-r2,checkpoint-r2,vmio,fixture,checkout}.{out,err}`;
these local logs are not portable published artifacts. Historical VM-I/O
receipts are restored after the tests; they are not fresh evidence. Hosted
results and independent read-only review must be recorded separately in the PR
before closeout. No live-model, host/device, service or deployment trials ran.

Output publication requires the complete declared recovery contract, not merely
a nonzero seed, valid checksum, candidate output, or successful exit. This
test-only parent gate is deliberately fixture-allowlisted: it does not detect
hidden entropy in arbitrary stories, authorize the mid-turn experiment for
replay-based publication, or implement production durable commit/receipt
recovery (#18/#21). #46 can close as this bounded qualification, with the
mid-turn replay limitation explicitly retained; it does not complete #12/#40,
approve D39, start #47/#14, or authorize restarting the service.


## Issue #47 cache and window qualification

Recorded 2026-11-08; source base `5166d24457aaf5bb0bdfd839f67ff9c395f9e0b2`,
branch `codex/issue-47-cache-window-qualification`, pinned ifvms revision
`6ac63e6b61144d4353a168df16c4ad5c22526f88`, Node 24.13.0 Windows x64.
Final source SHA, independent review and hosted/main CI belong to the PR/issue
closeout. This section records coordinator-executed local qualification only.
Canonical fixture SHA-256 remains
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.

### Source inventory

Paths below are under `experiments/vm-io/` unless stated otherwise. All vendor,
adapter and shim sources are unchanged. Cache objects/functions are observed
in test metadata only, never serialized as executable checkpoint content.

| Family | Source and lifetime | Qualification / required later adapter work |
| --- | --- | --- |
| Compiled JIT functions | `vendor/ifvms/src/zvm.js` initializes `jit` once, dispatches cached entries per PC, compiles on a miss, and even caches dynamic addresses. `zvm/runtime.js` restart/native restore do not clear it. | Fresh startup can reuse compiled entries; later PCs compile lazily. Immutable cold/warm controls recover; dynamic-code stress shows differing cache history. Arbitrary self-modifying-code support is not claimed (#20/#21). |
| Decoded text, shared JIT namespace | `zvm/text.js` decode checks `jit[addr]` and caches static-address results. Abbreviations use a bound deferred lookup through the abbreviation table in current RAM. | Immutable text and a changed dynamic abbreviation target recover in these controls. This does not qualify arbitrary mutable text dependencies. |
| Dictionary cache | `init_text` parses the standard dictionary at startup; `parse_dict` caches separators/entries; `tokenise` reuses a cached explicit dictionary. Native restore does not rerun `init_text`. | A source-warmed mutable custom dictionary can remain stale while a fresh child parses its modified RAM. Cache provenance/content are absent from v2; a generic detector or reconstruction requires separate #20/#21 work. |
| Alphabet and Unicode/reverse tables | `init_text` copies table data into arrays/maps at startup. Native restore replaces table RAM but does not reinitialize those arrays/maps. | Both source and restored runs can agree on stale lookups. That is startup reuse, not rebuilding or proof of correct mutable-table semantics. Unsupported. |
| Stack/local views | `zvm/runtime.js` native restore reconstructs frames/stack and calls `make_stacks`. | Existing stack fingerprints plus new backing-buffer alias checks corroborate reconstruction; undo remains unsupported. |
| Main/upper/status objects | `zvm/io.js` opens main/status at startup, opens/closes upper through split/fix operations. `glksim.js` retains role/type/parent/text/cursor objects. Checkpoint captures text/cursor/rock and logical I/O only. | New guards require matching roles/presence; no general topology creation. Status role is checked as a field relation; new stories are Z5 and do not qualify Z3 status-line behavior. |
| Geometry / current output target | `glksim.js` reports fixed 80x24 dimensions and ignores arrangement changes; VM print synchronizes the selected window. | Logical cursor/selector/height and output comparisons are headless evidence only, not actual Glk geometry or device rendering. |

### Reproducible cases and dispositions

`test-support/state-support.cjs` builds eleven original 4,096-byte Z5 stories;
`tests/cache-window.test.js` pins every generated SHA-256. The standard dictionary
is static, an explicitly supplied tokenise dictionary is dynamic, table writes
stay above the header in dynamic RAM, and static code/text are immutable.
The below-high-memory, self-modifying routine is expressly diagnostic stress,
not a portable/conforming-story compatibility claim. No canonical story is
patched, no compiler/dependency is installed, and no cache clearing is injected.
See [memory rules](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect01.html),
[dictionary rules](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect13.html),
and [screen model](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect08.html).

| Case | Concrete observed result | Disposition |
| --- | --- | --- |
| Cold/warm immutable code and text | Source warmed caches differ from fresh-start child metadata, but complete immediate envelope, output/events, continuation fingerprints, windows and I/O match. | Verified for these fixtures; not a universal cache-rebuild claim. |
| Explicit mutable dictionary | Both immediate envelopes match; source cache still finds `cat` at 0x604 (prints 1540), child parses modified `dog` and prints 0. RAM continuation differs. | Reproduced divergence; unsupported dependency history, outside qualified recovery/publication. |
| Mutable abbreviation target | Static cached text thunk uses the restored dynamic table target; both print `b` with exact envelope/continuation. | Verified bounded control. |
| Mutable alphabet / Unicode | RAM changes to `b` / `B`; both derived lookups and continuation remain `a` / `A`. | Reproduced stale startup state in the runtime itself; equality is not semantic support. Unsupported. |
| Dynamic-code stress | Source cached rtrue still prints 1 after RAM becomes rfalse; fresh child compiles rfalse and prints 0. Immediate envelopes match. | Diagnostic divergence, not general Z-machine compatibility evidence. |
| Late-opened / removed upper window | Before guards, ordinary runner announced ready then failed serialization with exit 4. Now rejects `E_WINDOW_TOPOLOGY`, exit 2, exactly one `ready:false`, no serialization/file, baseline unchanged. | Explicit unsupported topology, never silently skipped. |
| Shrink / close / reopen | Whole envelope, logical I/O/cursors/role metadata and multi-input continuation match. | Headless control only; physical arrangements remain unqualified. |
| Selected-upper character input | Upper text is `U\n` but published grid transcript is `U`; capture refuses existing `E_STRUCTURE` without changing the source. | Cannot qualify recovery for that path; no shim fix in this task. |
| Growing an existing upper window | Missing `glk_window_get_stream` causes a handled VM fault and no capturable boundary. The child logs the expected TypeError to stdout, explicitly asserted by the test. | Unsupported; no hidden stderr suppression or broadened shim support. |
| Selector/rock/type and native-change scaffolding | Honest-checksum invalid saved relations reject; malformed rock remains `E_STRUCTURE`; a per-test native-restore wrapper runs the real restore then removes upper, and the post-native guard rejects. | Guard tests, clearly separate from story-driven/process evidence. |

### Guard and compatibility boundary

`E_WINDOW_TOPOLOGY` validates saved selector/rock relationships and live
role/type/parent relationships. After isolated startup, and again after native
restore, saved/fresh presence is compared before restored input/readiness.
These guards do not build missing windows, clear caches, or establish geometry.
The original pre-VM data validation remains; fresh-start checks necessarily
construct a candidate interpreter. Capture self-validation does not prove
fresh-start compatibility. Failed candidates leave the live baseline and its
checkpoint bytes unchanged.

V2 layout is unchanged. Checkpoint core/format/capability source bytes change
its existing adapter build identity, so prior-build envelopes require fresh
capture (`E_RUNTIME`), with no migration. Cache-history-dependent unsupported
families are declared in capabilities/documentation but are NOT automatically
recognized in arbitrary envelope bytes. The accepted scope remains the pinned
seeded fixture matrix and specifically verified controls, not arbitrary stories.
A checksum or equal recapture is not permission to publish an unqualified case;
production adapter, cache invalidation/provenance and complete window restoration
remain #20/#21. Durable commit/publication stays #18/#21; #48 is not started.

### Local verification and #47 acceptance

Final focused suite: 14 passed; full checkpoint suite: 107 passed, preserving
the existing 93 tests. VM-I/O: 61 passed / 1 WSL-dependent skip; fixture integrity:
2 passed / 1 pinned-compiler skip; checkout normalization: 1 passed. Commands
are `node --test tests/cache-window.test.js` / `node --test` in the checkpoint
directory, `node --test` in VM-I/O and fixture directories, and
`node --test tests/ci/checkout-normalization.test.js` at the root. All final
commands exited 0 with empty stderr; read-back stdout is retained in `D:/projects/zirp-issue47-final-{focused,checkpoint}.{out,err}`
and `D:/projects/zirp-issue47-{vmio,fixture,checkout}.{out,err}`.
A separate prior-build check captured a seeded canonical checkpoint with head
`98de24a46e4c66303b8bff93599f77a6290f14ee` (same checkpoint implementation as
base main), then the changed ordinary runner refused it with `ready:false`,
`E_RUNTIME`, exit 2 and empty stderr. Source capture exited 0 and the checkpoint
file remained byte-identical; receipt: `D:/projects/zirp-issue47-compat.json`.
The pre-guard receipt `D:/projects/zirp-issue47-red.{out,err}` records 10 passes
and 3 expected failures (both topology cases and missing relation rejection).
Local logs are not portable public artifacts; exact hosted evidence and the
independent read-only verdict must be recorded separately in the PR.
Historical VM-I/O receipts are restored rather than relabeled as new evidence.

| Acceptance | Bounded disposition |
| --- | --- |
| Source inventory plus tests/cannot-prove findings | Inventory and exact cases above, with eleven pinned original fixtures and separate guard scaffolding. |
| Rebuild versus startup reuse and required changes | JIT/text lazy versus startup reuse, dictionary divergence, stale alphabet/Unicode tables, deferred abbreviation lookup, stack reconstruction, and missing geometry explicitly separated. Arbitrary repair requires #20/#21 work. |
| Preserve seeded matrix and unsupported boundaries | Full suite retains existing seeded/RNG/timed-input/identity/protocol coverage; narrow topology rejections add no general restoration support. |
| Cross-reference arbitrary-story work | #20/#21 retain native integration and combined restoration; no premature compatibility or D39 adoption. |

Unsupported characterization tests assert the discrepancy, not recovery success;
they must not be counted as successful arbitrary-story cases. This declaration,
plus explicit rejection of the detectable topology cases, is the approved
qualification boundary. D39 remains proposed and owner-unapproved; #12/#40
stay open. No #48/#14 work, service restart, live-model or host/device trial is
performed. If review finds a silently accepted unsupported case within that
declared qualified route, leave #47 open and identify the smallest remaining
adapter requirement instead of broadening reconstruction.

## Issue #48 deterministic interruption qualification

Recorded 2026-11-08; source base `4857a4226e238f3b5788d849863d05eef6d7f1c8`,
branch `codex/issue-48-deterministic-interruption`. The approved approach is a
separate test-only phased child, not instrumentation of the ordinary runner.
Final source/review/CI SHAs and hosted logs are recorded separately in the PR
and issue closeout. The original four-phase timing-dependent kill test is
replaced, while its dated source observations are retained above.

### Unchanged implementation and exact fixture

Canonical original Z5 fixture: 88,576 bytes,
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
Pinned ifvms: `6ac63e6b61144d4353a168df16c4ad5c22526f88`;
runtime source build `d225d898a0c93b7efc020549d16bda391561632c3cc5b06dc62119d498863454`;
adapter source build `15cfa97b6299dbd85d0d4b72b6a14f625034688a0ff9aca87f78ba4ba1668cd7`.
The runner, checkpoint implementation, capability statement, v2 layout,
fingerprint oracle, adapter/shim/vendor and canonical fixture are unchanged.
No compatibility migration or new production interface is introduced.

`test-support/interruption-child.cjs` uses real restore/capture and real fixture
inputs. Its support module imports only Node builtins before the startup gate.
The prefix is `look; seed 42; take brass key; north`, mutations are
`seed 7; roll; south; inventory`, and the baseline/qualified-candidate suffix is
`inventory; seed 42; roll; look`. Uninterrupted controls execute the same inputs.

### Observed barriers and publication disposition

| Acknowledged child barrier | Exact observation before termination |
| --- | --- |
| `startup-entered` | Child entered its scaffold, before loading/restoring the VM. This is not interruption inside VM initialization. |
| `restored-boundary` | Real restore returned; live fingerprint and pending request/readData match the source boundary. |
| `mutation-complete` | All four real inputs returned; exact private steps, RNG marker, changed output, fingerprint and pending input match the uninterrupted candidate control. |
| `serialization-entered` | Explicit **before-capture** gate; no claim of pausing inside synchronous serialization. |
| `capture-complete` | Real capture/JSON encoding returned; byte count and digest match the control; no output checkpoint exists yet. |
| `partial-write-complete` | Actual strict prefix written through a short-write-aware loop, handle closed, exact prefix read back; child waits before writing remaining bytes. |
| `candidate-finished` | Complete checkpoint bytes match the control, final private stdout record received, child paused before clean exit. Valid bytes do not permit publication after a kill. |

The parent queues IPC acknowledgments and private stdout separately. It waits
for exact candidate/phase/sequence matches; each child installs the release
receiver before sending its acknowledgment. Phase acknowledgments cannot be
lost merely because a consumer has not awaited them. Deliberately releasing the
wrong sequence makes the child exit 4 with its expected diagnostic; no next
phase or checkpoint appears. Normal cases require empty child stderr.

Every kill occurs after an acknowledgment while the child is still live.
Both exit and pipe-close observations are required, with a 10-second termination
deadline, 30-second phase deadline and 120-second per-case timeout. Deadlines
contain failure, not prove a phase. Local kill cases observed code null and
signal SIGKILL at both exit/close; the TAP diagnostics retain the actual values.
All temporary cleanup is path-guarded and happens after observed termination.

On Node 24.13.0 Windows x64, the controlled partial file contains **9,196 of
18,393 bytes**. It remains the exact prefix after killing/reaping the child.
The unchanged ordinary runner rejects it with one `ready:false`, `E_FORMAT`,
exit 2, no successful serialization and no new output file. This is a chunked
**test-writer** experiment, not interruption of the runner's `writeFileSync()`,
VM capture, fsync, kernel/device writes, power loss or durable orphan recovery.
The legacy stall option remains unchanged and precedes capture/write.

Private candidate stdout is actually consumed and compared, including nonempty
speculative output; it is not the user-visible publication channel. The
parent-owned simulated store path is never sent to children, which is ownership
discipline, **not a filesystem/OS security boundary**. Publication requires clean
child completion/pipe closure, valid trusted-identity envelope, exact fresh-child
recapture and matching seeded continuation. The same gate proves:

- Killed finished candidate: complete valid bytes, non-clean exit, no publication.
- Invalid final envelope after clean exit: `E_DIGEST`, no publication.
- Parent pre-publication cancellation after clean exit and complete qualification:
  eligible candidate discarded, zero publication calls; no claim of killing a dead child.
- Positive control: same qualification succeeds, one parent write, exact changed store bytes.

After every negative, the baseline file, whole live recapture, fingerprint,
transcript, pending input and store bytes remain unchanged. The baseline's
subsequent exact steps and final state match a never-candidated control.
Candidate continuation comparisons retain only the existing declared undo-depth
variance; whole envelopes and output/events are compared without exclusions.

### Commands, acceptance and limits

Focused: `node --test --test-reporter=tap tests/interruption-phases.test.js`
in the checkpoint directory: **11/11 pass**. Full checkpoint `node --test
--test-reporter=tap`: **117/117 pass** (107 previous tests minus the replaced
combined kill test plus eleven new cases). VM-I/O: **61 pass / 1 WSL-dependent
skip**; fixture integrity: **2 pass / 1 pinned-compiler skip**; both use the same
full-suite Node command in their directories. Root
`node --test --test-reporter=tap tests/ci/checkout-normalization.test.js`: **1 pass**.
All final commands exited 0, stderr empty. Expected wrong-release child stderr
is captured and asserted inside its test, not treated as a clean child.
Raw logs: `D:/projects/zirp-issue48-focused-r3.{out,err}`,
`D:/projects/zirp-issue48-checkpoint-r2.{out,err}` and
`D:/projects/zirp-issue48-{vmio,fixture,checkout}-r1.{out,err}`;
these local-only paths are not portable public receipts. TAP diagnostics retain
phase sequences, artifact sizes/digests, exit/close, private-record counts,
baseline continuation and publication-call outcomes. The final focused/full
checkpoint reruns also retain explicit working directories and exits in their
matching `.json` command receipts. No historical receipt is
rewritten as fresh evidence; hosted CI and independent verdict belong in the PR.

| #48 acceptance / deliverable | Test or explicit limit |
| --- | --- |
| Deterministic barriers replace timing-dependent claims | Seven named `acknowledged interruption at ...` cases replace the old four-phase delay test; exact IPC release protocol and wrong-sequence negative. |
| Exact transition, cleanup, no secretly published output | Real phase-state/file assertions; observed exit and pipe closure; baseline/store/continuation checks; complete-checkpoint killed-candidate and invalid-envelope negatives; path-guarded cleanup. |
| Private stdout versus user-visible publication | Private nonempty output verified before mutation/later kills; parent publication-call counter and store checked; cancel and positive controls exercise the same qualified gate. |
| A28 candidate-process evidence and A29 production requirement | A15/A28 are candidate-process/test-harness evidence. A29 durable head/receipt commit and idempotent retry are **not proven**, owned by #18/#21. Ordinary-runner partial-write interruption and real storage durability remain unproven. |

D39 remains proposed and owner-unapproved; #12/#40 remain open. No #49/#14
work, general input/output hardening, sandbox, production coordinator, service
restart, live-model or host/device trial is performed. An unmet independent
review/CI gate or a discrepancy within the declared route leaves #48 open.

## Issue #49 probe transport limits

Recorded 2026-11-08; source base `025ca8d1e2b125deb821e47cc2fa8fff7c092a79`,
branch `codex/issue-49-probe-io-limits`. This supersedes earlier unqualified
output-limit/bounded-collection wording for the current runner while retaining
the dated observations. The approved approach changes transport and test
support, not the synchronous VM-I/O adapter/shim or vendor implementation.

### Exact bounds and compatibility

`lib/transport-limits.js` is the implementation-owned source: runner story
4 MiB; checkpoint input/encoded output 32 MiB UTF-8; decoded JSON 32 Mi UTF-16
code units (`CAPS.jsonChars`); request line before LF 64 KiB and cumulative
input 8 MiB; stdout record including LF 8 MiB and cumulative stdout 32 MiB;
parent-retained stderr 64 KiB; terminal diagnostic reserve 1 KiB within stdout.
`--output-limit` is cumulative `delta.length`, default/maximum 4 Mi UTF-16
code units, configurable downward to a positive safe integer only. These are
probe limits, not adopted product budgets. No ordinary bypass/raise flag exists.

Files are opened once, checked through their descriptor, required to be regular
and read with a short-read-aware cap-plus-one loop. Growth after metadata does
not bypass the cap. Byte/character checks precede checkpoint JSON parsing;
invalid UTF-8/truncation is `E_FORMAT`, oversize `E_SIZE`, `ready:false`, exit 2.
Encoded serialization size is checked before opening/replacing `--out`;
oversize is sticky `E_SIZE`, exit 4, with no success response. The ordinary
runner test preserves an existing output sentinel. Its oversize envelope is
explicit post-capture guard scaffolding, not a story-produced supported state.

Byte-framed protocol input and awaited stdout writes replace unbounded line
accumulation; input overflow is terminal `E_INPUT_LIMIT`, exit 4. Story-output
and wire overflow are terminal `E_OUTPUT_LIMIT`, exit 3, with a small diagnostic
instead of the offending response; later requests do not execute. All encoded
responses count, including readiness, fingerprints and errors. Below-limit
sticky failures, explicit exit and paused-reader drain behavior remain tested.

Parents count raw bytes before decoding/parsing, retain bounded fragments and
records, queue early messages and keep failures sticky through close. They kill
failed live children, drain/discard excess data and observe both exit and final
pipe closure before guarded temporary cleanup. Default response waits are
30 seconds; termination waits 10 seconds; existing larger case timeouts remain.
The test-only synchronous facade uses a separate supervising Node process for
independent stdout/stderr caps and preserves original response text. Its outer
timeout is the requested deadline plus 15 seconds and its finite `maxBuffer`
is 32 MiB + 64 KiB. An outer timeout/error cannot prove inner-child cleanup.

The legacy mutable-window diagnostic case emitted a handled TypeError/stack
directly to stdout before JSON. The diagnostic scaffold now retains its full
formatted message/stack in bounded `vmDiagnostics` data. Tests still assert the
same missing Glk method, error step and `E_NOT_AT_BOUNDARY` capture refusal.
This reporting process's zero exit does not qualify candidate execution.

Canonical fixture: 88,576 bytes, SHA256
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
Pinned ifvms revision `6ac63e6b61144d4353a168df16c4ad5c22526f88`, runtime build
`d225d898a0c93b7efc020549d16bda391561632c3cc5b06dc62119d498863454` unchanged.
New adapter source identity:
`2fd2b4f6ffcd00759e8d73c76c09633f833595f47b3bb2d651e817494d36b736`.
Transport is included in the source inventory and mutation regression. V2 layout,
checkpoint state semantics and fingerprint oracle are unchanged; prior builds
reject `E_RUNTIME` and require fresh captures. No migration is claimed.

R1 independent review approved the original candidate with two non-blocking
diagnostic findings. Callback assertions now retain their original error/code,
and unexpected runner failures emit bounded `E_INTERNAL` evidence with exit 4
(or bounded stderr fallback for broken stdout). Three regressions cover those
paths. A comment clarifies that the equal numeric byte cap currently subsumes
the character cap. Counters stop after failure; excess bytes are discarded, not
retained or included in counter totals. Startup-refusal tests send no queued
input, avoiding an unnecessary stdin-EPIPE race. All synchronous runner cases,
including copied-tree identity checks, import the bounded facade; the local
name `spawnSync` does not imply a raw Node call. Renewed exact-head review is a
separate required gate; no approval is inferred for these changed bytes.

### Tests, acceptance and remaining risks

Local Node 24.13.0 Windows x64 focused command in the checkpoint directory:
`node --test --test-reporter=tap tests/transport-limits.test.js`: **24/24 pass**.
Full checkpoint `node --test --test-reporter=tap`: **141/141 pass**, preserving
117 prior cases plus 24 new. The same full command in VM-I/O: **61 pass / 1
WSL-dependent skip**; fixture directory: **2 pass / 1 pinned-compiler skip**.
Root `node --test --test-reporter=tap tests/ci/checkout-normalization.test.js`:
**1/1 pass**. Final commands exit 0 with empty command stderr. Expected child
fault diagnostics are captured/asserted within tests. Initial implementation
failures were fixed; their raw logs remain separate, not passing evidence.

Local-only raw logs: `D:/projects/zirp-issue49-focused-r8.{out,err}` and
`D:/projects/zirp-issue49-{checkpoint-r5,vmio-r1,fixture-r1,checkout-r1}.{out,err}`.
The latter runs have `.json` receipts with actual cwd, command, exit and hashes.
These paths are not portable public receipts. Final source/review SHAs,
Windows/Ubuntu hosted logs, verdict and issue disposition belong in the PR and
issue closeout; no new committed machine-readable result receipt is supplied.

| #49 acceptance | Test / disposition |
| --- | --- |
| Reject oversized/truncated input and bound captured child output | Reader exact-cap/plus-one/short-read/growth/descriptor tests; parse spy confirms byte refusal before parsing; invalid UTF-8/truncated and oversized ordinary-runner cases; byte-framed input; response and parent record/aggregate/stderr tests. |
| Failures are not clean; baseline/store unchanged; reaping observed | Real fixture low-output-limit omission and no queued serialization; existing output preserved on serialization refusal; synthetic malformed/partial/flood/deadline cases; actual zero-exit child remains ineligible; baseline file/whole capture/fingerprint/transcript/pending state and exact seeded suffix/store checked. |
| Synthetic/pinned fixtures on Linux/Windows | Only synthetic files/processes, existing pinned original fixtures and existing diagnostic stories; local Windows pass above. Hosted Windows/Ubuntu is a separate required PR/main gate, not asserted by this local report. |
| Exact limits, risks and #30 handoff | Fixed-limit table and threat model here/README; no sandbox/private-import/quota/rate-limit or durable publication implementation. #30/#22/#18/#21 retain ownership. |

The zero-exit overflow test replaces the parent's kill method **only in that
test** to simulate a kill arriving too late; the real synthetic child exits 0
and its transport fault remains ineligible. Other cases exercise actual kills.
TAP diagnostics retain observed code/signal at exit/close, counters, retained
bytes and zero publication calls. The positive fixture control uses trusted
fresh restore, whole-envelope recapture and exact seeded continuation before
one simulated parent publication; no universal-rejection assertion can pass it.

Children inherit cwd/environment and ordinary host-user filesystem/network
authority. General spawns use inherited environment; interruption children copy
it and remove only `NODE_TEST_CONTEXT`. No credentials/environment values are
recorded. No OS permission restriction, sandbox or account isolation is added.
Missing publication-store paths are ownership discipline, not a security gate.
Synchronous VM execution, JSON encoding and parsing can allocate or consume CPU
before/within transport checks. Retained raw text plus parsed records and
temporary buffers are not a JS heap quota. JSON complexity, CPU/memory/IO quotas,
rate limits, descendant containment, arbitrary private-story safety and hostile
imports remain unqualified. Object APIs receive already-constructed data.
#30 owns production sandbox/quotas, #22 private imports, #18/#21 durable
publication/receipt recovery. #50's shared-filename repair is not included.

D39 remains proposed and owner-unapproved; #12/#40 stay open. No #50/#14 work,
service restart, untrusted import, deployment or live-model/device trial is
performed. Missing independent review/CI or an unbounded declared transport
boundary leaves #49 open.

## Issue #50: separate G1-A evidence-writer correction (2026-11-08)

The [#50 qualification and acceptance mapping](g1-native-io.md#8-issue-50-evidence-writer-qualification)
records unique staging, mandatory publication guards, ownership-aware outer
test locks, deterministic interrupted writers and exact receipt restoration.
It leaves the checkpoint implementation, envelope and source-build identity
unchanged; the local 141-test checkpoint baseline remains green. The preceding
#49 statement excluding #50 is historical. Atomic evidence-reader visibility
does not establish OS/fsync crash durability or A29 receipt recovery (#18/#21).
D39 remains proposed and owner-unapproved; #12/#40 remain open. No #51/#14
work or service restart is authorized or performed by this correction.

## Issue #52 documentation acceptance

| Criterion | Evidence and disposition |
| --- | --- |
| Claims trace to tests, builds, runs or explicit gaps | The [current baseline](#current-evidence-baseline-2026-11-08) and [acceptance mapping](#9-acceptance-mapping) bind observations to their source and preserve original PR #37 counts separately. The reviewed [PR #37 addendum](https://github.com/dhar174/zmachine_if_remix_plugin/pull/37) is a separate closeout deliverable. |
| D39 stays proposed with blockers and owner review | The [D39 owner checklist](../decisions/decision-register.md#d39-owner-review-checklist) records the candidate, choices, and unresolved obligations. |
| Fixture scope stays distinct from production | A28/A29 distinguish candidate interruption from durable recovery. A31 is native only. The [cache/window](#issue-47-cache-and-window-qualification) and [transport](#issue-49-probe-transport-limits) evidence retain limits on replay, geometry, conformance, sandboxing and host support. |
| Owner approval is explicit | The D39 checklist and parent acceptance criteria require a separate decision. #52 concerns documentation reconciliation. |

#52 uses retained execution evidence. Local runtime, Bocfel, model and host trials were not run for this documentation change. The #52 PR and closeout record the independent verdict and hosted verification.
