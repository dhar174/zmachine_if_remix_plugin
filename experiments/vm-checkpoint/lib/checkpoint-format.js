'use strict';
// ==============================================================================
// checkpoint-format.js -- the G1-B experimental checkpoint envelope
// ------------------------------------------------------------------------------
// Probe code for Issue #12, not a production format.  The envelope is a
// versioned, DATA-ONLY JSON document: executable code is never serialized
// (caches are excluded; startup entries can persist and later entries are lazy), and
// restore validates the whole envelope before any interpreter is touched.
//
// Envelope v2 layout (see docs/evidence/g1-vm-recovery.md for the full
// state-inventory classification this implements):
//   format / version            -- magic + schema version
//   identity                    -- exact story digest/size, runtime name +
//                                  pinned runtime revision, adapter name,
//                                  schema version (restore refuses a mismatch
//                                  before constructing anything)
//   boundary                    -- input-boundary kind: 'line' | 'char' |
//                                  'halted', plus the pending line-request
//                                  maxlen when kind is 'line'
//   payload                     -- quetzal (base64 of vm.save_file(pc,1):
//                                  IFhd/UMem/Stks), rng, io, readData, window
//                                  text/cursor state, published output,
//                                  request log (minus the pending entry), VM
//                                  halt flags, undo disposition
//   integrity                   -- sha256 over all other envelope fields
//   capabilities                -- exact implementation-owned declaration;
//                                  imported claims never grant authority
//
// Validation failures throw CheckpointError with a stable `code` so tests can
// assert the rejection reason (A34 evidence).
// ==============================================================================

const crypto = require('node:crypto');
const { SCHEMA_VERSION, RUNTIME_NAME, implementationIdentity, capabilityStatement } = require('./checkpoint-contract.js');

const FORMAT = 'zirp-g1b-checkpoint';
const SUPPORTED_BOUNDARIES = ['line', 'char', 'halted'];
// Generous size caps: a checkpoint for the 88,576-byte fixture is ~250 KB of
// JSON (UMem is ~47 KB raw -> ~63 KB base64; output/transcript small).  Caps
// exist so a hostile or corrupt envelope is rejected before parsing deep
// structures, not as a security boundary.
const CAPS = {
    quetzalBase64Chars: 4 * 1024 * 1024,
    outputChars: 4 * 1024 * 1024,
    requestLogEntries: 10000,
    readDataBufferEntries: 4096,
    jsonChars: 32 * 1024 * 1024,
};

class CheckpointError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CheckpointError';
        this.code = code;
    }
}

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Deep clone for JSON-safe plain data (io, read_data, request log).  Drops
// prototype identity, which is exactly what we want: only data crosses the
// checkpoint boundary.
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

// Canonical JSON for the data-only v2 checksum: object keys are sorted by JS
// string order, array order is retained, and only finite JSON values are
// permitted. This is an experiment-specific encoding, not a signature or a
// claim of compliance with an external canonicalization standard.
function canonicalJson(value, ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== 'object' || ancestors.has(value)) {
        throw new CheckpointError('E_STRUCTURE', 'envelope contains a non-JSON or cyclic value');
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new CheckpointError('E_STRUCTURE', 'envelope contains a non-plain object');
    }
    ancestors.add(value);
    let result;
    if (Array.isArray(value)) {
        result = '[' + Array.from(value, (item) => canonicalJson(item, ancestors)).join(',') + ']';
    } else {
        result = '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key], ancestors)).join(',') + '}';
    }
    ancestors.delete(value);
    return result;
}

function canonicalEnvelopeString(envelope) {
    if (!isPlainObject(envelope)) throw new CheckpointError('E_FORMAT', 'envelope is not an object');
    const bound = Object.create(null);
    for (const key of Object.keys(envelope)) if (key !== 'integrity') bound[key] = envelope[key];
    return 'zirp-g1b-envelope-v2\n' + canonicalJson(bound);
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isArrayOfInts(v, maxLen) {
    return Array.isArray(v) && v.length <= maxLen && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 0x10FFFF);
}

function isInt32(v) {
    return Number.isInteger(v) && v >= -0x80000000 && v <= 0x7FFFFFFF;
}

