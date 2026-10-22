'use strict';
// Negative tests and error isolation (Issue #11 task section 6): malformed
// and unsupported inputs under bounded execution.  Every case runs in a
// FRESH adapter instance (or a fresh child process) so no output or state
// can mix between runs, every case is bounded by an explicit timeout, and
// nothing is asserted to have "successfully loaded" unless it actually did.
//
// The ifvms adapter runs in-process; its boundary is ZVM's own error
// handling (fatal_error via the Glk shim) plus the adapter's try/catch.
// The harness does NOT claim that in-process isolation or worker isolation
// would be a security sandbox -- that is documented as a limitation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIfvmsAdapter } = require('../adapters/ifvms-adapter.js');
const { createBocfelAdapter, probeBocfelAvailable } = require('../adapters/bocfel-adapter.js');

const VM_IO_DIR = __dirname;
const REPO_ROOT = path.dirname(path.dirname(path.dirname(VM_IO_DIR)));
const FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'fixture.z5');
const LOOPSTORY = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'negative', 'loopstory.z5');
const TAMPER_DIR = path.join(REPO_ROOT, 'experiments', 'vm-io', 'results', 'tmp-negative');

const bocfelAvailable = probeBocfelAvailable();

// Tampered story variants are written only under whitelisted fixed basenames
// inside the contained tmp-negative directory, with containment re-verified
// on the resolved target.
const TAMPER_BASENAMES = [
    'empty.z5',
    'trunc-header.z5',
    'version9.z5',
    'version0.z5',
    'truncated.z5',
    'badlength.z5',
];

const TAMPER_PRODUCERS = {
    'empty.z5': () => Buffer.alloc(0),
    'trunc-header.z5': (src) => src.subarray(0, 16),
    'version9.z5': (src) => { const b = Buffer.from(src); b[0] = 9; return b; },
    'version0.z5': (src) => { const b = Buffer.from(src); b[0] = 0; return b; },
    'truncated.z5': (src) => src.subarray(0, Math.floor(src.length / 2)),
    'badlength.z5': (src) => { const b = Buffer.from(src); b.writeUInt16BE(0xFFFF, 0x1A); return b; },
};

function writeTampered(fileName) {
    if (!TAMPER_BASENAMES.includes(fileName)) {
        throw new Error('non-whitelisted tamper file: ' + fileName);
    }
    fs.mkdirSync(TAMPER_DIR, { recursive: true });
    const dirResolved = path.resolve(TAMPER_DIR);
    const target = path.resolve(dirResolved, fileName);
    if (target !== dirResolved && !target.startsWith(dirResolved + path.sep)) {
        throw new Error('tamper path escaped the temp directory: ' + fileName);
    }
    fs.writeFileSync(target, TAMPER_PRODUCERS[fileName](fs.readFileSync(FIXTURE)));
    return target;
}

function clearTampered() {
    fs.rmSync(TAMPER_DIR, { recursive: true, force: true });
}

// ---- ifvms (in-process) malformed-story cases -------------------------------

function startExpectError(label, buffer, match) {
    const adapter = createIfvmsAdapter(buffer);
    const r = adapter.start();
    assert.strictEqual(r.status, 'error', label + ' must be classified as error, not a successful load');
    assert.ok(r.errors.length > 0, label + ' produced a recorded error');
    if (match) assert.match(r.errors.join(' | '), match, label + ' error is classifiable');
    return r;
}

test('ifvms: empty binary is rejected without a successful load', { timeout: 30000 }, () => {
    // Observed: the empty buffer faults inside file.identify (RangeError)
    // rather than reaching the friendly "not a Z-Code file" message; either
    // way the load is classified as an error.
    startExpectError('empty', Buffer.alloc(0), /not a Z-Code|offset|rangeerror/i);
});

test('ifvms: truncated header (16 bytes) is rejected', { timeout: 30000 }, () => {
    startExpectError('trunc-header', fs.readFileSync(FIXTURE).subarray(0, 16));
});

test('ifvms: unsupported version byte 9 is rejected', { timeout: 30000 }, () => {
    // Observed: ifvms's file.identify rejects the version before the VM's own
    // version check, so the classification message is "not a Z-Code file".
    startExpectError('version9', (() => {
        const b = Buffer.from(fs.readFileSync(FIXTURE));
        b[0] = 9;
        return b;
    })(), /not a Z-Code|unsupported/i);
});

test('ifvms: version byte 0 is rejected', { timeout: 30000 }, () => {
    startExpectError('version0', (() => {
        const b = Buffer.from(fs.readFileSync(FIXTURE));
        b[0] = 0;
        return b;
    })());
});

