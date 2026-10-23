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

`node --test` executes test **files** concurrently. Suites that touch the
canonical evidence files (`results/probe-*.jsonl`) — the integration tests
and the failure-injection tests — serialize access with
`tests/evidence-lock.js` (exclusive lock files under `results/tmp-negative/`,
stale locks stolen after 10 minutes). Probe CLI children are serialized
because their parent holds the lock. Any new suite that touches probe
evidence files must acquire the lock too.

Note that from the repository root, `node --test` discovers test files by
walking the tree and does **not** honor `.gitignore`; untracked scratch
directories containing test files are picked up as well. Running the suite
from `experiments/vm-io/` and from `tests/fixtures/zmachine/` is the precise
form.

Bocfel integration and negative tests skip with an explicit reason when the
interpreter binary is not resolvable. No test is ever reported as passing
without having run.