// Structural + integrity validation.  Identity comparison against the active
// assets happens here too: restoreCheckpoint() passes the expected story
// digest/size and runtime revision; a mismatch rejects before any VM exists.
function validateEnvelope(envelope, expected) {
    if (!isPlainObject(envelope)) throw new CheckpointError('E_FORMAT', 'envelope is not an object');
    if (envelope.format !== FORMAT) throw new CheckpointError('E_FORMAT', 'unknown checkpoint format: ' + String(envelope.format));
    if (envelope.version !== SCHEMA_VERSION) throw new CheckpointError('E_VERSION', 'unsupported checkpoint schema version: ' + String(envelope.version));

    const id = envelope.identity;
    if (!isPlainObject(id)) throw new CheckpointError('E_STRUCTURE', 'identity section missing');
    if (!isPlainObject(expected) || typeof expected.storySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.storySha256)
        || !Number.isSafeInteger(expected.storySize) || expected.storySize < 0) {
        throw new CheckpointError('E_STORY', 'trusted story digest and size are required');
    }
    if (id.storySha256 !== expected.storySha256) {
        throw new CheckpointError('E_STORY', 'checkpoint story digest ' + id.storySha256 + ' does not match active story ' + expected.storySha256);
    }
    if (id.storySize !== expected.storySize) {
        throw new CheckpointError('E_STORY', 'checkpoint story size mismatch');
    }
    if (id.schema !== SCHEMA_VERSION) throw new CheckpointError('E_VERSION', 'identity.schema mismatch');
    const implementation = implementationIdentity();
    if (expected.runtimeRevision !== implementation.runtimeRevision) {
        throw new CheckpointError('E_RUNTIME', 'expected runtime revision does not match the active pinned implementation');
    }
    for (const [key, value] of Object.entries(implementation)) {
        if (id[key] !== value) throw new CheckpointError('E_RUNTIME', 'checkpoint identity.' + key + ' does not match the active implementation');
    }
    const identityKeys = ['storySha256', 'storySize', 'schema', ...Object.keys(implementation)].sort();
    if (JSON.stringify(Object.keys(id).sort()) !== JSON.stringify(identityKeys)) {
        throw new CheckpointError('E_STRUCTURE', 'identity contains missing or unknown fields');
    }

    const b = envelope.boundary;
    if (!isPlainObject(b) || !SUPPORTED_BOUNDARIES.includes(b.kind)) {
        throw new CheckpointError('E_BOUNDARY', 'unsupported or missing boundary kind: ' + String(b && b.kind));
    }
    if (b.kind === 'line' && !Number.isInteger(b.maxlen)) {
        throw new CheckpointError('E_BOUNDARY', 'line boundary requires the pending request maxlen');
    }
    if (b.kind === 'line' && (b.maxlen < 0 || b.maxlen > 255)) {
        throw new CheckpointError('E_BOUNDARY', 'line boundary maxlen out of range: ' + b.maxlen);
    }
    const boundaryKeys = b.kind === 'line' ? ['kind', 'maxlen'] : ['kind'];
    if (JSON.stringify(Object.keys(b).sort()) !== JSON.stringify(boundaryKeys)) {
        throw new CheckpointError('E_BOUNDARY', 'boundary contains missing or unknown fields');
    }

    const p = envelope.payload;
    if (!isPlainObject(p)) throw new CheckpointError('E_STRUCTURE', 'payload section missing');
    if (typeof p.quetzalB64 !== 'string' || p.quetzalB64.length === 0 || p.quetzalB64.length > CAPS.quetzalBase64Chars) {
        throw new CheckpointError('E_SIZE', 'quetzal payload missing or oversized');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p.quetzalB64)) throw new CheckpointError('E_STRUCTURE', 'quetzal payload is not valid base64');
    if (typeof p.headerBlockB64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.headerBlockB64)
        || Buffer.byteLength(Buffer.from(p.headerBlockB64, 'base64')) !== 0x40) {
        throw new CheckpointError('E_STRUCTURE', 'headerBlockB64 must be base64 of exactly 0x40 bytes');
    }
    if (!isPlainObject(p.rng) || !isInt32(p.rng.seed) || (p.rng.mode !== 'seeded' && p.rng.mode !== 'unseeded')) {
        throw new CheckpointError('E_STRUCTURE', 'rng section invalid');
    }
    // Unseeded recovery is UNSUPPORTED and must fail, not silently switch
    // semantics: seed 0 means draws come from the restoring process's
    // Math.random (the interpreter's only host-entropy point), whose state
    // the envelope neither captures, injects, nor records -- violating the
    // "captured, injected, or recorded" requirement in
    // docs/architecture/state-and-vm-bridge.md §8 and Issue #12's "unsupported
    // modes must fail explicitly".  Checkpointable boundaries therefore
    // require the game to be in seeded (predictable) mode.
    if (p.rng.mode !== 'seeded' || p.rng.seed === 0) {
        throw new CheckpointError('E_RNG',
            'unseeded checkpoints are rejected: host randomness cannot be reconstructed across processes (bridge §8); put the game in seeded mode (e.g. the fixture SEED command) before checkpointing');
    }
    if (!isPlainObject(p.io)) throw new CheckpointError('E_STRUCTURE', 'io section missing');
    validateIo(p.io);
    if (!isPlainObject(p.windows)) throw new CheckpointError('E_STRUCTURE', 'windows section missing');
    validateWindows(p.windows);
    if (p.io.currentwin === 1 && !p.windows.upper) {
        throw new CheckpointError('E_WINDOW_TOPOLOGY', 'selected upper window is missing');
    }
    if (!isPlainObject(p.publishedOutput)
        || typeof p.publishedOutput.output !== 'string'
        || typeof p.publishedOutput.gridOutput !== 'string'
        || p.publishedOutput.output.length > CAPS.outputChars
        || p.publishedOutput.gridOutput.length > CAPS.outputChars) {
        throw new CheckpointError('E_SIZE', 'published output missing or oversized');
    }
    if (!Array.isArray(p.requestLog) || p.requestLog.length > CAPS.requestLogEntries) {
        throw new CheckpointError('E_SIZE', 'request log missing or oversized');
    }
    if (!isPlainObject(p.vmFlags) || typeof p.vmFlags.quit !== 'boolean') {
        throw new CheckpointError('E_STRUCTURE', 'vmFlags section invalid');
    }
    if (!isPlainObject(p.undo) || p.undo.preserved !== false) {
        throw new CheckpointError('E_STRUCTURE', 'undo disposition missing (undo is declared unsupported in schema v2)');
    }

    if (b.kind === 'halted') {
        if (p.readData !== null) throw new CheckpointError('E_STRUCTURE', 'halted checkpoint must not carry readData');
        if (p.vmFlags.quit !== true) throw new CheckpointError('E_STRUCTURE', 'halted checkpoint must record quit=true');
    } else {
        const rd = p.readData;
        if (!isPlainObject(rd)) throw new CheckpointError('E_STRUCTURE', 'non-halted checkpoint requires readData');
        // The store variable is what the resumed read writes its result to:
        // it is required for BOTH boundary kinds and must be a Z-machine
        // variable number.
        if (!Number.isInteger(rd.storer) || rd.storer < 0 || rd.storer > 255) {
            throw new CheckpointError('E_STRUCTURE', 'readData.storer (store variable) required, 0..255');
        }
        for (const opt of ['routine', 'time']) {
            if (rd[opt] !== undefined && (!Number.isInteger(rd[opt]) || rd[opt] < 0)) {
                throw new CheckpointError('E_STRUCTURE', 'readData.' + opt + ' must be a non-negative integer');
            }
            // ifvms stores both optional opcode operands, but neither it nor
            // the Glk shim schedules timed input.  Missing/undefined and zero
            // are the only accepted v2 representations; reject either nonzero
            // operand even if the other is zero or absent.  Capture invokes
            // this same validator, so both sides give the same error.
            if (rd[opt] !== undefined && rd[opt] !== 0) {
                throw new CheckpointError('E_TIMED_INPUT',
                    'readData.' + opt + ' is nonzero: timed input is unsupported by the pinned runtime and checkpoint shim');
            }
        }
        if (b.kind === 'line') {
            if (!isArrayOfInts(rd.buffer, CAPS.readDataBufferEntries)) throw new CheckpointError('E_STRUCTURE', 'line readData.buffer invalid');
            if (!Number.isInteger(rd.bufaddr) || rd.bufaddr < 0 || rd.bufaddr > 0xFFFFFF) throw new CheckpointError('E_STRUCTURE', 'line readData.bufaddr invalid');
            if (!Number.isInteger(rd.parseaddr) || rd.parseaddr < 0 || rd.parseaddr > 0xFFFFFF) throw new CheckpointError('E_STRUCTURE', 'line readData.parseaddr invalid');
        } else if (rd.buffer !== undefined) {
            throw new CheckpointError('E_STRUCTURE', 'char readData must not carry a line buffer');
        }
    }

    const integ = envelope.integrity;
    if (!isPlainObject(integ) || JSON.stringify(Object.keys(integ).sort()) !== JSON.stringify(['algorithm', 'envelopeSha256'])
        || integ.algorithm !== 'sha256' || typeof integ.envelopeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(integ.envelopeSha256)) {
        throw new CheckpointError('E_STRUCTURE', 'integrity section missing');
    }
    const actual = sha256Hex(canonicalEnvelopeString(envelope));
    if (actual !== integ.envelopeSha256) {
        throw new CheckpointError('E_DIGEST', 'envelope digest mismatch');
    }

    // The pinned read method always passes initiallen=0 to the shim. Even an
    // honestly rehashed envelope cannot change the restored request metadata.
    if (b.kind === 'line' && b.maxlen !== 0) {
        throw new CheckpointError('E_BOUNDARY', 'line boundary maxlen must equal the pinned runtime initial length 0');
    }

    if (!isPlainObject(envelope.capabilities)
        || canonicalJson(envelope.capabilities) !== canonicalJson(capabilityStatement())) {
        throw new CheckpointError('E_CAPABILITY', 'checkpoint capability claims do not match the active implementation');
    }

    // Cross-section consistency, checked after the envelope checksum. The
    // checksum detects unrecomputed changes; it does not authenticate data.
    // The shim's published buffer-window text IS the
    // transcript (and the grid window's text is the grid transcript), so a
    // disagreement means the envelope's sections describe different states
    // and continuation would lose or republish text.
    if (p.publishedOutput.output !== p.windows.main.text) {
        throw new CheckpointError('E_STRUCTURE', 'published transcript disagrees with the main window text');
    }
    if (p.windows.upper ? p.publishedOutput.gridOutput !== p.windows.upper.text : p.publishedOutput.gridOutput !== '') {
        throw new CheckpointError('E_STRUCTURE', 'published grid transcript disagrees with the upper window text');
    }

    // Read-continuation address/span validation (Issue #41, A34), also
    // post-digest: it interprets the payload's own checkpointed memory image,
    // after the checksum verifies; that checksum does not authenticate its source.
    validateReadContinuation(p, b, expected);

    return true;
}

