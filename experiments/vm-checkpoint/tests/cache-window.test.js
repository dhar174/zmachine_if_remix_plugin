'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('../test-support/bounded-sync.cjs');
const { createIfvmsAdapter, REVISION } = require('../../vm-io/adapters/ifvms-adapter.js');
const { captureCheckpoint, restoreCheckpoint } = require('../lib/checkpoint-core.js');
const { machineFingerprint } = require('../lib/fingerprint.js');
const { validateEnvelope, canonicalEnvelopeString, sha256Hex } = require('../lib/checkpoint-format.js');
const { makeStory, observe, digest } = require('../test-support/state-support.cjs');
const CHILD = path.resolve(__dirname, '../test-support/state-child.cjs');
const RUNNER = path.resolve(__dirname, '../lib/runner.js');
const key = value => ({ kind: 'char', key: value });
const clone = value => JSON.parse(JSON.stringify(value));
const withoutUndo = value => { const copy = clone(value); delete copy.undoDepth; return copy; };
const PINS = {
    immutable: '2e79fefca777f53bed70b97ef46d808d1fa4cf39316080b9ab94235ccc09cf67',
    dictionary: '44b414727437240fd052c5bf3270b7d247ac0feda9ef2f7f656fc509fa2d8529',
    abbreviation: 'd471cb6d73f2974778d6e91204ac371928680ceb5da7a6100ec76acba8bb0dbb',
    alphabet: '2d6f2c361c1ae86360164a3c11c5b8c62f2585e1c72dc41e1fe5493faa64617f',
    unicode: '0d93562b7e3608bbd5d074c13dc50c3013c975a408a543c7312a8eab70eea7ca',
    'dynamic-code': '2a315b02268a281c2a777ea4a321f29c2c01ed6fbe521e6515aa8dda30f35dd1',
    'late-upper': '827e275de3b5946b4175a1f2bcf0fb8d21df891f1f9b306c8344ee90c10f8a5a',
    'removed-upper': '006e50898a563812a0b9a7b70bc54c7c3bd4b07c80687eb0394010aaccf3192b',
    'selected-upper': '0681a6c8caf24a73ade9792a720567d2489ec0e7adbd6481cd6cb4c04974142a',
    'resize-grow': 'c9df7ff0461ec63374312c7ee736f486bb60bd9c42d7b6e6c8ca086796f6b261',
    'resize-reopen': 'e5f6024dc932366a394d1ad309da0c27ab2cc4479c1095a1b43c40df226bc718',
};

