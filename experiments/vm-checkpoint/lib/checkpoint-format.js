'use strict';
// ==============================================================================
// checkpoint-format.js -- the G1-B experimental checkpoint envelope
// ------------------------------------------------------------------------------
// Probe code for Issue #12, not a production format.  The envelope is a
// versioned, DATA-ONLY JSON document: executable code is never serialized
// (the ZVM JIT cache is deliberately excluded; it is rebuilt on demand), and
// restore validates the whole envelope before any interpreter is touched.
//
// Envelope v1 layout (see docs/evidence/g1-vm-recovery.md for the full
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
//   integrity                   -- sha256 over the canonical payload JSON
//   capabilities                -- coverage/unsupported declaration carried
//                                  with the data so a restored instance cannot
//                                  silently claim more than was proven
//
// Validation failures throw CheckpointError with a stable `code` so tests can
// assert the rejection reason (A34 evidence).
// ==============================================================================

const crypto = require('node:crypto');

const FORMAT = 'zirp-g1b-checkpoint';
const SCHEMA_VERSION = 1;
const SUPPORTED_BOUNDARIES = ['line', 'char', 'halted'];
const RUNTIME_NAME = 'ifvms.js ZVM';
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

function canonicalPayloadString(payload) {
    return JSON.stringify(payload);
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
    if (expected.storySha256 !== null && id.storySha256 !== expected.storySha256) {
        throw new CheckpointError('E_STORY', 'checkpoint story digest ' + id.storySha256 + ' does not match active story ' + expected.storySha256);
    }
    if (expected.storySize !== null && id.storySize !== expected.storySize) {
        throw new CheckpointError('E_STORY', 'checkpoint story size mismatch');
    }
    if (expected.runtimeRevision !== null && id.runtimeRevision !== expected.runtimeRevision) {
        throw new CheckpointError('E_RUNTIME', 'checkpoint runtime revision ' + id.runtimeRevision + ' does not match pinned ' + expected.runtimeRevision);
    }
    if (id.schema !== SCHEMA_VERSION) throw new CheckpointError('E_VERSION', 'identity.schema mismatch');

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
        throw new CheckpointError('E_STRUCTURE', 'undo disposition missing (undo is declared unsupported in schema v1)');
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
    if (!isPlainObject(integ) || typeof integ.payloadSha256 !== 'string') {
        throw new CheckpointError('E_STRUCTURE', 'integrity section missing');
    }
    const actual = sha256Hex(canonicalPayloadString(p));
    if (actual !== integ.payloadSha256) {
        throw new CheckpointError('E_DIGEST', 'payload digest mismatch: envelope says ' + integ.payloadSha256 + ', payload hashes to ' + actual);
    }

    // Cross-section consistency, checked only AFTER the payload digest
    // verifies (there is no point interpreting sections a tampered envelope
    // may have rewritten): the shim's published buffer-window text IS the
    // transcript (and the grid window's text is the grid transcript), so a
    // disagreement means the envelope's sections describe different states
    // and continuation would lose or republish text.
    if (p.publishedOutput.output !== p.windows.main.text) {
        throw new CheckpointError('E_STRUCTURE', 'published transcript disagrees with the main window text');
    }
    if (p.windows.upper ? p.publishedOutput.gridOutput !== p.windows.upper.text : p.publishedOutput.gridOutput !== '') {
        throw new CheckpointError('E_STRUCTURE', 'published grid transcript disagrees with the upper window text');
    }

    if (!isPlainObject(envelope.capabilities)) throw new CheckpointError('E_STRUCTURE', 'capabilities section missing');
    return true;
}

// Deep validation of the nested io state restore consumes: a missing or
// malformed stream entry or window-selector field faults the continuation
// only when the next input arrives, so it must be rejected here, before any
// interpreter is constructed (review finding on PR #37: `io: {}` passed
// validation and then threw on `streams[2]` mid-turn).
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
    if (s[0] !== 0 && s[0] !== 1) throw new CheckpointError('E_STRUCTURE', 'io.streams[0] (input stream 1 flag) must be 0 or 1');
    if (s[1] !== 0 && s[1] !== 1) throw new CheckpointError('E_STRUCTURE', 'io.streams[1] (screen stream flag) must be 0 or 1');
    if (!isPlainObject(s[2])) throw new CheckpointError('E_STRUCTURE', 'io.streams[2] (transcript) must be an object');
    if (!Array.isArray(s[3])) throw new CheckpointError('E_STRUCTURE', 'io.streams[3] (command log) must be an array');
    if (!isPlainObject(s[4])) throw new CheckpointError('E_STRUCTURE', 'io.streams[4] (memory-stream state) must be an object');
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
    canonicalPayloadString,
    validateEnvelope,
};