// ---------------------------------------------------------------------------
// Read-continuation address/span validation (Issue #41, A34).
//
// The pending read's continuation writes -- the typed text and the parse
// table -- land in VM memory only when input ARRIVES, i.e. after ready:true.
// A hostile or corrupt envelope can therefore point bufaddr/parseaddr
// anywhere and only fault the child later (observed: bufaddr=0xFFFFFF with an
// honestly recomputed digest restored ready:true, then threw
// "RangeError: Offset is outside the bounds of the DataView" on the next
// input and exited 4).  The 24-bit integer range check cannot see this, so
// validation derives the spans the continuation will actually write and
// rejects anything outside writable dynamic memory BEFORE any interpreter is
// constructed.
//
// Semantics of the pinned vendored VM (experiments/vm-io/vendor/ifvms:
// src/zvm/io.js read/handle_line_input, src/zvm/text.js tokenise,
// src/zvm.js prepare):
//
//   - Continuation writes go through `ram`, a MemoryView over
//     [0, static base); a write at or above the static base faults with the
//     RangeError above.  The static base is header 0x0E-0x0F, carried inside
//     UMem.  Addresses below 0x40 are the interpreter-owned header block the
//     checkpoint deliberately writes back verbatim -- buffer objects do not
//     live there.
//   - Line completion (v5+) writes the count byte at bufaddr+1 and up to
//     `len` bytes at bufaddr+2.., where len is clamped by glksim to
//     payload.readData.buffer.length and is one byte per typed character
//     for the ASCII input the supported surface uses (astral code points
//     expand through the vendored UTF-16 text_to_zscii path -- an input-
//     space residual of the vendored VM, identical live vs restored,
//     outside the checkpoint-mutation classes); tokenise() then writes the
//     count byte at parseaddr+1 and up to memory[parseaddr] four-byte
//     entries.  v1-4 write the response plus its zero terminator from
//     bufaddr+1, which yields the same bound under the capacity tie below.
//   - readData.buffer was created as Array(memory[bufaddr]) at opcode issue
//     (v1-4: Array(memory[bufaddr] - 1)), tying its length to the
//     checkpointed capacity byte at bufaddr.  memory[parseaddr] (max words)
//     is read at continuation time, so the parse span derives from UMem.
//   - parseaddr = 0 is a legitimate sentinel meaning no tokenisation.
//
// Bounds are read from the CHECKPOINTED memory image (the UMem chunk inside
// the payload quetzal -- save_file(pc, 1) writes uncompressed dynamic memory
// of exactly staticmem bytes), not from the virgin story: the game may have
// rewritten its own capacity bytes, and the checkpoint describes the state
// at the boundary.  When the caller supplies trusted story bytes
// (expected.storyBytes), the image's version and static base are also
// cross-checked against the story header.
// ---------------------------------------------------------------------------