function scratch(t) {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'zirp-issue47-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(dir)), root);
        assert.ok(path.basename(dir).startsWith('zirp-issue47-'));
        assert.equal(fs.realpathSync(dir), dir);
        fs.rmSync(dir, { recursive: true });
    });
    return dir;
}
function write(file, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    fs.writeFileSync(file, bytes); assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), bytes);
    return file;
}
function run(script, args, input) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [script, ...args], {
        input, encoding: 'utf8', env, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    return result;
}
function restored(c, suffix) {
    const result = run(CHILD, [], JSON.stringify({ story: c.storyFile, checkpoint: c.file, suffix }));
    assert.equal(result.status, 0, result.stdout);
    const record = JSON.parse(result.stdout);
    assert.equal(record.ready, true); assert.equal(record.captureError, null);
    assert.deepEqual(record.fingerprint.errors, []); assert.deepEqual(record.finalFingerprint.errors, []);
    for (const step of record.suffixSteps) { assert.deepEqual(step.errors, []); assert.deepEqual(step.unexpectedGlk, []); }
    return record;
}
function prepare(t, kind, prefix = [key('x')]) {
    const dir = scratch(t), story = makeStory(kind);
    assert.equal(digest(story), PINS[kind]); assert.equal(story.length, 4096);
    const storyFile = write(path.join(dir, 'story.z5'), story);
    const adapter = createIfvmsAdapter(Buffer.from(story));
    adapter.start(); for (const input of prefix) adapter.send(input);
    const context = { storySha256: digest(story), storySize: story.length };
    const capture = () => captureCheckpoint(adapter, context);
    const envelope = capture(), json = JSON.stringify(envelope);
    const fingerprint = machineFingerprint(adapter), metadata = observe(adapter);
    assert.deepEqual(fingerprint.errors, []);
    const file = write(path.join(dir, 'baseline.json'), envelope);
    return { dir, story, storyFile, adapter, context, capture, envelope, file, metadata, unchanged() {
        assert.equal(JSON.stringify(capture()), json);
        assert.equal(fs.readFileSync(file, 'utf8'), json);
        assert.deepEqual(machineFingerprint(adapter), fingerprint);
        assert.deepEqual(observe(adapter), metadata);
    } };
}
function reference(c, suffix) {
    const steps = suffix.map(input => clone(c.adapter.send(input)));
    for (const step of steps) { assert.deepEqual(step.errors, []); assert.deepEqual(step.unexpectedGlk, []); }
    return { steps, fingerprint: machineFingerprint(c.adapter), metadata: observe(c.adapter) };
}
function exactRecovery(c, result, control) {
    assert.deepEqual(result.envelope, c.envelope, 'complete immediate recapture, no excluded envelope fields');
    assert.deepEqual(result.suffixSteps, control.steps, 'exact continuation output/events');
    assert.deepEqual(withoutUndo(result.finalFingerprint), withoutUndo(control.fingerprint));
    assert.deepEqual(result.state.windows, c.metadata.windows);
    assert.deepEqual(result.state.io, c.metadata.io);
    assert.deepEqual(result.finalState.windows, control.metadata.windows);
    assert.deepEqual(result.finalState.io, control.metadata.io);
    assert.equal(result.state.stackViewsShareBuffer, true);
}

for (const prefix of [[], [key('x')]]) {
    test('immutable code/text: ' + (prefix.length ? 'warm' : 'cold') + ' cache recovers exactly', t => {
        const c = prepare(t, 'immutable', prefix);
        const suffix = prefix.length ? [key('y')] : [key('x'), key('y')];
        const result = restored(c, suffix); c.unchanged();
        assert.equal(result.state.jit.some(([addr]) => addr === 0xd20), false, 'fresh startup did not decode later text');
        assert.equal(c.metadata.jit.some(([addr, type]) => addr === 0xd20 && type === 'string'), !!prefix.length);
        assert.equal(result.state.jit.some(([addr]) => addr === 0xe01), false, 'later routine is cold after restore');
        assert.equal(c.metadata.jit.some(([addr, type]) => addr === 0xe01 && type === 'function'), !!prefix.length);
        exactRecovery(c, result, reference(c, suffix));
    });
}

test('unsupported mutable custom dictionary: same envelope can hide divergent cache history', t => {
    const c = prepare(t, 'dictionary'), result = restored(c, [key('y')]); c.unchanged();
    assert.deepEqual(result.envelope, c.envelope);
    assert.ok(c.metadata.dictionaries.includes(0x600));
    assert.ok(!result.state.dictionaries.includes(0x600));
    assert.equal(c.metadata.dictionaryWord, 0x268c); assert.equal(result.state.dictionaryWord, 0x268c);
    const control = reference(c, [key('y')]);
    assert.equal(control.steps[0].delta, '1540\n', 'source retains cached cat at 0x604');
    assert.equal(result.suffixSteps[0].delta, '0\n', 'fresh child parses mutated dog and cannot find cat');
    assert.notEqual(result.finalFingerprint.ramSha256, control.fingerprint.ramSha256);
});

test('mutable abbreviation target: cached text thunk reads restored table at use time', t => {
    const c = prepare(t, 'abbreviation'), result = restored(c, [key('y')]); c.unchanged();
    assert.equal(c.metadata.abbreviation0, 0xd22 / 2);
    assert.ok(result.state.jit.some(([addr, type]) => addr === 0xd40 && type === 'object'));
    assert.equal(result.suffixSteps[0].delta, 'b');
    exactRecovery(c, result, reference(c, [key('y')]));
});

