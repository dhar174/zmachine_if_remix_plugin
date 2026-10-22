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
present. `BOCFEL_COMMAND` (argv containing `@STORY@`) overrides everything.

## Tests

```
node --test                        # from experiments/vm-io (this suite)
node --test                        # from the repository root (full suite,
                                   # includes tests/fixtures/zmachine integrity)
```

Bocfel integration and negative tests skip with an explicit reason when the
interpreter binary is not resolvable. No test is ever reported as passing
without having run.
