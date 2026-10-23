# G1-A native I/O probe fixture (`fixture.z5`)

An **original, purpose-built, redistributable Z-machine v5 story** for the
G1-A feasibility probe (Issue #11, `docs/superpowers/plans/2026-10-22-g1-a-native-io-probe.md`).
It is a diagnostic fixture, not a production game: its job is to make
interpreter I/O and state behavior observable so the probe harness can record
structured evidence.

- Story file: `fixture.z5` (compiled, committed)
- Source: `fixture.inf` (Inform 6, standard library)
- Vendored library: `lib/` (Inform 6 Library 6.12.8)
- Digest manifest: `fixture.sha256`
- Consumer: `experiments/vm-io/` (probe harness)

## Redistribution rights

The fixture (`fixture.inf` and the compiled `fixture.z5`) was written for this
project and contains no third-party or user-supplied story content.
**Permission is explicitly granted to copy, redistribute, modify, and reuse
the fixture source and compiled story file for any purpose, without
restriction** (public-domain-equivalent grant by the project author).

The vendored files under `lib/` are the Inform 6 Library 6.12.8, copyright
Graham Nelson 1993-2004 and David Griffith 2012-2025, dual-licensed under the
traditional Inform licence and the Artistic License 2.0; the license texts are
vendored as `lib/ARTISTIC` and `lib/COPYING`. Redistribution of those files is
governed by those licenses.

The Inform 6 compiler is **not** redistributed here; it is downloaded at a
pinned version (below) and recorded by SHA-256.

## Fixture behaviors (F01-F12)

Probe assertions use the stable bracketed markers (`[Fxx:...]`), never prose.
Markers are printed to the main output stream in execution order.

| ID | Behavior | Marker / observable | Acceptance (precursor only) |
| --- | --- | --- | --- |
| F01 | Startup side effect before first input | `[F01:startup=7]` printed by `Initialise` before the banner; the value 7 is a real state change re-printed by `MARKERS` | A10, S06, D09 |
| F02 | Recognizable initial room and LOOK | `[LOC:chamber]` in the Probe Chamber description | A13 |
| F03 | INVENTORY and one movable item | `brass key`; description marker `[F03:item=brass-key]` | A13 |
| F04 | Valid movement between rooms | `north`/`south`; `[LOC:gallery]`, `[LOC:vault]` | A13 |
| F05 | Recognized unsuccessful action consuming a turn | `TAKE STONE PANEL` (scenery) fails but the daemon turn marker advances | A14 |
| F06 | Turn counter and scheduled event | `[F06:turn=N]` from the daemon every non-meta turn; `[F06:event=chime]` fires exactly at turn 3 | A14 |
| F07 | Character-input menu via `read_char` | `MENU`; `[F07:menu-open]`, then `[F07:menu-key=<zscii>]` and `[F07:menu-choice=...]` | A16 |
| F08 | Controlled random outcome | `ROLL` prints `[F08:roll=1..6]`; `SEED <n>` seeds predictable mode (`random(-n)`), `[F08:seed=<n>]` | D24 precursor |
| F09 | Two objects with identical display names | Two "brass token" objects in the gallery; identical short names and initial lines; `EXAMINE TOKEN` triggers parser disambiguation; descriptions carry `[F09:token-id=RED object#N]` / `[F09:token-id=BLUE object#M]`; `INSPECT TOKEN` prints the resolved object number via `[DIAG:inspect-object#N]` | A19 |
| F10 | Locked progression gate | `vault door` is locked; `UNLOCK VAULT DOOR WITH BRASS KEY` prints `[F10:door-unlocked]`, `OPEN VAULT DOOR` prints `[F10:door-opened]`; going north while closed is refused | A13/A14 (protected puzzle case) |
| F11 | Designated extension anchor | `basalt pedestal` in the vault; `[F11:anchor=pedestal]` — the stable boundary reserved for future bridge testing | D07/D13 precursor |
| F12 | Cleanly observable terminal state | `PUT BRASS KEY ON BASALT PEDESTAL` prints `[F12:terminal=victory]` and ends the game through the library's normal end sequence | A13 |

### Diagnostic meta verbs (do not advance game time)

- `MARKERS` — prints `[MARKERS]`, `[F01:startup=...]`, `[F06:turns=...]`, player object number.
- `INSPECT <thing>` — prints `[DIAG:inspect-object#N name=...]` (identity evidence for F09).

### Map

```
Probe Chamber (brass key, stone panel scenery)
   | north
Token Gallery (brass token x2, vault door [locked] to the north)
   | north (through the locked vault door)
Records Vault (basalt pedestal)   -> put key on pedestal to end the game
```

The intended full playthrough: `take key` → `north` → (F09 examinations) →
`unlock vault door with brass key` → `open vault door` → `north` →
`put key on pedestal` → terminal state.

## Build procedure

### Toolchain pins (verified 2026-10-22)

| Component | Version | Source | SHA-256 |
| --- | --- | --- | --- |
| Inform 6 compiler (win32) | 6.44 (11 Sep 2025) | https://github.com/DavidKinder/Inform6/releases/download/v6.44/inform644_win32.zip | `70900ea74795e8b7cccc39f7666cf9e26112dfda71845c99b569f79fd1f8ebc3` (zip) |
| Inform 6 Library | 6.12.8 (26 Dec 2025), GitLab tag `6.12.8`, target commit `7affc7d422e17a20ea4dfd6f319a5c18339cc94a` | https://gitlab.com/DavidGriffith/inform6lib/-/raw/6.12.8/<file> | see `fixture.sha256` |

Provenance note: the library's own `lib/README.txt` at tag 6.12.8 is stale upstream text still saying "6.12.7" — the authoritative version markers are `lib/version.h` (`LibRelease "6.12.8"`) and the header banners ("Release 6.12.8 -- Serial number 251226"), which also match the compiler banner in recorded runs ("Inform v6.44 Library v6.12.8").

Compiler license: Inform 6 is published under the original Inform licence or
the Artistic License 2.0, at the user's choice (`licence.txt` in the compiler
distribution). The compiler binary is expected at
`tools/inform6-6.44/inform6.exe` (gitignored; not redistributed).