for (const [kind, ram, cached, expected] of [
    ['alphabet', 'alphabetRam', 'alphabet0', 'a'], ['unicode', 'unicodeRam', 'unicode155', 'A'],
]) {
    test('unsupported mutable ' + kind + ': matching continuation reuses stale startup lookup', t => {
        const c = prepare(t, kind), result = restored(c, [key('y')]); c.unchanged();
        assert.equal(c.metadata[ram], kind === 'alphabet' ? 98 : 66);
        assert.equal(c.metadata[cached], kind === 'alphabet' ? 97 : 'A');
        assert.equal(result.state[ram], c.metadata[ram]);
        assert.equal(result.state[cached], c.metadata[cached]);
        assert.equal(result.suffixSteps[0].delta, expected, 'lookup was not rebuilt from modified RAM');
        exactRecovery(c, result, reference(c, [key('y')]));
        // Exact continuation is NOT proof that mutable text-table semantics
        // are supported: the uninterrupted runtime also keeps the old table.
    });
}

test('diagnostic dynamic-code stress: source JIT survives mutation, fresh child compiles changed bytes', t => {
    const c = prepare(t, 'dynamic-code'), result = restored(c, [key('y')]); c.unchanged();
    assert.deepEqual(result.envelope, c.envelope);
    assert.equal(c.metadata.dynamicOpcode, 0xb1);
    assert.ok(c.metadata.jit.some(([addr, type]) => addr === 0x701 && type === 'function'));
    assert.ok(!result.state.jit.some(([addr]) => addr === 0x701));
    const control = reference(c, [key('y')]);
    assert.equal(control.steps[0].delta, '1\n'); assert.equal(result.suffixSteps[0].delta, '0\n');
    assert.notEqual(result.finalFingerprint.globalsSha256, control.fingerprint.globalsSha256);
});

for (const kind of ['late-upper', 'removed-upper']) {
    test(kind + ': ordinary runner rejects saved/fresh topology mismatch before readiness', t => {
        const c = prepare(t, kind), out = path.join(c.dir, 'must-not-exist.json');
        assert.equal(!!c.envelope.payload.windows.upper, kind === 'late-upper');
        const result = run(RUNNER, ['--story', c.storyFile, '--checkpoint', c.file, '--out', out],
            '{"op":"serialize"}\n{"op":"exit"}\n');
        assert.equal(result.status, 2, result.stdout);
        const messages = result.stdout.trim().split('\n').map(JSON.parse);
        assert.equal(messages.length, 1); assert.equal(messages[0].ready, false);
        assert.equal(messages[0].code, 'E_WINDOW_TOPOLOGY');
        assert.equal(fs.existsSync(out), false); c.unchanged();
    });
}

for (const kind of ['resize-reopen']) {
    test(kind + ': headless windows, cursors, selectors and continuation remain exact', t => {
        const prefix = [key('x')];
        const suffix = [key('y'), key('z')];
        const c = prepare(t, kind, prefix), result = restored(c, suffix); c.unchanged();
        assert.ok(c.metadata.windows.upper.text.length > 0);
        assert.equal(c.metadata.windows.upper.parentIsMain, true);
        assert.equal(c.metadata.windows.upper.type, 4);
        assert.equal(c.metadata.io.height, 1);
        exactRecovery(c, result, reference(c, suffix));
    });
}

test('selected-upper input: existing transcript consistency gate refuses capture (not qualified recovery)', t => {
    const dir = scratch(t), story = makeStory('selected-upper');
    assert.equal(digest(story), PINS['selected-upper']);
    write(path.join(dir, 'story.z5'), story);
    const adapter = createIfvmsAdapter(Buffer.from(story)); adapter.start();
    const before = machineFingerprint(adapter), metadata = observe(adapter);
    const { state } = adapter.__g1bInternals();
    assert.equal(metadata.io.currentwin, 1);
    assert.equal(metadata.windows.upper.text, 'U\n'); assert.equal(state.gridOutput, 'U');
    assert.throws(() => captureCheckpoint(adapter, { storySha256: digest(story), storySize: story.length }),
        error => error.code === 'E_STRUCTURE' && /grid transcript/.test(error.message));
    assert.deepEqual(machineFingerprint(adapter), before); assert.deepEqual(observe(adapter), metadata);
});