test('ifvms: half-truncated valid fixture does not run unbounded', { timeout: 30000 }, () => {
    const full = fs.readFileSync(FIXTURE);
    startExpectError('truncated', full.subarray(0, Math.floor(full.length / 2)));
});

test('ifvms: inconsistent header file length is bounded and classified', { timeout: 30000 }, () => {
    // Z-machine header 0x1A holds the story-file length divided by 2 for v5.
    // Writing 0xFFFF makes it inconsistent with the actual bytes.
    // OBSERVED ifvms behavior (validation gap, recorded as evidence): the
    // header length field is not validated and the story loads normally.
    // The harness requirement is a bounded, classified result and never a
    // claim that invalid input was validated -- the run record shows the
    // tolerated load explicitly.
    const adapter = createIfvmsAdapter((() => {
        const b = Buffer.from(fs.readFileSync(FIXTURE));
        b.writeUInt16BE(0xFFFF, 0x1A);
        return b;
    })());
    const r = adapter.start();
    assert.ok(['waiting_for_line_input', 'error', 'halted'].includes(r.status), 'bounded classification, got: ' + r.status);
    assert.strictEqual(r.status, 'waiting_for_line_input', 'ifvms tolerates an inconsistent header length (validation gap)');
    assert.strictEqual(r.errors.length, 0);
});

// ---- ifvms behavioral negatives ---------------------------------------------

test('ifvms: parser rejection of an unknown command consumes no turn', { timeout: 30000 }, () => {
    const a = createIfvmsAdapter(fs.readFileSync(FIXTURE));
    a.start();
    const r = a.send({ kind: 'line', text: 'xyzzy frobnicate' });
    assert.match(r.delta, /pardon|not a verb/i, 'parser rejected the command');
    assert.ok(!/\[F06:turn=\d+\]/.test(r.delta), 'no turn consumed by the parser rejection');
    assert.strictEqual(r.status, 'waiting_for_line_input', 'game continues accepting input');
});

test('ifvms: runaway recursion terminates with a classified error, not a hang', { timeout: 60000 }, () => {
    const story = fs.readFileSync(LOOPSTORY);
    const a = createIfvmsAdapter(story);
    const r = a.start();
    assert.strictEqual(r.status, 'error', 'stack exhaustion is classified as error');
    assert.ok(r.errors.length > 0);
});

// ---- bocfel cases (skip when the interpreter is not resolvable) --------------

if (bocfelAvailable) {
    test('bocfel: empty binary exits nonzero without hanging', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(writeTampered('empty.z5'));
        const r = await a.start();
        assert.strictEqual(r.status, 'error');
        await a.shutdown();
    });

    test('bocfel: unsupported version byte 9 exits nonzero without hanging', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(writeTampered('version9.z5'));
        const r = await a.start();
        assert.strictEqual(r.status, 'error');
        await a.shutdown();
    });

    test('bocfel: truncated valid fixture exits nonzero without hanging', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(writeTampered('truncated.z5'));
        const r = await a.start();
        assert.strictEqual(r.status, 'error');
        await a.shutdown();
    });

    test('bocfel: inconsistent header file length is bounded and classified', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(writeTampered('badlength.z5'));
        const r = await a.start();
        assert.ok(r.status === 'error' || r.status === 'halted', 'recorded status: ' + r.status);
        await a.shutdown();
    });

    test('bocfel: a natural-language line fed at the menu boundary uses only its first character', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(FIXTURE);
        await a.start();
        await a.send({ kind: 'line', text: 'menu' });
        const r = await a.send({ kind: 'line', text: 'hello' });
        assert.ok(r.delta.includes('[F07:menu-key=104]'), 'first character h (ZSCII 104) reached read_char');
        assert.ok(r.delta.includes('[F07:menu-choice=other]'));
        await a.shutdown();
    });

    test('bocfel: runaway recursion terminates with a classified error, not a hang', { timeout: 60000 }, async () => {
        const a = createBocfelAdapter(LOOPSTORY);
        const r = await a.start();
        assert.strictEqual(r.status, 'error', 'stack exhaustion is classified as error');
        await a.shutdown();
    });

    test('bocfel: cleanup tampered story files', () => {
        clearTampered();
    });
} else {
    test('bocfel negative suite', { skip: 'bocfel non-Glk binary not resolvable (see experiments/vm-io/README.md)' }, () => {});
}

if (!bocfelAvailable) {
    // Still clean up any stray directory from a previous run.
    clearTampered();
}
