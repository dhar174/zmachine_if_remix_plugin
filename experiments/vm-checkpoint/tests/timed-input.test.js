'use strict';

// Issue #42: timed input is not implemented by the pinned runtime/shim.
// Exercise both capture and the ordinary restoring child with honest-digest
// mutations of real seeded fixture checkpoints, at both input boundaries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createInstance, line, key, drive, capture, writeEnvelope, runReference,
    spawnRestore, awaitExit, STORY, STORY_SHA256, REVISION,
    machineFingerprint, fingerprintDiff,
} = require('./helpers.js');
const { CheckpointError, canonicalPayloadString, sha256Hex, validateEnvelope } = require('../lib/checkpoint-format.js');

const EXPECTED = { storySha256: STORY_SHA256, storySize: STORY.length, runtimeRevision: REVISION, storyBytes: STORY };
const CASES = [
    { kind: 'line', prefix: [line('seed 42')], input: line('look') },
    { kind: 'char', prefix: [line('seed 42'), line('menu')], input: key('b') },
];
const ACTIVE = [
    ['time-only', { time: 10 }],
    ['routine-only', { routine: 1234 }],
    ['zero-time', { time: 0, routine: 1234 }],
    ['zero-routine', { time: 10, routine: 0 }],
    ['both', { time: 10, routine: 1234 }],
];

function baselineFor(c) {
    const adapter = createInstance();
    adapter.start();
    drive(adapter, c.prefix);
    const envelope = capture(adapter);
    assert.equal(envelope.boundary.kind, c.kind);
    return { adapter, envelope, json: JSON.stringify(envelope), fingerprint: machineFingerprint(adapter) };
}

function assertUnchanged(baseline, label) {
    assert.equal(JSON.stringify(capture(baseline.adapter)), baseline.json, label + ': baseline checkpoint changed');
    assert.deepEqual(fingerprintDiff(baseline.fingerprint, machineFingerprint(baseline.adapter)), [], label + ': baseline fingerprint changed');
}

function withTimerFields(adapter, fields, fn) {
    const rd = adapter.__g1bInternals().vm.read_data;
    const original = Object.getOwnPropertyDescriptors(rd);
    try {
        Object.assign(rd, fields);
        return fn();
    } finally {
        for (const name of ['time', 'routine']) {
            if (original[name]) Object.defineProperty(rd, name, original[name]);
            else delete rd[name];
        }
    }
}

function honestMutation(envelope, fields) {
    const result = JSON.parse(JSON.stringify(envelope));
    Object.assign(result.payload.readData, fields);
    result.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(result.payload));
    return result;
}

function expectCode(fn, code) {
    let error;
    try { fn(); } catch (caught) { error = caught; }
    assert.ok(error instanceof CheckpointError, 'expected a CheckpointError');
    assert.equal(error.code, code);
    return error.message;
}

for (const c of CASES) {
    test(c.kind + ': active timer operands fail at capture and in ordinary child restore', { timeout: 120000 }, async () => {
        const baseline = baselineFor(c);
        for (const [name, fields] of ACTIVE) {
            const label = c.kind + '-' + name;
            const captureMessage = withTimerFields(baseline.adapter, fields,
                () => expectCode(() => capture(baseline.adapter), 'E_TIMED_INPUT'));
            assertUnchanged(baseline, label + ' capture');

            const mutant = honestMutation(baseline.envelope, fields);
            const file = writeEnvelope(mutant, 'issue42-' + label + '.json');
            const child = spawnRestore(file);
            try {
                const boot = await child.nextMessage(30000);
                assert.equal(boot.ready, false, label + ': restore must reject before ready');
                assert.equal(boot.code, 'E_TIMED_INPUT');
                assert.equal(boot.error, captureMessage, label + ': capture and restore diagnostics differ');
                assert.equal(await awaitExit(child, 30000), 2);
                assert.equal(child.ready, false, label + ': a ready signal must never be published');
                assert.equal(child.stderr, '');
            } finally {
                child.child.kill();
                await awaitExit(child, 10000).catch(() => {});
            }
            assertUnchanged(baseline, label + ' restore');
        }
    });

    test(c.kind + ': absent or zero operands are accepted, malformed operands rejected', () => {
        const baseline = baselineFor(c);
        assert.ok(baseline.envelope.capabilities.unsupported.includes('timed-input'));
        assert.match(baseline.envelope.capabilities.coverage.timedInput, /E_TIMED_INPUT/);
        for (const fields of [{}, { time: 0 }, { routine: 0 }, { time: 0, routine: 0 }]) {
            const env = withTimerFields(baseline.adapter, fields, () => capture(baseline.adapter));
            assert.equal(validateEnvelope(env, EXPECTED), true);
        }
        for (const field of ['time', 'routine']) {
            for (const value of [null, -1, 1.5, '1', true]) {
                const fields = { [field]: value };
                const captureMessage = withTimerFields(baseline.adapter, fields,
                    () => expectCode(() => capture(baseline.adapter), 'E_STRUCTURE'));
                const restoreMessage = expectCode(() => validateEnvelope(honestMutation(baseline.envelope, fields), EXPECTED), 'E_STRUCTURE');
                assert.equal(restoreMessage, captureMessage);
                assertUnchanged(baseline, c.kind + ' malformed ' + field);
            }
        }
    });

    test(c.kind + ': explicit zero operands restore and continue like an uninterrupted run', { timeout: 120000 }, async () => {
        const baseline = baselineFor(c);
        const env = withTimerFields(baseline.adapter, { time: 0, routine: 0 }, () => capture(baseline.adapter));
        assert.equal(env.payload.readData.time, 0);
        assert.equal(env.payload.readData.routine, 0);
        const child = spawnRestore(writeEnvelope(env, 'issue42-' + c.kind + '-zero.json'));
        try {
            await child.run([c.input]);
            assert.equal(child.ready, true);
            assert.equal(child.readyError, null);
            const reference = runReference(c.prefix, [c.input]);
            assert.deepEqual(fingerprintDiff(reference.fingerprint, child.fingerprint), []);
            await child.finish();
            assert.equal(child.exitCode, 0);
            assert.equal(child.stderr, '');
        } finally {
            child.child.kill();
            await awaitExit(child, 10000).catch(() => {});
        }
        assertUnchanged(baseline, c.kind + ' zero continuation');
    });

    test(c.kind + ': the pinned runtime read method exposes timed operands to capture', () => {
        const baseline = baselineFor(c);
        const vm = baseline.adapter.__g1bInternals().vm;
        const rd = vm.read_data;
        if (c.kind === 'line') vm.read(rd.storer, rd.bufaddr, rd.parseaddr, 10, 1234);
        else vm.read_char(rd.storer, 1, 10, 1234);
        assert.equal(vm.read_data.time, 10);
        assert.equal(vm.read_data.routine, 1234);
        expectCode(() => capture(baseline.adapter), 'E_TIMED_INPUT');
    });
}
