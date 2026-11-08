# Issue #51: pinned Bocfel autosave qualification, 2026-11-08

Source baseline `6e36c0b1edaaf1b7deabf02aae1be04d643d91c1` (PR #69).
The [self-contained harness](../../../experiments/bocfel-autosave/README.md)
replaces the abbreviated FIFO example as current reproduction guidance. It
builds unmodified upstream Bocfel 2.6 independently of ifvms, without installing
or replacing an interpreter. D39 remains **proposed and owner-unapproved**;
#12/#40 stay open. No #52/#14 work or service restart is authorized by this record.

## Provenance and retained evidence

Archive: 201,707 bytes, SHA-256
`8541a1c59271f7977e81680e29d9be60d633311870f05bb579f317a6fb37c7b8`,
SHA-1 `319770fc5c50c4824d1b6edea1e9ce2ba0d196da` from the
[official downloads](https://cspiegel.github.io/bocfel/downloads.html).
Default Unix/non-Glk/curses build, `make -j2 CXX=g++ PLATFORM=unix GLK= OPT=-O2 CXXFLAGS=-g`,
no local.mk, runtime assertions enabled. The local strict run used Python
3.11.15, g++ 11.4.0, Make 4.3, WSL2 Linux 6.6.87.2/glibc 2.35; executable
SHA-256 `d2157520ca6708384cc36edca291cdc7b802187199073ce4eba7ccd6c8e30757`.
Toolchain/path differences can change this binary hash; it is not a portable pin.
[Build identity](build-identity.json) records all upstream source hashes, command,
versions and the complete sanitized environment allowlist. Only synthetic
fixture inputs and harness-owned paths enter the processes.

The canonical story remains 88,576 bytes, SHA-256
`96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b`.
The original builder's valid-character Z5 is 2,048 bytes, release 51/serial
261108, SHA-256
`d829351fe638fa7f6c18e54cda08a8bb766e05df3106ebfd7985c08115d7af91`.
Its explicit device operand, header and checksum are unit-tested; no compiler
or canonical-fixture modification is involved.

[Manifest](manifest.json) retains **all twelve outcomes**, prefix IFhd/memory/
Args/Rand/chunk summaries, exact comparison suffixes and the compact-file
inventory. Each case directory retains complete raw control/candidate/restored
stdout/stderr, input-offset/termination events, and result sidecars. These are
portable repository evidence; embedded scratch paths identify historical
processes and are not prerequisites or links to surviving files. Relevant Args/
Rand bytes are in each sidecar and [frozen expectations](expectations.json).
Full autosaves, entropy bytes, build logs and complete manifests belong to the
downloadable CI bundle; no archive or executable is committed.

## Results and expectation policy

Every case was characterized three times, then run three times again against
fixed expectations. Characterization is explicitly non-qualifying and cannot
rewrite the golden file. The strict local run passed **12/12**; its full bundle
passed `--verify-bundle` (inventory/hash, trial uniqueness, native exits/pipe EOF,
BFZS summary and raw suffix reconstruction). No trimming or filtering is used.
Raw replay/startup and quit segments remain available alongside the compared
post-input suffix, delimited by recorded events.

| Case, three independent controls/trials each | Expected and observed |
| --- | --- |
| Canonical seeded line: look/north/seed 42/roll, kill, restore, roll/roll | 3/3: announcement; Args `00111e128f`, Rand `000000ad4528`; suffix rolls **5,4**, turns **5,6**, exact suffix bytes equal to uninterrupted control. |
| Canonical zero-operand char: menu, kill, restore, b | 3/3: original Args `01`, no Rand; `[Save file error: invalid Args size for 1: 0]`, fallback startup and line parser rejection. Control key 98/beta differs; restored eventual exit 0 does not establish restoration. |
| Conforming read_char 1 control: seed -42, pending char, kill/restore, b | 3/3: announcement; Args `010001`, Rand `00000000002a`; key **98**, seeded roll **1**, exact output matches uninterrupted control, then halt/exit 0. |
| Canonical random mode: look/north/roll, fixed -Z word stream, kill/restore, roll/roll | 3/3: no Rand; same turns 4,5, unequal exact suffix: uninterrupted **6,1**, restored **1,2**. Native-endian stream 0..1023 is recreated identically; restoration reopens it at the beginning. |

Each killed candidate was actually observed as return code -9/SIGKILL; both
stdout/stderr reached EOF before cleanup. Independent controls and restored
processes ended with exit 0 and both EOFs. Prefix autosaves were preserved before
native restoration could overwrite them. Saved PC/Args/Rand/memory match the
control projection; this is not a whole-interpreter-state oracle.

The canonical menu contains **`f6 ff 01` at 0x124ac**, a zero-operand read_char,
while [the standard requires keyboard device 1](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect15.html#read_char).
Bocfel stack.cpp's `read_args` requires a ReadChar operand and rejects this
payload. Its failure is a specific compatibility case; the conforming control
passes. `random.cpp:143–170` omits Rand in random mode and restores predictable
xorshift state when present; `init_random` opens the `-Z` file only on first
startup, so its cursor is not recovered. The fixed stream demonstrates that
limit without relying on chance or asserting natural-entropy reconstruction.

## Verification and acceptance mapping

Commands from the harness README produced:

| Check | Local result |
| --- | --- |
| Python unittest discovery, Windows | 21 total: 15 pass, 6 explicit POSIX skips, exit 0. |
| Same units inside WSL | 21/21 pass, exit 0. |
| Required pinned native matrix, strict expectations | 12/12 pass; complete bundle verified, exit 0. |
| `node --test`, experiments/vm-checkpoint | 141/141 pass, exit 0. |
| `node --test`, experiments/vm-io | 83 total: 82 pass, 1 no-WSL environment skip because installed WSL Bocfel is available; exit 0. |
| `node --test`, tests/fixtures/zmachine | 2 pass, 1 missing pinned Inform compiler skip; exit 0. No compiler installed. |
| `node --test tests/ci/checkout-normalization.test.js` | 1/1 pass, exit 0. |

Raw local logs and complete runs are retained outside the checkout as
`D:/projects/zirp-issue51-*`; these local-only paths do not replace portable
source evidence or hosted artifacts. Historical receipts were restored exactly.
Whitespace checks pass for source and prose. Raw native stdout deliberately
retains the trailing space in `Are you sure you want to quit? ` (18 occurrences
across the canonical control/restored runs); removing it would alter evidence.
Installed WSL Bocfel remains SHA-256
`098371e6f0c2d8a56e8ce2ee0a54fee22c1673b32016290d32adcc71824f6e27`.
Canonical fixtures, adapters/shim/publisher, checkpoint/build identity, vendored
sources and prior receipts are unchanged relative to the selected baseline.

| #51 acceptance | Evidence / bounded disposition |
| --- | --- |
| Reproduce or revise every observation from scratch, with commands/expected markers | Harness README, pinned source build, four frozen cases x3; deterministic -Z divergence replaces chance-based random-mode numbers as current guidance. Dated 2026-10-23 observations retained in recovery §7. |
| Character failure separately from seeded line success; no all-build extrapolation | Canonical zero-operand failure 3/3; conforming control success 3/3; seeded line success 3/3. Restricted to source pin/build flags/fixtures and tested hosts. |
| Reviewer can inspect without deleted temp files | This committed raw bundle plus downloaded/locally verified hosted full bundle before independent review; full BFZS/build logs are CI artifacts. Review gate remains unmet until that download and qualified independent verdict. |
| D39 preference grounded in own passing ifvms evidence | Existing 141-test checkpoint suite passes independently. Corrected only Bocfel-specific D39 qualifications; no runtime adoption, integration or broader #52 reconciliation. |

Hosted CI/artifact links and the independent verdict are recorded in the PR and
issue closeout after those gates pass. A local matrix pass alone does not close
#51. Merge requires exact-head existing checks, new Windows/Ubuntu unit/reference
jobs, CodeQL and resolved review findings; closure additionally requires actual
merge-commit CI/artifacts. #12/#40 acceptance remains separate.

This record does not qualify complete window/status rendering, timed input,
sound, graphics, arbitrary stories or every Bocfel build. It supplies no entropy
reconstruction gate, production adapter, durable commit or receipt recovery;
those remain separate requirements. The ifvms proposal earns no extra capability
from Bocfel's limitations, and proposed D39 stays owner-unapproved.
