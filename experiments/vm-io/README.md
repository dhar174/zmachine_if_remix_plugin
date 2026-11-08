# G1-A native I/O probe harness (`experiments/vm-io/`)

Experimental probe code for Issue #11 (G1-A). This is **not a production
adapter** and nothing here is frozen as a product contract. Everything in
this directory exists to gather reproducible, honestly-labeled evidence about
native Z-machine interpreter I/O.

## Layout

| Path | Purpose |
| --- | --- |
| `probe.js` | Runs the fixed experimental sequence against an adapter, records JSONL evidence into `results/` |
| `adapters/ifvms-adapter.js` | Runs the vendored ifvms.js ZVM in-process under Node behind a headless Glk shim |
| `adapters/bocfel-adapter.js` | Drives the Bocfel non-Glk interpreter as a child process over stdin/stdout |
| `glksim.js` | Minimal headless Glk implementation used by the ifvms adapter (implements only the surface the vendored ZVM calls) |
| `vendor/ifvms/` | ifvms.js source at a pinned revision (MIT; LICENSE preserved) |
| `results/` | Committed JSONL evidence runs (raw output bytes preserved) |
| `smoke-ifvms.js` | Quick diagnostic driver (not evidence) |
| `tests/` | Harness boundary tests, per-adapter integration tests, negative tests |

## Runtimes under comparison

| Candidate | Revision | Integration |
| --- | --- | --- |
| ifvms.js ZVM | master `6ac63e6b61144d4353a168df16c4ad5c22526f88` (2025-07-12); last npm release `ifvms@1.1.6` (2021) | in-process, vendored `src/` (zero dependencies), MIT |
| Bocfel | 2.6 (2026-09-06), tarball sha1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da` | child process, non-Glk build, MIT (not redistributed) |

## Running the probes

```
cd experiments/vm-io
node probe.js ifvms      # writes results/probe-ifvms.jsonl
node probe.js bocfel     # writes results/probe-bocfel.jsonl
```

The sequence and the fixture are identical for every adapter; the raw output
bytes are recorded verbatim.

**Exit status:** the CLI exits 0 only when the run completed cleanly (final
status `halted`, no step errors). A failed or incomplete run prints
`probe failed: <adapter> final_status=... step_errors=...` and exits 1 — the
JSONL evidence of the failed run is still written, since it is the record of
what happened. A usage error also exits 1.

## Building Bocfel (one-time, per machine)

Bocfel ships no prebuilt Windows binaries. The probe uses the **non-Glk
build** (plain stdio — Bocfel's intended scripted-testing mode) and, by
default, launches it through WSL2:

```
# in WSL2 (Ubuntu)
curl -O https://cspiegel.github.io/bocfel/downloads/bocfel-2.6.tar.gz
# verify: sha1sum == 319770fc5c50c4824d1b6edea1e9ce2ba0d196da
tar xzf bocfel-2.6.tar.gz && cd bocfel-2.6
make                      # non-Glk; requires a C++17 compiler
cp bocfel ~/.local/bin/bocfel
```

Evidence produced through WSL2 is labeled WSL2-only. A native Windows build
(MSYS2 MinGW-w64: `make PLATFORM=win32`) placed at
`experiments/vm-io/tools/bocfel/bocfel.exe` is preferred automatically when
present. `BOCFEL_COMMAND` (argv containing `@STORY@`) overrides everything;
note that `@STORY@` is substituted with the WSL `/mnt/<drive>/...` path form,
so a native-Windows override command would receive that path (the native
build's own auto-detection needs no override).

**Availability follows the resolved launch configuration**: a configured
`BOCFEL_COMMAND` or a native build at the documented tools path is recognized
by presence (never executed by the availability probe — a misconfiguration
surfaces as a recorded adapter error when the real launch runs); the WSL2
default is probed by running `bocfel -v` through `wsl.exe`. The launch
resolution and availability logic are unit-tested in
`tests/bocfel-launch.test.js` without depending on which interpreter a
machine actually has.

## Bounded execution

Every potentially nonterminating case is bounded by wall time. **No
instruction budget exists on any path**, and neither mechanism is a security
sandbox — that is a documented limitation, not an oversight.

- **ifvms (in-process):** cases that may not terminate run in a killable
  worker thread (`tests/worker-runner.js`). The parent enforces a deadline
  and calls `worker.terminate()`, which preempts even a busy synchronous
  Z-code loop — something no in-process test-runner timeout can do. The
  `negative/spinloop` fixture (a nonrecursive `while(1)` loop) proves the
  preemption.
- **Bocfel (child process):** every `start()`/`send()` is bounded by a
  per-step watchdog (`stepTimeoutMs`, default 10000 ms). A timed-out turn is
  classified as an `error`, the child is terminated (`terminateChild`, with
  `SIGKILL` escalation after 2 s) and reaped, so the stale pre-turn prompt
  can never be mistaken for a fresh input boundary. Platform note: on the
  WSL2 path this terminates `wsl.exe` itself; a Linux-side bocfel grandchild
  may linger until the WSL session is torn down (recorded limitation).

## Tests

```
node --test                        # from experiments/vm-io (this suite)
node --test                        # from the repository root (full suite,
                                   # includes tests/fixtures/zmachine integrity)
