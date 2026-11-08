# Bocfel 2.6 autosave reference (#51)

Independent, fixture-scoped reference experiment. Python 3.11+ standard library;
no ifvms adapter, checkpoint runner, production integration or global install.
The [qualification record](../../docs/evidence/bocfel-autosave-2026-11-08/README.md)
maps acceptance and retains representative raw evidence. The full CI artifact
contains all autosaves and build logs, including failure artifacts.

## Reproduce on Ubuntu or WSL

Prerequisites: Python 3.11+, g++, make, ncurses development headers/library.
The prerequisite check recognizes the Ubuntu/WSL `/usr/include` header layout.
The dedicated CI job provisions `g++ make libncurses-dev`; this harness installs
nothing. From the repository root, use a new output directory on every run:

```sh
python3 -m unittest discover -s experiments/bocfel-autosave/tests -v
curl --fail --location --output /tmp/bocfel-2.6.tar.gz https://cspiegel.github.io/bocfel/downloads/bocfel-2.6.tar.gz
python3 experiments/bocfel-autosave/reproduce.py --archive /tmp/bocfel-2.6.tar.gz --out /tmp/bocfel-reference-51 --require-reference
python3 experiments/bocfel-autosave/reproduce.py --verify-bundle /tmp/bocfel-reference-51
```

On Windows, run the same commands inside WSL (for example `wsl.exe -e python3
/mnt/d/projects/<checkout>/experiments/bocfel-autosave/reproduce.py ...`, using
Linux paths for every argument). Portable unit tests also run directly with
`python -m unittest discover -s experiments/bocfel-autosave/tests -v`.
Missing native prerequisites produce JSON `status:skipped`, exit 77; with
`--require-reference` they produce `status:failed`, exit 2. Neither is closure
evidence. Build, comparison, artifact or cleanup failures exit nonzero.