// FourCC tags are compared BYTE-EXACTLY against their ASCII byte values:
// the pinned parser's MemoryView.getFourCC() (String.fromCharCode per byte,
// src/common/utils.js) is byte-preserving, while Buffer's ascii decoding
// folds the high bit -- Buffer.from([0xd5, 0x4d, 0x65, 0x6d]).toString('ascii')
// === 'UMem' even though the parser reads 'ÕMem'.  An ASCII-folding
// comparison would accept a high-bit-mutated FORM/IFZS/UMem tag that the
// pinned parser interprets as a different FourCC, validating one container
// while restore interprets another (maintainer review P2 on PR #55).
const FOURCC = {
    form: Buffer.from([0x46, 0x4F, 0x52, 0x4D]), // 'FORM'
    ifzs: Buffer.from([0x49, 0x46, 0x5A, 0x53]), // 'IFZS'
    umem: Buffer.from([0x55, 0x4D, 0x65, 0x6D]), // 'UMem'
    cmem: Buffer.from([0x43, 0x4D, 0x65, 0x6D]), // 'CMem'
};

// Diagnostic renderer for tag bytes: ASCII where printable, \xNN escape
// otherwise -- never re-folds a high bit into a look-alike tag.
function renderFourCC(bytes) {
    let out = '';
    for (const b of bytes) {
        out += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '\\x' + b.toString(16).padStart(2, '0');
    }
    return "'" + out + "'";
}