```

The suites cover: per-candidate integration (the acceptance-mapping
sequence), harness boundary/reconciliation tests, negative tests with bounded
execution, Bocfel launch-resolution/availability tests, and probe
failure-injection tests.

For the ifvms malformed-story and runaway-story negative tests, the test
harness captures the single expected `console.log` error and checks its type,
message and agreement with the adapter's recorded error. Unexpected or extra
logs are forwarded and fail the check; other output and the interpreter are
unchanged. The runaway worker uses the same check without changing the
watchdog used for a nonterminating story.

`node --test` executes test **files** concurrently. Suites that touch the
canonical evidence files (`results/probe-*.jsonl`) — the integration tests
and the failure-injection tests — serialize access with
`tests/evidence-lock.js` (exclusive lock files under the OS temp dir
`os.tmpdir()/zirp-vm-io-evidence-locks`, deliberately outside
`results/tmp-negative/`, which negative tests delete recursively). These
**outer locks own save/run/read/restore cycles**. They carry an unpredictable
owner token/PID and file identity; reads/restores assert the lease is active
and still owned, and release refuses to unlink a replacement. Failure tests
preserve only the adapter whose lock they hold. CLI children participate in
this longer cycle only when their test parent holds the outer lock. Any new
suite that touches canonical evidence must acquire it too.

### Evidence publication ownership (#50)

Every `runSequence()` and CLI publication additionally uses
`evidence-writer.js`, regardless of outer-lock use. A nonblocking, per-target
`<target>.publish.lock/` directory owns the final publication critical section;
its `owner.json` records a random token and diagnostic PID. Overlap fails with
`E_EVIDENCE_CONFLICT` and CLI exit 1. Distinct adapter targets are independent;
non-overlapping publishers can sequentially replace the complete report.

The writer opens `<target>.<pid>.<random-token>.tmp` exclusively (`wx`), handles
short writes of the complete UTF-8 buffer, closes it, rechecks guard and stage
ownership, then performs one same-directory rename. It never truncates a peer
stage, unlinks the canonical target first, or falls back to copying over it.
The JSONL schema/order, raw output and complete incomplete-run reports remain
unchanged. The CLI still has only the fixed adapter paths; test-only publisher
factories supply isolated filesystem operations and acknowledged barriers.

Handled pre-rename failures keep canonical bytes unchanged and remove owned
artifacts. Cleanup errors remain failures. After successful rename, a cleanup
or ownership failure reports `published=true` and exits nonzero; it does not
roll back the visible complete report. Windows open readers may deny rename
(`EPERM`/`EACCES`); the sharing-refusal regression verifies failure with the old
complete report intact. Coordinated reads before/after successful rename see
the complete old/new JSONL, not an in-place rewrite.

Neither lock is stolen by age or PID heuristics. An unsupervised crash may
leave a guard/stage (or outer lock); the next publisher fails closed, and an
outer acquisition eventually times out. **Deliberate recovery:** stop new
probe/test writers; inspect the exact adapter target and owner token; establish
that its process and pipes are finished; inspect canonical/stage bytes and
preserve needed evidence; remove only the verified dead owner's artifacts,
then retry. A PID or old timestamp alone is not recovery authority. The
interruption tests perform this cleanup only after observing child exit and
final pipe closure, and verify directory inventories before deleting scratch.

Guard/lease checks detect tested deletion/replacement at acknowledged barriers.
They do not defend against arbitrary same-user filesystem interference during
the final check/rename or check/unlink interval, nor provide an OS sandbox.
Reader visibility is qualified only by the reported local/hosted runs; it is
separate from fsync, OS crash/power-loss durability and durable receipt recovery. No
fsync or production persistence implementation is added; #18/#21 own that work.

Focused reproduction from the repository root:

```
node --test --test-reporter=tap experiments/vm-io/tests/evidence-writer.test.js experiments/vm-io/tests/evidence-lock.test.js experiments/vm-io/tests/probe-failure.test.js
```

See the [#50 acceptance mapping](../../docs/evidence/g1-native-io.md#8-issue-50-evidence-writer-qualification)
for exact source identities, local counts, interruption outcomes and retained
limits. Hosted checks and the independent verdict are separate PR/issue gates.

Note that from the repository root, `node --test` discovers test files by
walking the tree and does **not** honor `.gitignore`; untracked scratch
directories containing test files are picked up as well. Running the suite
from `experiments/vm-io/` and from `tests/fixtures/zmachine/` is the precise
form.

Bocfel integration and negative tests skip with an explicit reason when the
interpreter binary is not resolvable. No test is ever reported as passing
without having run.
