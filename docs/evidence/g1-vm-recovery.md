# G1-B evidence: native VM checkpoint, recovery, and candidate isolation probe

**Issue:** [#12](https://github.com/dhar174/zmachine_if_remix_plugin/issues/12) under #4 (G1 Technical Feasibility). **Probe brief:** `docs/superpowers/plans/2026-10-22-g1-b-checkpoint-probe.md`. **Status:** executed 2026-10-23; draft PR pending independent review. This document records measured evidence and a **proposed** recommendation; it is not an owner-approved runtime decision (roadmap G1 stop gate; decision-register D39 records the proposal).

## 1. Executive findings

**GO for the pinned ifvms.js ZVM as the checkpoint-capable probe candidate — proposed, evidence-gated, and conditioned as follows.** A live interpreter at a real line or character input boundary (or at a terminal/halted state) was serialized into a versioned, data-only envelope, and a **fresh child process** restored from the checkpoint file plus the pinned story asset only — then continued with an input suffix whose full output, event/marker ordering, and machine-state fingerprint (dynamic memory, call stack, globals, pc, RNG seed, request log) matched an uninterrupted reference run exactly (in the round-trip matrix the source interpreter is abandoned in the parent after capture; the kill suite additionally destroys candidate *processes* mid-flight). Discarded speculative candidates — including ones killed during bootstrap, at the boundary, mid-serialization, and before a simulated publication boundary — left the baseline byte-identical and continuing identically to a control that never saw a candidate (A15, A16, A31, A34 demonstrated at the candidate-process layer; A28–A29 receive only process-failure evidence plus documented production requirements, below).

Unseeded (random-mode) RNG continuation works but is **not reproducible across processes by design**: draws come from `Math.random` (the only host-entropy point in the vendored tree), so restored draws are fresh per-instance entropy. Seeded (predictable-mode) continuation is exact. This is reported as a documented capability boundary, not hidden behind seeded-only tests.

**Bocfel 2.6's own autosave route was investigated and is NOT a complete alternative on this evidence**: its boundary autosave (written at every `@read`/`@read_char`) restores and continues correctly across process death at **line** boundaries — including exact seeded-RNG continuation via the `Rand` chunk — but the **character-boundary autosave fails its own restore** with a reproducible interpreter error (`[Save file error: invalid Args size for 1: 0]`, falling back to a fresh start), and random-mode RNG state is not serialized at all (source-verified and observed). Bocfel therefore remains the independent I/O reference from G1-A, not a checkpoint candidate.

## 2. Test environment

| Item | Value |
| --- | --- |
| Date | 2026-10-23 |
| OS | Windows 10.0.26340 x64 (Git Bash; WSL2 for Bocfel) |
| Node | v24.13.0 |
| Branch / base | `codex/issue-12-g1b-vm-checkpoint`; probe code and evidence recorded from the branch as it grew (probe suite commit `4a4b5e3`, evidence `ca618a5`, review hardening in the final commit; base main @ `8c330ce` — PR #36 merge verified present, no newer commits at probe start) |
| Fixture | `tests/fixtures/zmachine/fixture.z5`, SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, 88,576 bytes (verified from the checkout; Inform 6.44 + Library 6.12.8, unmodified from G1-A) |
| Primary candidate | vendored ifvms.js ZVM, revision `6ac63e6b61144d4353a168df16c4ad5c22526f88` (MIT; `experiments/vm-io/vendor/ifvms`) |
| Bocfel reference | Bocfel 2.6 non-Glk build via WSL2; tarball SHA-1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da` (`experiments/vm-io/tools/bocfel-2.6.tar.gz`, pinned by G1-A) |
| Suite | `experiments/vm-checkpoint` — 33 tests (`node --test` from that directory), zero npm dependencies |

Baseline verification runs recorded before probe work (actual counts, not assumed): fixture integrity suite 3 tests / 2 pass / 1 machine-dependent skip (pinned Inform compiler absent; digest evidence stands); vm-io harness suite 57 tests / 56 pass / 1 machine-dependent skip / **1 fail reproduced 5/5 runs** — a pre-existing G1-A defect, fixed in an isolated commit (see §7).

## 3. Checkpoint envelope and restore mechanism

Envelope v1 (`experiments/vm-checkpoint/lib/checkpoint-format.js`) is data-only JSON: no functions, never the JIT cache. Sections: `format`/`version`; `identity` (story SHA-256 + size, runtime name + pinned revision, adapter, schema); `boundary` (`line`/`char`/`halted` + pending line maxlen); `payload` (Quetzal from the upstream `vm.save_file(pc, 1)` primitive — `IFhd` identity, `UMem` raw dynamic memory, `Stks` in-use call stack — plus RNG seed/mode, plain-data `io`, pending `read_data` with its buffer, window text/cursor, published buffer+grid transcript, request log minus the pending entry, VM halt flags, undo disposition); `integrity` (SHA-256 over the canonical payload); `capabilities` (coverage + unsupported list carried with the data).

Restore (`lib/checkpoint-core.js`) always targets a fresh interpreter and follows upstream's own `do_autorestore` recipe plus additions the upstream never performs:

1. **Validate everything before any interpreter exists**: format, schema version, story digest/size, runtime revision, boundary kind, per-section structure, size caps, payload digest. Rejections throw `CheckpointError` with stable codes (`E_FORMAT`, `E_VERSION`, `E_STORY`, `E_RUNTIME`, `E_DIGEST`, `E_STRUCTURE`, `E_BOUNDARY`, `E_SIZE`). A second, VM-level identity gate sits behind the envelope: `vm.restore_file` verifies the Quetzal `IFhd` release/serial/checksum against the loaded story and returns 0 → `E_STORY_QUETZAL` (tested with a fully impersonated envelope over different story bytes).
2. Fresh adapter runs its normal startup (windows, `origram`, pristine stack exist), then `restore_file` rebuilds memory/stacks/frames/pc.
3. The interpreter-owned **header block `[0x00..0x40)` is restored verbatim**: `update_header()` (called inside `restore_file`) recomputes screen-size fields as a sum of window heights, so a restored instance recomputes different bytes than the source last published (observed: `0x20`/`0x24` = 24 at capture vs 48 after restore, because the source computed them before the game opened the upper window). Interpreter-owned header state is checkpointed, not recomputed.
4. RNG seed re-applied **after** `restore_file` (its `update_header()` zeroes `xorshift_seed`; upstream `do_autorestore` does the same). Mode derives from the seed: 0 = unseeded (`Math.random` per draw — the only host-entropy point in the vendored tree), nonzero = seeded xorshift.
5. Pending input reconstructed: restored `read_data` + re-issued `glk_request_line_event_uni`/`glk_request_char_event_uni` against the restored buffer, with the request log applied before the re-issue so the final log is byte-identical to the source's. The shared halt predicate (`state.halted || vm.quit`) drives halted restores: `quit=true` restored, no request re-issued, and the adapter refuses further input with no output or state change (tested).
6. Published transcript + window text/cursor applied from the envelope; the output-delta watermark synced — restore **neither republishes the opening text nor loses prior output** (asserted per step in every round trip).
7. Transient fresh-run leftovers discarded: startup output, startup request-log entries, undo entries (upstream autosave semantics drop undo; declared, tested).
8. Process isolation: restore always runs in a fresh child (`lib/runner.js`) fed only the checkpoint file path and the pinned fixture path — no closure, singleton, shared typed array, or hidden test cache crosses the boundary. All child argv is static (no environment-derived values reach argv or file paths).

Three harness rules were learned during implementation and are documented in code and `experiments/vm-checkpoint/README.md`: the vendored ZVM **mutates the story buffer in place** (every interpreter gets its own copy — two instances sharing a Node Buffer leak game state into each other); interpreter-owned header fields must be checkpointed, not recomputed (item 3); and the current frame's in-buffer `sp` slot is stale dead storage in a live interpreter (authoritative `sp` is a VM field, synced only at save/call) — one stale byte was observed to differ at halt, and the stack fingerprint excludes exactly that slot for the current frame (caller slots are kept: `restore_file`'s frame walk reads them).

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
| RNG mode, state, reseeding | `vm.xorshift_seed` | Envelope `rng {seed, mode}` | Re-applied after `restore_file` | **Serialized** | seeded draws + seed equality across restore; reseed case | Unseeded mode: continuation works, draws are per-process entropy — **not reproducible across processes** (documented; comparison rule normalizes draws); `random(0)` = seed 0 = unseeded (source-verified, runtime.js:532); deliberate standard deviation: upstream does not implement sequential predictability mode |
| Window/cursor/style, output streams, pending text, status/upper window | shim window objects (`vm.mainwin`/`upperwin`/`statuswin`), `vm.io`, `state.output`/`gridOutput` | Window text/cursor + `io` clone + transcript strings | Text/cursor written to the (fresh, rock-matched) window objects; `io` assigned; transcript overwritten; watermark synced | **Serialized**; shim `currentWindow` **reconstructed** from `io.currentwin` (VM's notion; the VM re-syncs the shim on every print) | gridOutput equality per step; no-republish per step | Style calls are no-ops in the shim (styles not part of transcript evidence — G1-A scope); upper-window quote-box state carried inside `io` (plain data) |
| Transcript publication position | adapter `lastOutputLen` watermark + `state.output` | Published output string | Overwritten + watermark synced via exposed `settle()` | **Serialized** | per-step full-transcript equality | — |
| Story turn counters / daemons | Story globals + daemon list in dynamic memory | `UMem` (+ globals digest) | Via memory restore | **Serialized** | `[F06:turn=N]` continuity + chime timing in round trips | Timed events (`read_data.time`/`routine`): stored by upstream but **never used** (Flags1 timed-input bit clear; io.js TODO) — **unsupported**, source-verified |
| Halted/error state | `vm.quit`, shim `state.halted`, `state.errors` | `vmFlags.quit` + boundary kind | Halt predicate fields restored; no request re-issued | **Serialized** | halted-restore refusal test (no output, no state change) | — |
| Undo machinery | `vm.undo`/`undo_len` | Not captured | Cleared on restore | **Explicitly unsupported** (upstream autosave drops it) | `@restore_undo` after restore is safe and empty (tested) | Documented, not silent |
| JIT code cache | `vm.jit` | Never serialized | Rebuilt lazily per pc | **Reconstructed** | all round trips (behavior identical) | — |
| Host entropy/time dependencies | `Math.random` only (runtime.js:532); **no `Date.now`/time calls anywhere in the vendored tree** (grep-verified) | n/a | Restored processes draw fresh entropy in unseeded mode; no global patching | **Reconstructed (by design)** | unseeded case: structure compared, draws normalized | Unseeded reproducibility across processes: **blocked by design** — reported, not papered over |
| Timed input, sound, graphics | upstream opcodes / Flags | n/a | n/a | **Explicitly unsupported** (no-op/absent opcodes; Flags1 timed bit clear; Flags2 cleared & 0x57) | n/a | An opcode or property named autosave is not evidence of recovery — none claimed |
| Glk file streams / filerefs | glksim | n/a | n/a | **Explicitly unsupported** (recorded as `unexpected`) | in-game `save`/`restore` not exercised in the checkpoint suite (G1-A scope) | Production save/restore interception is a turn-layer duty (state-and-vm-bridge §8), out of G1-B scope |
| Runtime/adapter/checkpoint identities | envelope `identity` | Serialized | Validated before restore | **Serialized** | E_STORY/E_RUNTIME tests | — |

Derived caches (`jit`, `s`/`l` views, shim `currentWindow`) were rebuilt only with the behavioral evidence above passing. **No comparison was made to pass by excluding an unexplained difference**: the two allowed variance fields are `undoDepth` (declared unsupported, restored ≤ source, monotonicity asserted) and unseeded-mode `output` (draw normalization with the surrounding transcript still compared exactly; `rngSeed` stays 0 in both runs and is asserted).

## 5. Round-trip results (ifvms.js, per boundary and RNG mode)

Every case: independent capture → fresh child restore → identical input suffix → comparison against an uninterrupted reference run. Each case executed twice (independent repetitions). Comparison: full transcript + grid + marker ordering equality after every suffix step, plus final machine-state fingerprint equality (§3).

| # | Boundary | Prefix state at capture | RNG mode | Result | Evidence (test) |
| --- | --- | --- | --- | --- | --- |
| 1 | Line — initial prompt | Startup only | unseeded | **Demonstrated** (2/2 reps) | roundtrip: initial line prompt |
| 2 | Line — after movement, failed action, daemon chime (turns 1–4, `[F06:event=chime]` in captured transcript) | Nonempty | seeded in suffix | **Demonstrated** (2/2) | roundtrip: later line prompt… |
| 3 | Line — parser disambiguation, unresolved input | Two "brass token" objects | unseeded | **Demonstrated** (2/2) | roundtrip: parser-disambiguation… |
| 4 | Character — menu pending, unanswered | `[F07:menu-open]` | unseeded | **Demonstrated** (2/2) | roundtrip: read_char menu… |
| 5 | Line — immediately after a menu answer | `[F07:menu-choice=beta]` exactly once | unseeded | **Demonstrated** (2/2) — no duplicate delivery | roundtrip: boundary immediately after… |
| 6 | Line — seeded draws + reseed | `seed 42`, `roll` | seeded | **Demonstrated** (2/2) — identical draws and seed across restore; reseed to 7 honored | roundtrip: seeded RNG… |
| 7 | Line — unseeded | Any | unseeded | **Demonstrated** (continuation correct; draws normalized — fresh per-process entropy; both runs' draws valid 1–6; seed stays 0) | roundtrip: unseeded RNG… |
| 8 | Line — endgame prompt (`deadflag=2`, RESTART/RESTORE/QUIT pending) | Victory | unseeded | **Demonstrated** (2/2) — suffix `quit` halts identically | roundtrip: endgame prompt… |
| 9 | Halted (post-`@quit`) | Terminal | n/a | **Demonstrated** — restore succeeds; new input refused with zero output and zero state change (shared halt predicate) | roundtrip: restored halted execution… |
| 10 | Undo after restore | ≥1 turn | n/a | **Demonstrated** — `undo` handled safely; no undo history; restored depth ≤ source | roundtrip: in-memory undo… |

Reproduce: `cd experiments/vm-checkpoint && node --test` (33 tests, 0 failures, 0 skipped on this machine; CI covers ubuntu + windows via the checkpoint smoke workflow).

## 6. Candidate isolation results

Baseline model: a live in-parent interpreter at a captured checkpoint; candidates are fresh child processes restored from the baseline's checkpoint file; the simulated publication store is a file only the parent ever writes (children structurally never receive its path), asserted unchanged after every phase.

| Requirement | Result | Evidence |
| --- | --- | --- |
| Candidate mutates inventory/location/time/RNG/output, then is discarded → baseline checkpoint byte-identical on re-capture, transcript unchanged, continuation equal to a never-candidated control | **Demonstrated** (A15) | isolation: discarded candidates… |
| Two sequential candidates from the same checkpoint (shared-memory / global-RNG / shared-Glk detection) | **Demonstrated** | same test, candidate 2 |
| Kill during bootstrap (before ready signal) | **Demonstrated** — child exits nonzero; baseline untouched | isolation: killing a candidate… |
| Kill while idle at the restored boundary | **Demonstrated** | same test |
| Kill during the serialization phase (test-only busy-stall inside the serialize op) — no checkpoint file written | **Demonstrated** | same test |
| Kill after a mutation was dispatched, before the parent reads the candidate transcript (simulated pre-publication; timing-based kill ~120 ms after dispatch) — the parent never reads the candidate's step output, so nothing can be published | **Demonstrated** | same test |
| Nonrecursive infinite loop, fresh child, parent-enforced deadline → killed, reaped (exit observed), nonzero | **Demonstrated** (G1-A additionally proves worker-thread preemption for in-process cases) | isolation: unbounded candidate… |
| Output limit stops a chatty candidate, exit 3 | **Demonstrated** | isolation: output limit… |
| Wrong story / wrong runtime / corrupt / truncated / digest-liar / bad-boundary / non-JSON checkpoints → rejected in child, exit 2, stable codes, baseline re-capture byte-identical after every rejection | **Demonstrated** (A34) | isolation: malformed and hostile… |
| Timeout/incomplete runs exit nonzero, no surviving children (exit observed, never assumed) | **Demonstrated** (all kill/rejection paths assert exit) | throughout the isolation suite |

A28–A29 boundary note: these tests prove the **candidate-process half** (a killed or rejected candidate cannot affect the baseline, and pre-publication death publishes nothing). Durable commit/idempotent-receipt recovery — crash before checkpoint/head publication and crash after durable commit — belongs to #18/#21; the production requirements this probe records for them (the third one demonstrated by execution here) are: serialize and verify the full envelope before publishing any reference to it; publish head+receipt atomically after the envelope is durable; a rejected/killed candidate must leave the baseline fingerprint byte-identical (this probe's re-capture discipline is the pattern to reuse).

## 7. Bocfel 2.6 checkpoint-route investigation (independent reference; earns its own evidence)

Method: source inspection of the pinned tarball (extracted to a temp dir, never modified) plus scripted WSL2 runs against the same fixture. Source-verified behavior: `zread`/`zread_char` write an autosave (`do_save(SaveType::Autosave, SaveOpcode::Read/ReadChar)`) **at every input boundary** when the `autosave` option is enabled (env `BOCFEL_AUTOSAVE=1`, `BOCFEL_AUTOSAVE_DIRECTORY=…`); startup restores and continues from it (`process_instructions` → `Operation::Restore(saveopcode)`) unless `skip_autorestore`; `@quit` renames the autosave to `.bak`; the `Rand` chunk is restored when present (stack.cpp:977) but only written in predictable mode (G1-A §5).

| Case | Result | Evidence |
| --- | --- | --- |
| Line boundary: drive prefix → **SIGKILL** mid-session (stdin held open; no `@quit`) → fresh process auto-restores → identical input suffix | **Demonstrated** — marker/turn sequence and seeded draws (5, 4) exactly match an uninterrupted reference run; "Continuing last session from autosave" observed | WSL scripted runs, 2026-10-23; transcripts in `/tmp/g1b-bocfel/{runA,runB,runRef}.out` (session-temporary, commands reproduced below) |
| Seeded RNG continuation across restore | **Demonstrated** (Rand chunk present in predictable-mode autosave) | same runs: prefix `seed 42`+`roll`, suffix `roll roll` matches reference |
| Unseeded RNG continuation | **Blocked** — no Rand chunk in random mode; restored draws are fresh entropy (observed 3,5 vs reference 6,6; restore itself works) | same runs; consistent with G1-A §5 |
| Character boundary (menu pending → kill → restore → key `b`) | **FAILED** — reproducible interpreter error `[Save file error: invalid Args size for 1: 0]` during the char-boundary autosave restore; Bocfel falls back to a fresh start, so the delivered key reaches a line prompt ("That's not a verb I recognise") | repro: `BOCFEL_AUTOSAVE=1`, prefix `menu`, kill at a held-open stdin, restore, deliver `b`; 2/2 attempts |
| Upper window / status state across restore | **Not saved** (man page: history replays lower window only; upper window likely incorrect after autorestore) | bocfel.6 "Autosaving" section |
| Timed input / sound / graphics | Not claimed by Bocfel's route; out of scope | — |

Reproduce (Git Bash + WSL2, fixture path substituted):

```sh
wsl.exe -e sh -c 'export BOCFEL_AUTOSAVE=1 BOCFEL_AUTOSAVE_DIRECTORY=/tmp/g1b &&
  mkfifo /tmp/g1b/in && "$HOME/.local/bin/bocfel" -C -m /mnt/…/fixture.z5 < /tmp/g1b/in > a.out 2>&1 &
  PID=$!; exec 3>/tmp/g1b/in; printf "look\nnorth\nseed 42\nroll\n" >&3; sleep 1.5;
  kill -9 $PID; exec 3>&-;   # destroy mid-session: the boundary autosave survives
  …repeat with suffix input in a fresh process; compare marker sequences…'
```

Per Issue #11's review-set rule, Bocfel's line-boundary success does **not** qualify it as a checkpoint candidate while its char-boundary route fails and its random-mode RNG is unserialized; equally, ifvms's GO here does not derive from Bocfel's gaps — each candidate earned its own evidence.

## 8. G1-A regression status (incl. one defect found and fixed)

| Suite | Result before probe work | Result after probe work |
| --- | --- | --- |
| `tests/fixtures/zmachine` (worktree) | 3 tests / 2 pass / 1 skip (pinned compiler absent) | unchanged (fixture bytes untouched) |
| `experiments/vm-io` | **57 tests / 56 pass / 1 skip / 1 fail — deterministic (5/5 runs)** | 57 tests / 56 pass / 1 skip / **0 fail (3 consecutive runs)** |

The pre-existing failure was a genuine G1-A harness defect, found because this machine has WSL bocfel (CI skips those tests): `negative.test.js clearTampered()` recursively deletes `results/tmp-negative/` — which was also the evidence-lock directory — so deleting a held lock let a second writer tear `results/probe-bocfel.jsonl` mid-record (observed: run object truncated at `"start`, step records merged, tail fragment at EOF). Fixed in an isolated commit (`962e873`): locks moved to `os.tmpdir()/zirp-vm-io-evidence-locks` with a three-test regression suite (`tests/evidence-lock.test.js`) that failed pre-fix and passes post-fix. A second isolated commit (`416b248`) adds the additive `__g1bInternals()` adapter accessor the checkpoint code reuses (behavior unchanged; exercised end-to-end by this suite). Both probe-suite runs regenerate `results/probe-*.jsonl`; regenerated copies were restored — committed evidence bytes are unchanged.

## 9. Acceptance mapping

| Row | Requirement (verbatim intent) | Status here |
| --- | --- | --- |
| A15 | Speculative native attempt rejected before commit; candidate discarded completely including RNG, output, pending input | **Demonstrated** (candidate layer): discard + kills + byte-identical baseline recapture + control-equal continuation (`isolation.test.js`) |
| A16 | VM waiting for a character/menu response; correct input path; no line injected into read_char | **Demonstrated**: char-boundary capture/restore + kind-correct re-issued request; wrong-boundary delivery semantics remain G1-A adapter behavior (mismatch logged, first-char parity) |
| A28 | Crash before checkpoint/head publication → no live change; orphan candidate recoverable/collectable | **Candidate-process evidence only**: pre-publication kill + bootstrap/serialization kills leave baseline untouched. Durable-store orphan collection/receipt recovery is #18/#21; production requirements documented in §6 |
| A29 | Crash after durable commit before response → retry returns saved receipt without replay | **Not in scope** — no durable store exists in this probe. Production requirement recorded in §6 (envelope durable before head publication; idempotent retry returns the receipt) |
| A31 | Combined restore at line and character prompts: memory/frames/continuation/I/O/RNG match expected checkpoint | **Demonstrated** for the native half (memory/frames/continuation/I-O/RNG) at both boundaries with fingerprint + transcript equality. Overlay/policy halves are #14+ (no combined world exists in this probe) |
| A34 | Checkpoint with wrong story/runtime/schema or corrupt → import/restore fails without modifying the active session | **Demonstrated**: seven hostile variants rejected in fresh children — six with stable `E_*` codes plus one VM-level rejection (corrupt Quetzal surfaces the interpreter's own parse error, still exit 2); VM-level `IFhd` gate behind the envelope; baseline byte-identical after every rejection |

Not claimed: combined-world persistence, Android/host support, live ChatGPT integration, production DB atomicity, conformance beyond the tested surface (glksim is an 80×24 headless shim; cross-interpreter byte-identity is explicitly not an expectation).

## 10. Recommendation (proposed evidence — not an owner decision)

**GO (conditional) for ifvms.js ZVM as the G1-B-proven candidate**, with this minimum adapter contract, all at the experimental layer:

1. Capture at supported boundaries only: pending line, pending character, halted. Reject capture elsewhere (not at a boundary → explicit error).
2. Envelope v1 as implemented: data-only, versioned, identity-bound (story digest + runtime revision), digest-verified, capability-declaring; validate fully before constructing any interpreter; a second VM-level identity gate (Quetzal `IFhd`) behind the envelope check.
3. Restore into a fresh process using only the checkpoint, the pinned story bytes, and static configuration; re-apply interpreter-owned header state, RNG (post-`update_header`), pending request, transcript, and watermark; sync halt semantics through one shared predicate.
4. Candidate execution in parent-enforced killable child processes with deadlines, output limits, nonzero exits, and observed reaping; speculative output never published.
5. Declared-unsupported surface carried in the envelope capabilities: timed input, sound, graphics, Glk file streams, undo history, interpreter number/version fields; unseeded-RNG cross-process reproducibility blocked by design (seeded mode is the deterministic path).

Conditions/caveats: (a) Bocfel 2.6's autosave route is not a substitute (char-boundary restore fails; random-mode RNG unserialized) but remains the independent I/O reference; (b) the vendored ZVM's quirks this probe compensated for — in-place story-buffer mutation, `update_header()` recomputation, stale in-buffer `sp` slot, no header-length validation (G1-A) — are exactly the kind of boundaries a production adapter must own at the adapter layer, never inside a modified vendor tree; (c) upstream's sequential-predictability RNG mode is deliberately unimplemented in the vendored revision — if a downstream consumer ever needs it, that is a new evidence gate; (d) production adoption still requires the #18/#21 durable-store half and the D39 decision-record acceptance.

Decision-register entry D39 records this as a proposed, evidence-gated recommendation in its own commit, per Issue #12's deliverable and the register's "G1 evidence decisions remain open" slot.