// Extract the UMem chunk bytes from the payload quetzal.  Mirrors the walk
// of the Quetzal parser restore consumes (src/common/file.js) with NO
// divergence window, so the validated memory image IS the image restore
// applies (review findings F1/F8): the declared FORM area must equal the
// buffer exactly (genuine save_file output always does -- its writer sets
// the FORM size to buffer length - 8 -- so this cannot over-reject genuine
// captures, and it removes any trailing bytes the parser's straddling-
// header window could otherwise read), the chunk walk uses the parser's own
// loop condition (off < formEnd) so every offset the parser processes was
// also processed here, a chunk header extending past the declared area (the
// parser's straddling-header window) is rejected instead of skipped, chunk
// data must fit the declared area (stricter than the parser's own quirky
// bounds check -- we reject rather than mis-accept), the walk must consume
// the declared area exactly, and all FourCC comparisons are byte-exact (see
// FOURCC above).  Format-specific refusals: a compressed CMem memory chunk,
// MULTIPLE memory chunks (the vendored parser keeps the last CMem/UMem
// chunk -- a benign first UMem with a hostile second one would otherwise
// validate one image and restore another), and a missing UMem chunk all
// reject E_STRUCTURE.  Returns a Uint8Array VIEW into the decoded quetzal
// Buffer -- hostile-envelope tests may mutate through it and re-encode;
// validation itself only reads.
function quetzalUmem(quetzalB64) {
    const quetzal = Buffer.from(quetzalB64, 'base64');
    if (quetzal.length < 12 || !quetzal.subarray(0, 4).equals(FOURCC.form) || !quetzal.subarray(8, 12).equals(FOURCC.ifzs)) {
        throw new CheckpointError('E_STRUCTURE', 'payload quetzal is not a Quetzal FORM/IFZS container');
    }
    const formEnd = quetzal.readUInt32BE(4) + 8;
    if (formEnd !== quetzal.length) {
        throw new CheckpointError('E_STRUCTURE', 'payload quetzal declares a FORM area of ' + (formEnd - 8) + ' bytes but carries ' + quetzal.length + ' (must match exactly, as save_file output always does)');
    }
    let off = 12;
    let umem = null;
    while (off < formEnd) {
        if (off + 8 > formEnd) {
            // The parser would read this straddling header across the area
            // end (and past the buffer, since the area equals the buffer
            // length); validation must refuse it, never skip it.
            throw new CheckpointError('E_STRUCTURE', 'payload quetzal has an IFF chunk header at offset ' + off + ' extending past the declared FORM area');
        }
        const typeBytes = quetzal.subarray(off, off + 4);
        const len = quetzal.readUInt32BE(off + 4);
        if (off + 8 + len > formEnd) {
            throw new CheckpointError('E_STRUCTURE', 'payload quetzal declares an IFF chunk out of range (type ' + renderFourCC(typeBytes) + ' at offset ' + off + ')');
        }
        if (typeBytes.equals(FOURCC.umem)) {
            if (umem !== null) {
                throw new CheckpointError('E_STRUCTURE', 'payload quetzal carries multiple memory chunks: the validated memory image must be the image restore applies');
            }
            umem = quetzal.subarray(off + 8, off + 8 + len);
        }
        if (typeBytes.equals(FOURCC.cmem)) {
            throw new CheckpointError('E_STRUCTURE', 'compressed CMem memory chunk: not the uncompressed autosave image the checkpoint format captures');
        }
        off += 8 + len + (len % 2);
    }
    if (off !== formEnd) {
        throw new CheckpointError('E_STRUCTURE', 'payload quetzal chunk walk overruns the declared FORM area (ended at ' + off + ' of ' + formEnd + ')');
    }
    if (umem === null) {
        throw new CheckpointError('E_STRUCTURE', 'payload quetzal carries no UMem chunk');
    }
    return umem;
}