The [official archive](https://cspiegel.github.io/bocfel/downloads.html) is
verified **before extraction** against all three pins: 201,707 bytes; SHA-1
`319770fc5c50c4824d1b6edea1e9ce2ba0d196da`; SHA-256
`8541a1c59271f7977e81680e29d9be60d633311870f05bb579f317a6fb37c7b8`.
Only these verified bytes are extracted, in a fresh scratch directory. Source
hashes are checked again after build. No `local.mk` is accepted. The exact build
command is `make -j2 CXX=g++ PLATFORM=unix GLK= OPT=-O2 CXXFLAGS=-g`:
unmodified upstream Unix, non-Glk, curses enabled, runtime safety checks retained.
Compiler/make/OS/Python versions, full command/output, executable digest and
`bocfel -v` are retained. Executable hashes can differ across toolchains/paths.
The fresh executable is invoked by absolute path outside VM-I/O discovery;
existing Bocfel installations and ordinary suite availability are preserved.

## Process and boundary contract

Each trial has an independent uninterrupted control, candidate and restored
process. `Popen` directly invokes the owned executable with private pipes,
`-C -m`, open stdin and one recorded input at a time. The complete environment
allowlist is `PATH=/bin:/usr/bin` (platform `os.defpath`), isolated `HOME`,
`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `TERM=dumb`, `LANG=C.UTF-8`,
`LC_ALL=C.UTF-8`, `TZ=UTC`, plus runtime settings `BOCFEL_AUTOSAVE=1`, an isolated
`BOCFEL_AUTOSAVE_DIRECTORY`, `BOCFEL_SKIP_AUTORESTORE=0`,
`BOCFEL_AUTOSAVE_LIBRARYSTATE=0`, `BOCFEL_PERSISTENT_TRANSCRIPT=0`. No inherited
Bocfel overrides or credentials enter this environment. Processes retain the
host user's ordinary filesystem authority; this is trusted-fixture evidence,
not a sandbox or private-import guarantee.

A boundary requires new expected output and a complete bounded `FORM BFZS`:
exact FORM/chunk bounds, byte-exact FourCCs, IFhd story identity, memory decode,
stack-frame bounds, Args and optional predictable Rand. Each new input must
change the saved state digest; restore must create a new file generation. The
live candidate's prefix PC/Args/Rand/memory digest must match its independent
control. We preserve the autosave **before** restore can overwrite it. A failed
restore's new startup autosave cannot masquerade as the old character state.
The restore announcement follows history replay; it does not end in a fresh
prompt. Readiness never comes from a delay or file existence alone.

Boundary deadlines are 30 seconds; trial deadlines 120 seconds; owned-process
termination/pipe-drain deadlines 10 seconds. Retention caps are stdout 32 MiB,
stderr 64 KiB and autosave 32 MiB. Overflow, premature EOF, unexpected diagnostic,
nonzero clean completion, deadline or cleanup failure fails qualification.
Candidate termination records actual SIGKILL/return code -9, observed exit and
both pipe EOFs. Scratch removal requires every child reaped; otherwise it is
retained and the manifest fails. This does not establish descendant containment,
memory/CPU quotas, filesystem durability or production transaction recovery.

## Frozen matrix and comparison policy

Every case runs three times in fresh directories. `expectations.json` contains
one source-backed expectation per case, frozen after characterization. The
optional `--characterize` command collects observations with status
`characterized-not-qualified`; it never updates expectations or earns a pass.

| Case | Inputs and frozen result |
| --- | --- |
| Canonical seeded line | `look`, `north`, `seed 42`, `roll`; kill at next line boundary; restore; two `roll` inputs give `(5, 4)`, turns `(5, 6)`, byte-identical suffix. Args `00111e128f`, Rand `000000ad4528`. |
| Canonical zero-operand char | `menu`; Args `01`; restore reports `[Save file error: invalid Args size for 1: 0]`, fresh startup; `b` reaches line parser: `That's not a verb I recognise.` Clean eventual exit 0 is recorded separately from this failed restore. |
| Conforming char | Original builder `fixture.py`: random -42, `read_char 1`, input `b`; exact key `98`, seeded roll `1`, then halt. Args `010001`, Rand `00000000002a`; byte-identical suffix after restore. |
| Random mode | Canonical `look`, `north`, `roll`, no story seed; `-Z` fixed stream; no Rand. Uninterrupted suffix `(6, 1)`, restored `(1, 2)`, same turns `(4, 5)` but unequal exact suffix. |

Canonical fixture SHA-256:
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
Its menu bytes at `0x124ac` are `f6 ff 01`: **zero operands**, unlike the
required device operand 1 in the [read_char specification](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect15.html#read_char)
and [instruction encoding](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect04.html).
Canonical bytes and historical observations are preserved. This compatibility
failure is not evidence that conforming character restoration generally fails.
The separate original 2,048-byte Z5 control has release 51, serial 261108,
correct header/checksum and SHA-256
`d829351fe638fa7f6c18e54cda08a8bb766e05df3106ebfd7985c08115d7af91`.
No compiler or canonical rebuild is needed.

The synthetic entropy file is 1,024 native-endian uint32 words `0..1023`;
bytes/hash/native byte order are retained. `random.cpp` opens it on first startup,
reads one word per random-mode draw, and does not serialize that cursor or Rand
in random mode. The story/library consumes earlier words before the prefix
roll (5). Reopening in a fresh process restarts its cursor at word 0; continuation
then yields 1,2 rather than 6,1. This tests controlled input, not natural entropy.

Raw stdout/stderr remain byte-exact, including history replay and quit output.
Input events record byte payloads and output offsets. `suffix-cut`/`suffix-end`
events delimit post-input continuation; valid-char ends at actual EOF. Only that
specified suffix is compared, without whitespace trimming or diagnostic/RNG
filtering. Ordered markers are an additional check, not a replacement for bytes.
The canonical error is allowed exactly once in its negative case; other native
error/warning diagnostics fail. Full-save hashes identify artifacts; we compare
PC/Args/Rand/decoded memory as a prefix projection, not whole-VM equivalence.

## CI and evidence

[bocfel-reference-smoke.yml](../../.github/workflows/bocfel-reference-smoke.yml)
runs portable units on Windows/Ubuntu and the pinned source build/full repeated
matrix on Ubuntu with `--require-reference`. It uploads full manifests, raw
streams, input/termination events, autosaves and build logs on success or failure.
`--verify-bundle` verifies the exact file inventory/hashes, 12 distinct trials,
frozen observations, autosave summaries, native exits and pipe-close records.
Download and verify that bundle locally before restricted independent review.
The feature-branch push trigger supplies this artifact before PR publication.

This bounded reference does not select a runtime or adopt proposed D39. The
ifvms preference rests on its own independently passing checkpoint regressions.
Upper/status geometry, timed input, sound/graphics, arbitrary stories, natural
entropy reconstruction and production persistence remain unqualified here.
