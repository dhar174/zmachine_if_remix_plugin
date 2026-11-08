'use strict';

// The v2 probe contract is local implementation data, never imported
// authority.  Source fingerprints identify these particular checkout bytes;
// they are not signatures or proof that the code is trustworthy.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REVISION } = require('../../vm-io/adapters/ifvms-adapter.js');

const SCHEMA_VERSION = 2;
const RUNTIME_NAME = 'ifvms.js ZVM';
const ADAPTER_NAME = 'ifvms-adapter';
const EXPERIMENTS_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = 'vm-io/vendor/ifvms/src';
const ADAPTER_FILES = [
    'vm-io/adapters/ifvms-adapter.js',
    'vm-io/glksim.js',
    'vm-checkpoint/lib/checkpoint-contract.js',
    'vm-checkpoint/lib/checkpoint-core.js',
    'vm-checkpoint/lib/checkpoint-format.js',
    'vm-checkpoint/lib/fingerprint.js',
    'vm-checkpoint/lib/runner.js',
    'vm-checkpoint/lib/transport-limits.js',
];

function sourceFiles(relativeDirectory) {
    const result = [];
    for (const item of fs.readdirSync(path.join(EXPERIMENTS_ROOT, relativeDirectory), { withFileTypes: true })) {
        const relative = relativeDirectory + '/' + item.name;
        if (item.isDirectory()) result.push(...sourceFiles(relative));
        else if (item.isFile() && item.name.endsWith('.js')) result.push(relative);
        else if (item.isSymbolicLink()) throw new Error('symlink in pinned runtime source tree: ' + relative);
    }
    return result;
}

function digest(data) {
    return createHash('sha256').update(data).digest('hex');
}

function sourceDigest(files) {
    const inventory = files.slice().sort().map((relative) => ({
        path: relative,
        sha256: digest(fs.readFileSync(path.join(EXPERIMENTS_ROOT, relative))),
    }));
    return digest(JSON.stringify(inventory));
}

// Snapshot the on-disk sources at module initialization, before capture or
// restore. The experiment assumes this checkout is not changed while its
// process is running; this does not attest Node, the OS, or in-process code.
const IMPLEMENTATION = Object.freeze({
    runtime: RUNTIME_NAME,
    runtimeRevision: REVISION,
    runtimeBuildSha256: sourceDigest(sourceFiles(RUNTIME_ROOT)),
    adapter: ADAPTER_NAME,
    adapterBuildSha256: sourceDigest(ADAPTER_FILES),
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
});

function implementationIdentity() {
    return { ...IMPLEMENTATION };
}

// A received description is checked against this implementation-owned value;
// it never grants permissions or capabilities by itself.
function capabilityStatement() {
    return {
        coverage: {
            experimentalTransport: 'runner: story 4 MiB, checkpoint JSON 32 MiB UTF-8 / 32 Mi UTF-16 units, request line 64 KiB, input 8 MiB, stdout record 8 MiB / total 32 MiB, diagnostic reserve 1 KiB; parents retain stderr up to 64 KiB. Bounds apply after synchronous VM execution/JSON encoding; no allocation quota or sandbox (#49/#30)',
            dynamicMemory: 'serialized (Quetzal UMem)',
            pc: 'serialized (Quetzal IFhd/Stks)',
            callFramesAndStacks: 'serialized (Quetzal Stks, in-use region)',
            storyIdentity: 'serialized (Quetzal IFhd release/serial/checksum) + envelope story digest',
            interpreterHeaderFields: 'serialized (header block [0x00..0x40) written back verbatim after restore_file; update_header() recomputation is window-set-dependent and must not stand in for the source values)',
            rng: 'seeded mode only (xorshift seed serialized and re-applied after restore_file); unseeded capture and restore are REJECTED with E_RNG -- host Math.random state can be neither captured nor reconstructed (bridge section 8), and Issue #12 requires unsupported modes to fail explicitly',
            ioStreamsAndFlags: 'serialized (plain-data clone); the input stream must be keyboard (slot 0 = 0) and the memory-output-stream stack (slot 3) must be empty — pending output_stream 3 writes, file-backed transcript/command streams (mode 2 / open Glk references), and redirected input are rejected at capture and validation with E_STRUCTURE',
            pendingInput: 'serialized (read_data + re-issued Glk request); line-continuation buffer addresses and spans are validated against the checkpointed dynamic-memory layout (static base, buffer/parse capacity bytes, trusted story header) before any interpreter is constructed -- out-of-range or overflowing continuation spans are rejected with E_BOUNDARY, capacity inconsistencies with E_STRUCTURE (Issue #41)',
            windowTextAndCursor: 'serialized for matching pinned main/upper/status roles only; selector/rock relations checked at capture/validation; saved versus fresh window presence checked after startup and native restore, before restored input/readiness (E_WINDOW_TOPOLOGY); no general window recreation or real geometry restoration',
            publishedTranscript: 'serialized (buffer + grid window text)',
            jittedCodeCache: 'not serialized: fresh-start JIT/decoded-text entries survive native restore; later entries are lazy. Immutable code/text controls pass; mutable dictionary and diagnostic dynamic-code histories can diverge despite equal envelopes. Alphabet/Unicode tables are startup-derived; abbreviation lookup reads restored RAM. Mutable cache dependencies are unsupported, not generally detected (#47; #20/#21)',
            stackViews: 'reconstructed (make_stacks rebuilds s/l from the stack buffer)',
            interpreterNumberVersionHeader: 'unsupported (vendored ZVM never writes them)',
            undoHistory: 'unsupported (dropped on restore, upstream autosave semantics)',
            timedInput: 'unsupported (upstream stores read_data.time/routine but never schedules them; Flags1 timed-input bit clear); either nonzero operand is rejected at capture and restore with E_TIMED_INPUT',
            sound: 'unsupported (upstream no-op opcodes)',
            graphics: 'unsupported (no picture opcode support in vendored ZVM)',
            glkFileStreams: 'unsupported (glksim records them as unexpected)',
            memoryOutputStreams: 'unsupported (pending output_stream 3 stack writes rejected: the [address, text] write-back path has no round-trip evidence in the experimental envelope)',
            redirectedInputStream: 'unsupported (input_stream redirection holds a live Glk stream reference the data-only envelope cannot carry)',
        },
        unsupported: ['timed-input', 'sound', 'graphics', 'glk-file-streams', 'undo-history', 'interpreter-number-version', 'unseeded-rng', 'memory-output-stream-writes', 'redirected-input', 'mutable-cache-dependencies', 'window-topology-mismatch', 'real-window-geometry'],
        schemaVersion: SCHEMA_VERSION,
    };
}

module.exports = { SCHEMA_VERSION, RUNTIME_NAME, ADAPTER_NAME, implementationIdentity, capabilityStatement };