// The single rulebook for line-boundary continuation spans.  Codes: an
// address/span outside writable dynamic memory is E_BOUNDARY (the boundary's
// continuation cannot land there); a payload whose own capacity fields
// disagree (with each other or with the trusted story header) is
// E_STRUCTURE.  parseaddr = 0 is the documented no-tokenise sentinel.
function validateReadContinuation(p, boundary, expected) {
    if (boundary.kind !== 'line') return; // char/halted carry no continuation buffers
    const rd = p.readData;
    const umem = quetzalUmem(p.quetzalB64);

    // The memory image must be an uncompressed autosave memory image (the
    // only kind captureCheckpoint emits) carrying a parseable header.
    if (umem.length < 0x40) {
        throw new CheckpointError('E_STRUCTURE', 'quetzal UMem chunk too short to carry the Z-machine header (needs 0x40 bytes, got ' + umem.length + ')');
    }
    const staticBase = (umem[0x0E] << 8) | umem[0x0F];
    if (staticBase <= 0x40) {
        throw new CheckpointError('E_STRUCTURE', 'checkpointed static memory base (header 0x0E) is implausible: ' + staticBase);
    }
    if (umem.length !== staticBase) {
        throw new CheckpointError('E_STRUCTURE', 'UMem chunk length (' + umem.length + ') disagrees with the checkpointed static memory base (' + staticBase + '): the payload quetzal is not an uncompressed autosave memory image');
    }
    if (expected.storyBytes) {
        const storyStaticBase = (expected.storyBytes[0x0E] << 8) | expected.storyBytes[0x0F];
        if (umem[0] !== expected.storyBytes[0] || staticBase !== storyStaticBase) {
            throw new CheckpointError('E_STRUCTURE', 'checkpointed header (version ' + umem[0] + ', static base ' + staticBase + ') disagrees with the trusted story file header (version ' + expected.storyBytes[0] + ', static base ' + storyStaticBase + ')');
        }
    }
    const version = umem[0];
    if (version < 1 || version > 8) {
        throw new CheckpointError('E_STRUCTURE', 'checkpointed story version byte (UMem[0]) is not a Z-machine version: ' + version);
    }

    // Text buffer.  Continuation writes cover [bufaddr+1, bufaddr+1+len]
    // with len <= rd.buffer.length, so the buffer object plus its worst-case
    // continuation must fit writable dynamic memory exactly:
    //   bufaddr >= 0x40 and bufaddr + rd.buffer.length + 2 <= staticBase.
    // (bufaddr + len + 2 <= staticBase subsumes any 24-bit address-space
    // overflow: staticBase <= 0xFFFF and the pre-digest range check bounds
    // bufaddr to 24 bits, and Number arithmetic here is exact.)
    if (rd.bufaddr < 0x40) {
        throw new CheckpointError('E_BOUNDARY', 'line readData.bufaddr (' + rd.bufaddr + ') lies outside writable dynamic memory [0x40, ' + staticBase + ')');
    }
    if (rd.bufaddr + rd.buffer.length + 2 > staticBase) {
        throw new CheckpointError('E_BOUNDARY', 'line readData text-buffer continuation span (bufaddr ' + rd.bufaddr + ' + ' + rd.buffer.length + ' + 2 bytes) overflows writable dynamic memory (static base ' + staticBase + ')');
    }
    // Capacity tie: the buffer array was sized from memory[bufaddr] at
    // opcode issue, so its length must equal the checkpointed capacity byte
    // (minus the v1-4 zero terminator).  A disagreement means the payload's
    // sections describe different states.
    const capByte = umem[rd.bufaddr];
    if (rd.buffer.length !== (version < 5 ? capByte - 1 : capByte)) {
        throw new CheckpointError('E_STRUCTURE', 'readData.buffer length (' + rd.buffer.length + ') disagrees with the checkpointed capacity byte at bufaddr (' + capByte + ')');
    }

    // Parse table.  parseaddr = 0 is the documented sentinel (the fixture's
    // parser always passes a table; other stories may not).  Continuation
    // writes cover [parseaddr+1, parseaddr+1+4*maxWords] with
    // maxWords <= UMem[parseaddr]:
    //   parseaddr >= 0x40 and parseaddr + 2 + 4*UMem[parseaddr] <= staticBase.
    if (rd.parseaddr !== 0) {
        // The typed text is written BEFORE tokenise re-reads the parse
        // capacity (io.js handle_line_input -> text.js tokenise): a parse
        // table inside the text write span would have its capacity byte
        // inflated by the response itself, so the validated capacity is not
        // the effective capacity and the parse writes could exceed the
        // validated span (review finding F2).  Genuine captures keep the
        // buffer objects disjoint; parseaddr = bufaddr itself stays safe
        // (the byte it names is the text buffer's own capacity byte, which
        // the text write never overwrites).
        if (rd.parseaddr >= rd.bufaddr + 1 && rd.parseaddr <= rd.bufaddr + 1 + rd.buffer.length) {
            throw new CheckpointError('E_BOUNDARY', 'line readData.parseaddr (' + rd.parseaddr + ') lies inside the text-buffer continuation write span [bufaddr+1, bufaddr+1+' + rd.buffer.length + ']: the response would inflate the parse capacity byte before tokenise reads it');
        }
        if (rd.parseaddr < 0x40 || rd.parseaddr >= staticBase) {
            throw new CheckpointError('E_BOUNDARY', 'line readData.parseaddr (' + rd.parseaddr + ') lies outside writable dynamic memory [0x40, ' + staticBase + ')');
        }
        const capWords = umem[rd.parseaddr];
        if (rd.parseaddr + 2 + 4 * capWords > staticBase) {
            throw new CheckpointError('E_BOUNDARY', 'line readData parse-table continuation span (parseaddr ' + rd.parseaddr + ' + 2 + 4 x ' + capWords + ' entries) overflows writable dynamic memory (static base ' + staticBase + ')');
        }
    }
}

