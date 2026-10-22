# Z-machine and VM boundaries

## Contents

1. [Choose the layer and evidence](#choose-the-layer-and-evidence)
2. [Version-sensitive semantics](#version-sensitive-semantics)
3. [Save formats and execution checkpoints](#save-formats-and-execution-checkpoints)
4. [Project adapter obligations](#project-adapter-obligations)
5. [Focused validation](#focused-validation)

## Choose the layer and evidence

Prefer integration with a selected, pinned interpreter over implementing a VM. Change interpreter internals only when the task requires it. Record the story-byte digest, actual story version, compiler/library pins for fixtures, runtime/adapter revision, supported input states, and relevant standards clauses. Z-machine story versions V1–V8 differ from Standards revisions 1.0/1.1.

Separate five claims: valid story/container parsing, opcode behavior, host I/O support, complete checkpoint support, and story-specific semantic capabilities. Evidence for one does not establish the others. A hash binds evidence to bytes; it does not prove that evidence correct.

The technical summaries below refer to the primary Z-machine Standards 1.1 publication, Quetzal 1.4, and Blorb 2.0.4. Consult the linked clause for the version being changed. Cross-check opcode tables, dictionary entries, and structural sections when wording conflicts. Preserve documented compatibility behavior until a scoped change justifies replacing it.

## Version-sensitive semantics

### Memory and addresses

Keep byte, word, and packed addresses distinct. Preserve big-endian word encoding. Enforce legal dynamic-memory writes and header ownership; do not treat all writable bytes as safe story-level edits. Do not assume the high-memory mark proves where every real story routine resides.

| Story version | Routine packed address `P` | String packed address `P` |
| --- | --- | --- |
| V1–V3 | `2P` | `2P` |
| V4–V5 | `4P` | `4P` |
| V6–V7 | `4P + 8R_O` | `4P + 8S_O` |
| V8 | `8P` | `8P` |

Read `R_O` and `S_O` from header words `0x28` and `0x2A`. V7/V8 otherwise follow V5 except specified differences; do not apply every V6 rule to them. Distinguish [file-length multipliers, §11.1.6](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect11.html) from packed-address formulas. [Memory/address specification, §1](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect01.html).

### Decode, evaluate, and branch

Select instruction behavior by opcode class, number, and story version. Consume operand metadata, operands, result-variable byte, branch data, and inline text in the prescribed order. Some instructions both store and branch. `call_vs2`/`call_vn2` have two operand-type bytes.

Evaluate operands once, left to right. A variable-typed operand yields a value; an operation may then interpret that value as an indirect variable number. Keep these steps separate. Stack operands make extra reads observable.

Two-byte branch offsets are signed 14-bit values. Offsets 0/1 return false/true; other targets are `PC_after_branch_data + offset - 2`. Advance past the terminating encoded word of inline print text. [Instruction encoding, §4](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect04.html).

Do not infer exact operand count from a class label: `je` can compare additional operands. Verify version-specific `read`, save/restore, and `pull` forms. Do not silently implement unsupported instructions as no-ops; also respect the standard's specified exceptions for unknown extended opcodes. [Opcode table, §14](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect14.html); [opcode dictionary, §15](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect15.html).

### Variables, calls, arithmetic, and RNG

Ordinary variable-0 reads pop and stores push. Indirect variable-0 access in the applicable `inc`, `dec`, `inc_chk`, `dec_chk`, `load`, `store`, and `pull` forms operates on the existing stack top. Preserve routine-local stack boundaries and discard that routine's extra evaluation values on return. A call to packed address zero returns false; check the sentinel before applying offsets. [Game state and calls, §6](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect06.html).

V1–V4 routine headers provide initial local values; V5+ starts locals at zero before arguments overwrite them. V6 startup calls a packed main routine; other versions begin at an instruction address. [Routines, §5](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect05.html).

Use explicit 16-bit signed/unsigned conversions. Signed division truncates toward zero; remainder follows the dividend's sign (`-11 / 2 = -5`, `-13 % 5 = -3`). Host-language floor division is not equivalent. Division/remainder by zero is illegal; halt with a clear interpreter error as the standard recommends. For overflow, preserve documented behavior and identify compatibility deviations; the standard recommends modulo 65536 while noting historical underspecification. A negative `random` argument seeds predictable mode; zero reseeds; a positive range requests a draw. Reseeding predictably must reproduce the sequence within that interpreter; different interpreters need not agree on the sequence. [Arithmetic/RNG, §2](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect02.html); §15 `random`.

### Objects and properties

| Layout | V1–V3 | V4+ |
| --- | --- | --- |
| Default properties | 31 words | 63 words |
| Object entry | 9 bytes | 14 bytes |
| Attributes | 32 | 48 |
| Parent/sibling/child links | Byte values | Word values |

Object 0 denotes absence, not an ordinary entry. Property lists descend numerically; the short-name length counts words. V4+ two-byte property headers encode a length of 64 when the six-bit length is zero. Preserve opcode-specific default/absent-property behavior and legal property sizes.

The maximum actual object number is not stored as a header count. Use a documented, bounded enumeration strategy. Do not infer that every root object is a room, every object is physical, or a numbered property has universal story meaning. [Object table, §12](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect12.html).

### Text, dictionary, and I/O

Separate packed Z-characters, ZSCII, and Unicode. Respect V1/V2 versus V3+ alphabet shifts, V5+ custom alphabets, abbreviation word addresses, and prohibition of recursively nested abbreviations. Dictionary truncation is six Z-characters for V1–V3 and nine for V4+; it is not Unicode-string truncation. ZSCII newline is 13. [Text, §3](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect03.html).

Dictionary encoded text occupies four bytes in V1–V3, six in V4+; remaining entry bytes are story data. Preserve encoded ordering, separator tokens, input positions, and parse-buffer bounds. [Dictionary, §13](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect13.html).

Represent pending line input, character input, timed input, halted, and error states explicitly. Preserve terminating characters and version-dependent `read` buffers. For supported timed input, honor native callback semantics under the verified clock contract; do not add synthetic turns from polling or model latency. Claim timed-input pause/resume only with evidence. [Input, §10](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect10.html); §15 `read`/`read_char`.

Preserve output stream/window/style events required by declared support. Stream 3 writes to story memory and suppresses other selected output streams while active; its nested state matters. Keep exact native output separate from AI prose and avoid exposing internal memory-stream text as displayed narration. [Output, §7](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect07.html).

Apply header `Dyn`/`Int`/`Rst` ownership and reset rules. Advertise only implemented features; setting a standards-revision field asserts conformance. Do not restore the entire header blindly or erase current interpreter capabilities. [Header, §11](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect11.html); §6 restore/restart.

## Save formats and execution checkpoints

### Quetzal

Quetzal uses `FORM IFZS`, `IFhd`, `Stks`, and `CMem` or `UMem`. Respect big-endian fields, lengths, and padding; write `IFhd` before memory/stack chunks. Validate story release/serial/checksum plus the project's story digest.

`CMem` XORs original dynamic memory with current memory, with zero runs of `n+1` bytes. An omitted tail means original bytes. Reject incomplete runs/oversized expansion without active-state mutation: this follows the project's invalid-restore contract; Quetzal identifies these errors but leaves handling to implementers. `UMem` must match dynamic-memory size. Frames are oldest first; non-V6 saves need the specified dummy frame.

Save continuation: V1–V3 branch, V4+ store. Cross-check Quetzal §5.8 and opcode forms; §15 `save` prose has conflicting V4 wording. The saved PC identifies branch/result metadata.

Quetzal has no standardized RNG-state or remix-world chunk. Portable saves alone do not prove complete application recovery. [Quetzal 1.4, §§2–5, 7–8](https://inform-fiction.org/zmachine/standards/quetzal/index.html).

### Blorb

If container support is in scope, parse `FORM IFRS` with strict bounds and padding checks. Require exactly one `RIdx`, first inside the FORM, and validate index offsets against actual chunk beginnings. Distinguish `Exec` resource 0 of type `ZCOD` from `GLUL`; Blorb is not itself a VM. Do not execute another format because its filename looks supported. Preserve both container and extracted story identities where the contract needs them. [Blorb 2.0.4, §§0–1, 5, 15](https://eblong.com/zarf/blorb/blorb.html).

## Project adapter obligations

Read `docs/architecture/state-and-vm-bridge.md` §§1–9 and the approved G1 brief. Inventory all state that affects continuation: dynamic memory, PC, frames/evaluation stack, pending read continuation, relevant windows/streams/buffers, timers/sound callbacks, RNG state or controlled outcomes, and identity/version metadata. Identify unsupported boundaries explicitly. Application snapshot requirements exceed the portable save format; avoid changing native SAVE semantics to imitate an internal checkpoint.

Collect, compile, and preview the initial directive before intentional startup (D09). Do not equate that ordering with a proven ability to patch native state before startup. Apply an approved state patch only at the earliest verified safe boundary; identify whether it is prestart or a disclosed poststart change. Non-executing inspection is separate. Track effects executed before the first prompt; buffering or replacing output cannot undo them. If a requested opening change needs an unavailable prestart/rewind capability, leave it unapplied and report the limitation.

Declare each native capability with exact story/runtime/adapter identity, supported input boundary, preconditions, read/write sets, dependent effects, recovery strategy, and test evidence. Keep mutation IDs stable and unambiguous. Expose a named semantic capability, never raw addresses or arbitrary property writes. A tested item move does not prove player teleportation or complete NPC takeover. Treat original story bytes as immutable input; keep AI-authored additions in the overlay unless a tested bridge owns the effect.

## Focused validation

For a VM fix, assert relevant PC, stack, locals/globals, memory, pending input, and output events; a transcript alone is insufficient. Cover the actual supported version and the adjacent semantic boundary when that boundary is affected. Use known bytes or pinned compiler output, with explicit fixture rights.

For runtime comparison, align the fixture and input protocol, record documented presentation differences, and investigate disagreement against the standard. Do not demand cross-interpreter RNG sequence identity without a common specified generator. For recovery, recreate the runtime and compare subsequent behavior; discard a timer/RNG-consuming candidate and prove the baseline unchanged. Select existing conformance suites by coverage and license rather than claiming all Z-machine versions from one Z5 fixture. [Standards resource appendix](https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/appc.html).