### Command

From this directory:

```
tools/inform6-6.44/inform6.exe -v5 +include_path=lib fixture.inf fixture.z5
```

### Reproducibility

With the pinned compiler and library and the fixed `Serial "261022"` in the
source, recompilation is **byte-identical**: verified 2026-10-22 (two
compilations produced SHA-256-identical `fixture.z5`). The integrity test in
`tests/fixtures/zmachine/fixture-integrity.test.js` re-verifies the committed
digest and, when the pinned compiler is present locally, recompiles and
compares bytes again.

Windows note: the manifest pins the committed LF bytes. With
`core.autocrlf=true`, git rewrites text files to CRLF on checkout and the
digest test fails even though `git diff` shows no change; set
`core.autocrlf=false` for this clone (the CI workflow normalizes the same way
before running the suites).

## Negative-test stories (`negative/`)

Two additional purpose-built stories support the bounded-termination negative
tests. They are **not** part of the F01–F12 fixture sequence; they carry the
same redistribution grant as the main fixture and are pinned by the same
`fixture.sha256` manifest.

| Story | Purpose | Behavior |
| --- | --- | --- |
| `negative/loopstory` | Runaway recursion | Drives unbounded recursive calls: ifvms.js exhausts its preallocated stack (`RangeError`, classified as an error); Bocfel exits nonzero. |
| `negative/spinloop` | Nonrecursive infinite loop | A `while(1)` loop with no recursion and no input request — it never reaches an input boundary, so no test-runner timeout can bound it. The ifvms case is preempted by a killable worker's parent deadline (`worker.terminate()`); the Bocfel case is bounded by the adapter's per-step watchdog. |

`spinloop.inf` pins `Serial "261022"` so its recompilation is byte-identical
with the pinned toolchain, using the same procedure as the main fixture:

```
tools/inform6-6.44/inform6.exe -v5 negative/spinloop.inf negative/spinloop.z5
```

`loopstory` predates the Serial pin and is pinned by digest alone (no
byte-identical rebuild guarantee).

## Fixture design notes

- The F06 daemon is an **object daemon** (parentless object with a `daemon`
  property). A `StartDaemon(<routine>)` call was tried first and crashes the
  vendored ifvms.js ZVM: the library 6.12.8 routine-daemon path decodes the
  timer entry as an object number and performs a property lookup on a packed
  routine address, which is undefined behavior under the Z-machine standard
  (§12/§15 `get_prop_addr`). The object form has well-defined semantics under
  any conformant interpreter. See `docs/evidence/g1-native-io.md`.
- Room descriptions deliberately avoid adjacent string literals: Inform 6 does
  not concatenate them (they compile as multi-word property values, which the
  library refuses to read).
- `MARKERS`/`INSPECT` are `meta` verbs: the library skips the entire turn
  sequence for meta actions, so diagnostics never advance game time.
- The status line (upper window) is drawn by the library each turn; headless
  adapters capture it separately from the main transcript.