// Deep validation of the nested io state restore consumes: a missing or
// malformed stream entry or window-selector field faults the continuation
// only when the next input arrives, so it must be rejected here, before any
// interpreter is constructed (review findings on PR #37: `io: {}` passed
// validation and then threw on `streams[2]` mid-turn; `streams[3] = [null]`
// passed and threw on `streams[3][0][1] += text` in _print after readiness).
//
// Slot semantics from the vendored runtime (src/zvm/io.js, initialized as
// `streams: [ 0, 1, {}, [], {} ]`): slot 0 = input stream (0 = keyboard,
// otherwise a live Glk stream reference), slot 1 = screen-stream flag,
// slot 2 = transcript state object, slot 3 = the memory-output-stream stack
// (output_stream 3), slot 4 = command-recording state object.
function validateIo(io) {
    const int = (name, lo, hi) => {
        if (!Number.isInteger(io[name]) || io[name] < lo || io[name] > hi) {
            throw new CheckpointError('E_STRUCTURE', 'io.' + name + ' must be an integer in [' + lo + ', ' + hi + ']');
        }
    };
    for (const name of ['reverse', 'bold', 'italic', 'mono', 'transcript']) int(name, 0, 255);
    int('bg', -1, 255);
    int('fg', -1, 255);
    int('currentwin', 0, 1);
    int('height', 0, 255);
    int('glkheight', 0, 255);
    int('maxheight', 0, 255);
    int('seenheight', 0, 255);
    int('width', 0, 255);
    int('row', 0, 1023);
    int('col', 0, 1023);
    const s = io.streams;
    if (!Array.isArray(s) || s.length !== 5) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams must be the 5-slot stream table');
    }
    if (s[0] !== 0) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[0] (input stream) must be 0 (keyboard): redirected input holds a live Glk stream reference the data-only envelope cannot carry');
    }
    if (s[1] !== 0 && s[1] !== 1) throw new CheckpointError('E_STRUCTURE', 'io.streams[1] (screen stream) must be 0 or 1');
    validateStreamState(2, 'transcript', s[2]);
    // Slot 3 is a stack of pending [tableAddress, text] memory-stream writes:
    // _print appends to streams[3][0][1] and output_stream -3 writes the text
    // back to VM memory (io.js).  No supported boundary carries pending stack
    // entries (the fixture never selects output_stream 3) and the write-back
    // path has no round-trip evidence, so nonempty stacks are rejected as an
    // unsupported surface instead of being accepted and faulting on the next
    // print.
    if (!Array.isArray(s[3])) throw new CheckpointError('E_STRUCTURE', 'io.streams[3] (memory-output-stream stack) must be an array');
    if (s[3].length > 0) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[3] (memory-output-stream stack) must be empty: pending output_stream 3 memory writes are unsupported in schema v2');
    }
    validateStreamState(4, 'command recording', s[4]);
}

