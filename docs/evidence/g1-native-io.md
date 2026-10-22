# G1-A evidence: native fixture and interpreter I/O probe

**Issue:** [#11](https://github.com/dhar174/zmachine_if_remix_plugin/issues/11) under #4 (G1 Technical Feasibility). **Probe brief:** `docs/superpowers/plans/2026-10-22-g1-a-native-io-probe.md`. **Status:** executed 2026-10-22; draft PR pending independent review. This document records measured evidence; it does not select a production runtime (that decision follows #12 recovery results per the roadmap).

## 1. Executive findings

A viable native-I/O execution baseline **was established**: two independently implemented Z-machine interpreters — ifvms.js/ZVM (JavaScript, in-process under Node) and Bocfel 2.6 (C++, non-Glk child process) — both executed the same purpose-built redistributable v5 fixture faithfully through line input, a genuine `read_char` character-input menu, failed-action turn advancement, a scheduled turn-based event, seeded-RNG determinism, duplicate-name disambiguation, a locked gate, and a cleanly observable terminal state, reaching a clean halt through the authored quit path.

Load-bearing conclusions:

- **Input boundaries are distinguishable in both candidates**, but by different mechanisms: ifvms.js distinguishes line vs character at its Glk API surface; Bocfel's non-Glk build conflates them at the byte-stream level (one newline-terminated stdin line per input request either way), so the boundary must be established by fixture-driven protocol correlation. This is a real difference a future adapter must design for (turn-resolution §4 P5).
- **RNG**: both implement Z-spec predictable mode (`random` with a negative operand). Seeded draws are reproducible *within* each interpreter; the sequences differ *between* interpreters (1,1,4 vs 1,5,4 from seed 42), which the standard permits. Cross-interpreter sequence identity must never be an expectation.
- **Failed-action time semantics** (A14): a recognized-but-failed action (`TAKE` of scenery) consumed exactly one turn and fired the scheduled event at turn 3, identically in both interpreters.
- **Robustness gap found in ifvms.js**: it crashes (`RangeError`) on `get_prop_addr` with an out-of-range object number — exercised accidentally via the library's routine-daemon path before the fixture was changed to an object daemon. Bocfel's behavior for that same input was **not** tested (source-level analysis only).
- **Validation gap found in ifvms.js**: it tolerates an inconsistent header file-length field (0xFFFF) and loads the story normally. Bocfel rejects the same file (exit 1).
- **Neither candidate supports timed input** on the paths exercised (source-verified for both; consistent with runtime observation). G1-B/#12 owns checkpoint/restore correctness; nothing here claims recoverability.

Per the evidence-layer discipline (team-coordination §8.7): everything in §4–§5 is **adapter-integration + local host-device evidence** (executed on one Windows machine, Bocfel via WSL2). A10/A13/A14/A16/A19/A23 are addressed as **precursor evidence only** — the engine artifacts those cases presuppose (receipts, stable IDs, commit semantics, read-only projection) do not exist at this layer. A15 and A31 are deferred to #12 and were not approached.

## 2. Test environment

| Item | Value |
| --- | --- |
| Host OS | Windows (win32), build 10.0.26340, x64 |
| Node.js | v24.13.0 (npm 11.12.1) |
| Fixture | `tests/fixtures/zmachine/fixture.z5`, 88,576 bytes, SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b` |
| Fixture compiler | Inform 6.44 for Windows (2025-09-11), zip SHA-256 `70900ea74795e8b7cccc39f7666cf9e26112dfda71845c99b569f79fd1f8ebc3`; Inform 6 Library 6.12.8 (GitLab tag `6.12.8`) |
| Fixture reproducibility | recompilation byte-identical (verified twice); enforced by `tests/fixtures/zmachine/fixture-integrity.test.js` |
| Candidate 1 | ifvms.js ZVM, master `6ac63e6b61144d4353a168df16c4ad5c22526f88` (2025-07-12), vendored at `experiments/vm-io/vendor/ifvms/` (MIT; last npm release `ifvms@1.1.6`, 2021-02-11) |
| Candidate 2 | Bocfel 2.6 (2026-09-06), non-Glk build, tarball SHA-1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da`, built in WSL2 Ubuntu 22.04 (gcc 11.4.0), launched via `wsl.exe` (`-C -m`, `TERM=dumb` set inside WSL) |
| Harness | `experiments/vm-io/` (Node, zero npm dependencies, `node:test`) |
| Evidence runs | `experiments/vm-io/results/probe-ifvms.jsonl`, `probe-bocfel.jsonl` (raw output bytes preserved) |

Platform honesty: the ifvms evidence is native Windows; **all Bocfel evidence is WSL2-only** and must not be reported as native-Windows behavior. No mobile or hosted claims of any kind are made.

## 3. Interpreter comparison

Evidence labels: **[E]** verified experimentally here; **[S]** supported by inspected source/documentation at the pinned revision; **[U]** unknown/untested; **[X]** unsupported/failed.

| Category | ifvms.js ZVM | Bocfel 2.6 (non-Glk) |
| --- | --- | --- |
| 1. Z5 execution | [E] Full fixture runs to clean halt. [S] v3/4/5/8 only; no v6/v7 | [E] Full fixture runs to clean halt. [S] v1–5, 7, 8; limited v6 |
| 2. Input boundary fidelity | [E] Line and char are distinct API events (`glk_request_line_event_uni` vs `glk_request_char_event_uni`); wrong-boundary delivery detectable and loggable | [E] Not distinguishable on the wire; both read one `\n`-terminated line; `read_char` uses the line's first character. [S] no echo under pipe; flush before every read |
| 3. Output capture fidelity | [E] Synchronous, ordered capture via Glk shim; status line captured separately (upper window) | [E] Plain stdout; [S] status line never rendered in non-Glk builds; upper-window text would interleave if used (fixture avoids it) |
| 4. Startup behavior | [E] `vm.init()` runs story code synchronously to the first input request; startup side effects observable before first prompt | [E] Process start → story runs → first prompt; output flushed before first read |
| 5. Timer / failed-action behavior | [E] Failed action consumed one turn; daemon event fired at turn 3. [X] timed input unsupported (header bit cleared) | [E] Identical turn/daemon behavior. [X] timed input unavailable in non-Glk builds (capability bit never set) |
| 6. RNG observability | [E] Z-spec predictable mode; within-interpreter reproducibility verified (1,1,4 twice). [S] xorshift state on `vm.xorshift_seed`; unseeded mode uses `Math.random` | [E] Same spec mode; reproducible (1,5,4 twice); cross-interpreter sequences differ (permitted). [S] Xorshift32; `-z seed` CLI flag; `Rand` chunk in autosaves (predictable mode only) |
| 7. State inspection | [E] In-process fields readable (`pc`, `ram`, `frames`, `globals`, `xorshift_seed`) — undocumented internals, pinned revision. [X] crashes on `get_prop_addr` with out-of-range object number | [U] No internal inspection from outside; [S] `/debug` meta commands exist (disabled by `-m` in probe); no opcode tracing |
| 8. Checkpoint integration potential | [S] Quetzal save/restore + autosave snapshot incl. `read_data` and RNG seed; saving tables unsupported; no public full-snapshot API. Correctness untested (out of scope) | [S] Quetzal (+ `Bfhs` history chunk), `/ps` in-memory checkpoints, autosave incl. `Rand` chunk. Correctness untested (out of scope) |
| 9. Isolation & resource control | [E] Runaway recursion bounded by preallocated stack (`RangeError`, classified). [U] no instruction budget; in-process runs share the Node heap | [E] Runaway recursion → clean nonzero exit (classified). [S] OS process isolation; per-run fresh child |
| 10. Licensing / maintenance / deployment | [S] MIT; maintainer-active (master 2025-07) but slow release cadence (npm 2021); single-maintainer bus factor | [S] MIT (since 2.2.3); released 2026-09; Gargoyle-bundled; no prebuilt Windows binaries — build required (WSL2/MSYS2) |

[S] sources: the pinned ifvms.js revision and Bocfel 2.6 tarball were inspected during candidate research (records retained in the PR branch history); nothing in this table reports source reading as runtime behavior except where also marked [E].

## 4. Experimental results

Harness: `node probe.js ifvms` / `node probe.js bocfel` run the identical 30-step sequence (`experiments/vm-io/probe.js`) over the identical fixture; JSONL records preserve raw output. Full transcripts are in the committed `results/*.jsonl`; the findings below summarize.

- **Startup (F01/A10 precursor):** `[F01:startup=7]` is printed by the fixture's `Initialise` before the banner and before the first `>` prompt in both interpreters; the value is a real state change (re-printed by the meta `MARKERS` verb).
- **Ordinary commands (F02–F04/A13 precursor):** `LOOK`, `INVENTORY` (empty → carrying the key), and `north`/`south` produce location markers (`[LOC:chamber|gallery|vault]`) and state changes in both.
- **Failed action (F05/A14 precursor):** `take panel` fails in fiction ("The stone panel is hardly portable.") and the daemon turn marker advances 2→3 in both interpreters; the scheduled `[F06:event=chime]` fires exactly at turn 3 (F06). The turn-marker timelines are identical across both candidates.
- **Character menu (F07/A16 precursor):** `menu` surfaces as a **character-input boundary** in both (ifvms: `waiting_for_character_input` from the char-event request; Bocfel: protocol correlation on `[F07:menu-open]` because the wire cannot distinguish). A single key `b` arrives as ZSCII 98 → `[F07:menu-choice=beta]`.
- **RNG (F08):** `SEED 42` then three rolls reproduce exactly within each interpreter (ifvms 1,1,4; Bocfel 1,5,4); a second `SEED 42` pass reproduces the same per-interpreter sequence. Sequences differ across interpreters, as the standard permits.
- **Duplicate names (F09/A19 precursor):** `examine token` triggers the library disambiguation prompt ("Which do you mean, the brass token or the brass token?"); answers resolve to **distinct object numbers (33 vs 32)** — identical in both interpreters (same compiler).
- **Gate / anchor / terminal (F10/F11/F12):** `unlock vault door with brass key` → `[F10:door-unlocked]`; `open vault door` → `[F10:door-opened]`; the pedestal carries `[F11:anchor=pedestal]`; `put brass key on pedestal` → `[F12:terminal=victory]`, the library end sequence ("*** You have won ***", score, "Would you like to RESTART, RESTORE a saved game or QUIT?"), and — after the authored `quit`/`y` — a **clean halt in both**.
- **Negative cases (task §6):** empty binary, truncated header, truncated valid fixture, unsupported version byte (9, 0), inconsistent header file length, invalid command input, wrong-boundary input in both directions, and runaway recursion (loopstory) — all bounded (explicit timeouts; no host hang) and classified. Notable observations:
  - ifvms classifies version 9 as "This is not a Z-Code file" (its `identify` rejects before the VM's own version check).
  - ifvms's empty-buffer error is a raw `RangeError` (message-quality gap), while an empty file given to Bocfel exits nonzero cleanly.
  - **Header-length validation differs**: Bocfel rejects a 0xFFFF length field (exit 1); ifvms loads and runs the same file (validation gap — relevant to #12's wrong-checkpoint injection cases).
  - Parser rejection of `xyzzy frobnicate` consumes **no turn** in either interpreter (daemon marker absent) — D05 precursor evidence that rejection is not failure-in-fiction.
  - Runaway recursion terminates in both (ifvms: classified error from the preallocated stack; Bocfel: nonzero exit).

Test suite: `node --test` (repository root) — **39 tests, 39 passed, 0 failed, 0 skipped** on this machine (Node v24.13.0, Windows x64), covering fixture integrity (digest + byte-identical rebuild), boundary classification and wrong-boundary behavior, the full acceptance-mapping sequence per candidate, and the negative cases. Bocfel suites skip with an explicit reason when the interpreter binary is not resolvable (documented platform limitation; no test is ever reported as passing without having run).

## 5. Compatibility and limitations

- **Unsupported I/O features:** timed input is unsupported by both candidates on the exercised paths (ifvms: TODO + header bit cleared, source-verified; Bocfel non-Glk: capability bit never set, source-verified). Sound/graphics are out of the fixture's scope (ifvms: no sound support, source-verified; Bocfel non-Glk: sound Glk-only, source-verified).
- **Unknown native-state semantics:** the probe observes behavior through fixture markers and (for ifvms) undocumented internal fields pinned to the vendored revision; it does not establish the meaning of arbitrary story globals — that remains the adapter/capability work of later gates.
- **Portability:** Bocfel evidence is WSL2-only here (no prebuilt Windows binaries exist; MSYS2 MinGW is the documented native path but was not exercised). ifvms evidence is native Windows. Nothing here supports claims about macOS, mobile, or hosted environments.
- **Checkpoint uncertainties (deferred to #12, not tested here):** ifvms exposes no public full-snapshot API; its autosave path requires a Dialog implementation and rebinds pending line buffers. Bocfel's Quetzal saves exclude RNG state in random mode (the `Rand` chunk appears only in predictable-mode autosaves); non-Glk autosave requires a platform. Quetzal alone is not a complete application checkpoint (state-and-vm-bridge §2).
- **Runtime licensing:** both candidates are MIT. The Bocfel non-Glk build pulls no Gargoyle code; binaries are not redistributed (documented pinned download + digest). ifvms.js is vendored with its MIT LICENSE preserved. The fixture and library are covered by `tests/fixtures/zmachine/README.md`.
- **Upstream defects / robustness findings:** ifvms.js crashes on `get_prop_addr` with an out-of-range object number (hit via the Inform 6 Library 6.12.8 routine-daemon path; the fixture uses an object daemon instead — the routine-daemon path itself was not executed under Bocfel, so a cross-interpreter comparison of that behavior is [U]); ifvms.js does not validate the header file-length field; ifvms.js's empty-buffer error surfaces as a raw RangeError rather than a classified message. None of these were reported upstream (out of scope for this issue).

## 6. Provisional recommendation

**Recommend ifvms.js ZVM (vendored at the pinned revision) as the primary candidate to investigate in Issue #12, with Bocfel 2.6 (non-Glk) retained as the independent reference implementation.**

Reasons: in-process integration under Node gives the probe (and a future MCP-backed service) structured access to input boundaries, RNG state, and VM internals without forking the interpreter; the Glk pause/resume contract is small and was implementable exactly as documented; MIT licensing permits vendoring; and the observed fixture behavior matched Bocfel's on every marker.

This recommendation is **conditional and provisional**. The roadmap and the probe brief require that runtime selection happens only after #12 demonstrates complete checkpoint/recovery at both input boundaries; reaching prompts and completing this sequence establishes nothing about recoverability. If #12 shows the autosave/snapshot path cannot capture pending input continuation plus RNG state reliably, the recommendation flips to Bocfel (whose autosave and in-memory checkpoint machinery is more mature), at the cost of process-boundary integration.

## 7. G1-B handoff (Issue #12)

- **Fixture identity:** `tests/fixtures/zmachine/fixture.z5`, SHA-256 `96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`, 88,576 bytes; source `fixture.inf` (Inform 6.44 + Library 6.12.8, pins and rebuild procedure in `tests/fixtures/zmachine/README.md`; rebuild is byte-identical).
- **Reproduction commands:** `node probe.js ifvms` / `node probe.js bocfel` from `experiments/vm-io/` (Bocfel build/install documented in `experiments/vm-io/README.md`); full suite via `node --test`.
- **Candidate revisions:** ifvms.js `6ac63e6b61144d4353a168df16c4ad5c22526f88` (vendored); Bocfel 2.6 (tarball SHA-1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da`).
- **Input-boundary observations:** ifvms — line/char are distinct request events; pending-input state is exposed as `read_data` (buffer, bufaddr, parseaddr, storer, routine/time) and is snapshotted by autosave. Bocfel — boundaries are not wire-distinguishable; a checkpoint must capture which input kind is pending from the story/VM state, not from the stream.
- **RNG/time behavior:** Z-spec predictable mode verified in both; per-interpreter RNG state lives in `vm.xorshift_seed` (ifvms) and the Xorshift32 state (Bocfel, `Rand` chunk in predictable-mode autosaves only); turn timing is daemon/library-driven and identical across candidates (turn-marker timeline in both evidence files).
- **State fields requiring checkpoint coverage (from source inspection; correctness untested):** ifvms — dynamic RAM (`ram` vs `origram`), `pc`, call frames/stack, `read_data` pending-input continuation, `xorshift_seed`, window/IO state (main/upper window, streams, transcript caches), undo buffer; Bocfel — Quetzal memory/stacks, pending read continuation, RNG mode+state (predictable mode), interpreter options/env, autosave `glk`/screen state.
- **Known obstacles to reliable restoration:** ifvms has no public snapshot API (autosave requires a Dialog; internals are undocumented and pinned); ifvms header-length non-validation weakens wrong-checkpoint rejection (must be compensated at the adapter layer); Bocfel random-mode RNG state is not serialized; Bocfel non-Glk autosave is platform-dependent; Quetzal alone does not cover pending-input continuation at character boundaries.

Per the probe brief: **advance to #12 only because the fixture and the input boundary are reproducible** — runtime acceptance remains blocked until #12 independently proves recovery.