test('existing-upper growth: missing shim stream API faults before a capturable boundary', t => {
    const dir = scratch(t), story = makeStory('resize-grow');
    assert.equal(digest(story), PINS['resize-grow']);
    const file = write(path.join(dir, 'story.z5'), story);
    const result = run(CHILD, [], JSON.stringify({ story: file, inputs: [key('x')] }));
    // The pinned VM still logs this handled fault. Issue #49's diagnostic
    // scaffold preserves it as bounded JSON data, rather than protocol noise.
    assert.equal(result.status, 0, 'diagnostic scaffold records the handled VM fault');
    const record = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(record.vmDiagnostics.length, 1);
    assert.match(record.vmDiagnostics[0], /^TypeError: Glk\.glk_window_get_stream is not a function\n/);
    assert.match(record.vmDiagnostics[0], /at newClass\.split_window/);
    assert.equal(record.steps[0].status, 'error');
    assert.equal(record.captureError.code, 'E_NOT_AT_BOUNDARY'); assert.equal(record.envelope, null);
    assert.match(record.fingerprint.errors.join('\n'), /glk_window_get_stream/);
});

test('guard scaffolding: invalid selector/role relations reject; malformed fields remain E_STRUCTURE', t => {
    const c = prepare(t, 'immutable', []);
    const expected = { storySha256: digest(c.story), storySize: c.story.length,
        storyBytes: c.story, runtimeRevision: REVISION };
    for (const [name, mutate, code] of [
        ['selected-missing-upper', e => { e.payload.io.currentwin = 1; }, 'E_WINDOW_TOPOLOGY'],
        ['wrong-main-rock', e => { e.payload.windows.main.rock = 999; }, 'E_WINDOW_TOPOLOGY'],
        ['malformed-rock', e => { e.payload.windows.main.rock = '201'; }, 'E_STRUCTURE'],
    ]) {
        const envelope = clone(c.envelope); mutate(envelope);
        envelope.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(envelope));
        assert.throws(() => validateEnvelope(envelope, expected), error => error.code === code, name);
        const file = write(path.join(c.dir, name + '.json'), envelope);
        const result = run(RUNNER, ['--story', c.storyFile, '--checkpoint', file], '{"op":"exit"}\n');
        assert.equal(result.status, 2);
        const boot = JSON.parse(result.stdout); assert.equal(boot.ready, false); assert.equal(boot.code, code);
        c.unchanged();
    }
    const { vm } = c.adapter.__g1bInternals();
    const original = vm.mainwin.type;
    try {
        vm.mainwin.type = 4;
        assert.throws(c.capture, error => error.code === 'E_WINDOW_TOPOLOGY');
    } finally { vm.mainwin.type = original; }
    c.unchanged();
});

test('guard scaffolding: topology is rechecked after native restore changes window handles', t => {
    const c = prepare(t, 'removed-upper', []);
    const vm = c.adapter.__g1bInternals().vm;
    const prototype = Object.getPrototypeOf(vm), original = prototype.restore_file;
    let calls = 0;
    t.mock.method(prototype, 'restore_file', function (...args) {
        const result = original.apply(this, args);
        calls++;
        this.upperwin = null; // deterministic stand-in for native topology change
        return result;
    });
    assert.throws(() => restoreCheckpoint(c.envelope, c.story),
        error => error.code === 'E_WINDOW_TOPOLOGY');
    assert.equal(calls, 1, 'the real native restore ran before the guard');
    t.mock.restoreAll(); c.unchanged();
});