// Transcript (slot 2) and command-recording (slot 4) state objects start as
// `{}` and gain {mode, cache, str} fields when the story uses output_stream
// 2/4.  mode 2 routes text to an open Glk FILE stream held in `.str` -- a
// live host object a data-only envelope cannot serialize -- so both the
// reference and the mode are rejected (glk-file-streams is declared
// unsupported).  mode 1 caches plain strings and survives the clone.
function validateStreamState(slot, label, st) {
    if (!isPlainObject(st)) throw new CheckpointError('E_STRUCTURE', 'io.streams[' + slot + '] (' + label + ') must be an object');
    if (st.str !== undefined) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[' + slot + '] (' + label + ') carries an open Glk stream reference: file-backed ' + label + ' is unsupported in the data-only envelope');
    }
    if (st.mode !== undefined && (!Number.isInteger(st.mode) || st.mode < 0 || st.mode > 2)) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[' + slot + '] (' + label + ') mode must be an integer 0..2');
    }
    if (st.mode === 2) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[' + slot + '] (' + label + ') is in mode 2 (open Glk file stream): unsupported in the data-only envelope');
    }
    if (st.cache !== undefined && (typeof st.cache !== 'string' || st.cache.length > CAPS.outputChars)) {
        throw new CheckpointError('E_STRUCTURE', 'io.streams[' + slot + '] (' + label + ') cache must be a string within the output cap');
    }
}

// Window entries: the main window is required (continuation output targets
// it, and the transcript consistency check reads it); upper/status may be
// null for versions/States that never opened them, but when present each
// must be well-formed (review finding: `windows.main: null` passed and the
// continuation silently lost the captured transcript prefix).
function validateWindows(windows) {
    const one = (name, entry) => {
        if (entry === null) return;
        if (!isPlainObject(entry)
            || typeof entry.text !== 'string' || entry.text.length > CAPS.outputChars
            || !Number.isInteger(entry.cursorX) || entry.cursorX < 0 || entry.cursorX > 1023
            || !Number.isInteger(entry.cursorY) || entry.cursorY < 0 || entry.cursorY > 1023
            || !Number.isInteger(entry.rock) || entry.rock < 0 || entry.rock > 0x7FFFFFFF) {
            throw new CheckpointError('E_STRUCTURE', 'windows.' + name + ' must be null or {text, cursorX, cursorY, rock}');
        }
    };
    if (windows.main === null || windows.main === undefined) {
        throw new CheckpointError('E_STRUCTURE', 'windows.main is required (the transcript consistency check and restored output depend on it)');
    }
    one('main', windows.main);
    one('upper', windows.upper === undefined ? null : windows.upper);
    one('status', windows.status === undefined ? null : windows.status);
    for (const [role, rock] of [['main', 201], ['upper', 203], ['status', 202]]) {
        if (windows[role] && windows[role].rock !== rock) {
            throw new CheckpointError('E_WINDOW_TOPOLOGY', 'windows.' + role + ' does not match its pinned shim rock');
        }
    }
}

module.exports = {
    FORMAT,
    SCHEMA_VERSION,
    SUPPORTED_BOUNDARIES,
    RUNTIME_NAME,
    CAPS,
    CheckpointError,
    sha256Hex,
    cloneJson,
    canonicalEnvelopeString,
    quetzalUmem,
    validateEnvelope,
};
