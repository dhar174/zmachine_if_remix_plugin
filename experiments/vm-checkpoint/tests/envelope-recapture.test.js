'use strict';

// Issue #45: compare whole v2 envelopes at the same seeded input boundary,
// and prove a line -> child 1 -> char -> child 2 continuation against a
// separate uninterrupted reference. These are fixture-scoped probe tests;
// undo history is not present in the envelope and remains unsupported.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    createInstance, line, key, drive, capture, spawnRestore, awaitExit,
    machineFingerprint,
} = require('./helpers.js');
const { canonicalEnvelopeString } = require('../lib/checkpoint-format.js');

const PREFIX = [line('seed 42'), line('roll'), line('look')];
const STARTUP = '[F01:startup=7]';

function makeTempDir() {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'zirp-issue45-'));
    assert.equal(path.dirname(dir), root);
    assert.ok(path.basename(dir).startsWith('zirp-issue45-'));
    return { root, dir };
}

function removeTempDir(temp) {
    // Only remove the unique directory made by makeTempDir, directly under
    // the resolved OS temp root; never follow a computed path elsewhere.
    assert.equal(path.dirname(path.resolve(temp.dir)), temp.root);
    assert.ok(path.basename(temp.dir).startsWith('zirp-issue45-'));
    assert.equal(fs.realpathSync(temp.dir), temp.dir);
    fs.rmSync(temp.dir, { recursive: true });
}

function makeBaseline(prefix) {
    const adapter = createInstance();
    adapter.start();
    drive(adapter, prefix);
    const envelope = capture(adapter);
    return {
        adapter,
        envelope,
        json: JSON.stringify(envelope),
        fingerprint: machineFingerprint(adapter),
    };
}

function writeCheckpoint(file, json) {
    fs.writeFileSync(file, json);
    assert.ok(fs.existsSync(file), 'checkpoint exists');
    assert.equal(fs.readFileSync(file, 'utf8'), json, 'checkpoint bytes read back');
}

function assertBaseline(baseline, file, label) {
    assert.equal(JSON.stringify(capture(baseline.adapter)), baseline.json,
        label + ': live baseline envelope changed');
    assert.deepEqual(machineFingerprint(baseline.adapter), baseline.fingerprint,
        label + ': live baseline fingerprint changed');
    assert.equal(fs.readFileSync(file, 'utf8'), baseline.json,
        label + ': original checkpoint file changed');
}

function assertPending(fingerprint, kind, label) {
    const tail = fingerprint.requestLog.at(-1);
    assert.ok(tail, label + ': pending request exists');
    assert.equal(tail.request, kind, label + ': exact pending input kind');
    assert.equal(tail.answeredWith, null, label + ': request is unanswered');
}

function assertFingerprint(reference, candidate, label) {
    // Undo is absent from the envelope and dropped at restore. No other
    // fingerprint field, including RNG seed and request history, is excluded.
    assert.ok(candidate.undoDepth <= reference.undoDepth, label + ': unsupported undo depth');
    assert.deepEqual({ ...candidate, undoDepth: undefined },
        { ...reference, undoDepth: undefined }, label + ': fingerprint');
}

function canonicalWhole(envelope) {
    // The checksum helper normally excludes the top-level integrity member.
    // Nesting the entire envelope makes integrity, unknown fields, every
    // payload section and all array entries part of this canonical comparison.
    return canonicalEnvelopeString({ envelope });
}

function assertWholeEnvelope(actualJson, expected, label) {
    const actual = JSON.parse(actualJson);
    // Make the comparison non-vacuous: this fixture has visible main and
    // upper windows, cursor coordinates, pending input and a seeded RNG.
    for (const name of ['main', 'upper']) {
        const window = actual.payload.windows[name];
        assert.ok(window && typeof window.text === 'string' && window.text.length > 0,
            label + ': visible ' + name + ' window');
        assert.ok(Number.isInteger(window.cursorX) && Number.isInteger(window.cursorY),
            label + ': ' + name + ' cursor coordinates');
    }
    assert.ok(Array.isArray(actual.payload.io.streams), label + ': I/O streams exist');
    assert.ok(Object.hasOwn(actual.payload.readData, 'storer'), label + ': pending read data exists');
    assert.ok(actual.payload.publishedOutput.output.length > 0, label + ': transcript is visible');
    assert.ok(actual.payload.publishedOutput.gridOutput.length > 0, label + ': grid is visible');
    assert.equal(actual.payload.rng.mode, 'seeded', label + ': seeded RNG mode');
    assert.ok(Number.isInteger(actual.payload.rng.seed) && actual.payload.rng.seed !== 0,
        label + ': seeded RNG state exists');
    assert.equal(canonicalWhole(actual), canonicalWhole(expected), label + ': canonical complete envelope');
    assert.equal(actualJson, JSON.stringify(expected), label + ': byte-identical JSON');
    assert.deepEqual(actual.payload.windows, expected.payload.windows, label + ': window text/cursor state');
    assert.deepEqual(actual.payload.io, expected.payload.io, label + ': complete I/O state');
    assert.deepEqual(actual.payload.readData, expected.payload.readData, label + ': pending read data');
    assert.deepEqual(actual.payload.publishedOutput, expected.payload.publishedOutput, label + ': transcript/grid');
    assert.deepEqual(actual.payload.rng, expected.payload.rng, label + ': seeded RNG state');
    assert.equal(actual.payload.undo.preserved, false, label + ': undo history is unsupported');
    return actual;
}

function snapshotStep(step) {
    const { status, delta, output, gridOutput, requestLog, errors, unexpectedGlk } = step;
    // Freeze the request history before the reference accepts another input.
    return JSON.parse(JSON.stringify({ status, delta, output, gridOutput, requestLog, errors, unexpectedGlk }));
}

function count(text, marker) {
    return text.split(marker).length - 1;
}

async function request(child, message) {
    // Register before writing so a quick response cannot be lost.
    const pending = child.nextMessage(30000);
    child.child.stdin.write(JSON.stringify(message) + '\n');
    return pending;
}

async function withChild(checkpoint, out, operation) {
    const child = spawnRestore(checkpoint, { out });
    const closed = new Promise((resolve) => child.child.once('close', (code, signal) => resolve({ code, signal })));
    try {
        await child.run([]);
        assert.ok(child.ready, 'fresh child restored: ' + (child.readyError || ''));
        assert.equal(child.readyError, null);
        assert.notEqual(child.child.pid, process.pid, 'restore used a child process');
        const value = await operation(child);
        assert.equal(await child.finish(), 0, 'child clean exit');
        const final = await closed;
        assert.deepEqual(final, { code: 0, signal: null }, 'child closed and was reaped');
        assert.equal(child.stderr, '', 'child stderr is empty');
        return value;
    } finally {
        if (child.child.exitCode === null && child.child.signalCode === null) child.child.kill();
        await awaitExit(child, 10000);
        await closed;
    }
}

for (const item of [
    { kind: 'line', prefix: PREFIX },
    { kind: 'char', prefix: [...PREFIX, line('menu')] },
]) {
    test('immediate fresh-child recapture preserves the entire seeded ' + item.kind + ' envelope',
        { timeout: 120000 }, async () => {
            const temp = makeTempDir();
            try {
                const baseline = makeBaseline(item.prefix);
                assert.equal(baseline.envelope.boundary.kind, item.kind);
                assert.equal(baseline.envelope.payload.rng.mode, 'seeded');
                assertPending(baseline.fingerprint, item.kind, 'baseline');
                const src = path.join(temp.dir, 'baseline.json');
                const out = path.join(temp.dir, 'recaptured.json');
                writeCheckpoint(src, baseline.json);
                assertBaseline(baseline, src, 'before candidate');

                await withChild(src, out, async (child) => {
                    assertPending(child.readyFingerprint, item.kind, 'restored');
                    assertFingerprint(baseline.fingerprint, child.readyFingerprint, 'restored boundary');
                    const response = await request(child, { op: 'serialize' });
                    assert.deepEqual(response, { serialized: true });
                    assert.ok(fs.existsSync(out), 'child wrote recaptured checkpoint');
                    assertWholeEnvelope(fs.readFileSync(out, 'utf8'), baseline.envelope, item.kind);
                });
                assertBaseline(baseline, src, 'after candidate');
            } finally {
                removeTempDir(temp);
            }
        });
}

test('two sequential fresh children preserve line-to-char continuation and the baseline',
    { timeout: 180000 }, async () => {
        const temp = makeTempDir();
        try {
            const baseline = makeBaseline(PREFIX);
            const src = path.join(temp.dir, 'baseline.json');
            const charPath = path.join(temp.dir, 'char.json');
            const finalPath = path.join(temp.dir, 'final.json');
            writeCheckpoint(src, baseline.json);
            assert.equal(baseline.envelope.boundary.kind, 'line');
            assertPending(baseline.fingerprint, 'line', 'baseline');
            assertBaseline(baseline, src, 'before first child');

            // This reference is never restored; freeze its result at each step.
            const reference = createInstance();
            reference.start();
            drive(reference, PREFIX);
            const expectedMenu = snapshotStep(reference.send(line('menu')));
            const charFingerprint = machineFingerprint(reference);

            // Separate capture oracle at the same char boundary, so the
            // uninterrupted reference itself need not be serialized mid-run.
            const charOracle = makeBaseline([...PREFIX, line('menu')]);
            assert.equal(charOracle.envelope.boundary.kind, 'char');
            assertPending(charFingerprint, 'char', 'reference menu');

            await withChild(src, charPath, async (first) => {
                assertPending(first.readyFingerprint, 'line', 'first child');
                assertFingerprint(baseline.fingerprint, first.readyFingerprint, 'first ready');
                const response = await request(first, { input: line('menu') });
                assert.ok(response.step, 'menu produced a step');
                assert.deepEqual(response.step, expectedMenu, 'menu output, grid and events match reference');
                assert.equal(response.step.status, 'waiting_for_character_input');
                assert.equal(count(response.step.delta, '[F07:menu-open]'), 1);
                assertPending({ requestLog: response.step.requestLog }, 'char', 'first child menu');
                const fp = await request(first, { op: 'fingerprint' });
                assertFingerprint(charFingerprint, fp.fingerprint, 'first child at char boundary');
                const saved = await request(first, { op: 'serialize' });
                assert.deepEqual(saved, { serialized: true });
                assert.ok(fs.existsSync(charPath), 'first child wrote second checkpoint');
                const recaptured = assertWholeEnvelope(fs.readFileSync(charPath, 'utf8'), charOracle.envelope,
                    'first child char boundary');
                assert.equal(recaptured.boundary.kind, 'char');
            });
            assertBaseline(baseline, src, 'after first child');

            // The first child has closed before the second is spawned. The
            // second sees only the first child's serialized char checkpoint.
            await withChild(charPath, finalPath, async (second) => {
                assertPending(second.readyFingerprint, 'char', 'second child');
                assertFingerprint(charFingerprint, second.readyFingerprint, 'second ready');
                assert.equal(second.readyFingerprint.output, expectedMenu.output, 'no startup transcript republished');
                assert.equal(second.readyFingerprint.gridOutput, expectedMenu.gridOutput, 'ready grid preserved');
                for (const input of [key('b'), line('roll'), line('look')]) {
                    const expected = snapshotStep(reference.send(input));
                    const response = await request(second, { input });
                    assert.ok(response.step, 'continuation produced a step');
                    assert.deepEqual(response.step, expected, 'per-step output, grid and events match reference');
                    assert.equal(response.step.errors.length, 0);
                    assert.deepEqual(response.step.unexpectedGlk, []);
                    assert.equal(count(response.step.delta, STARTUP), 0, 'startup not replayed in delta');
                    if (input.kind === 'char') {
                        assert.equal(count(response.step.delta, '[F07:menu-key=98]'), 1);
                        assert.equal(count(response.step.delta, '[F07:menu-choice=beta]'), 1);
                    }
                    if (input.kind === 'line' && input.text === 'roll') {
                        assert.match(response.step.delta, /\[F08:roll=\d+\]/, 'seeded draw is visible');
                    }
                }
                const expectedFingerprint = machineFingerprint(reference);
                const fp = await request(second, { op: 'fingerprint' });
                assertFingerprint(expectedFingerprint, fp.fingerprint, 'final child');
                assert.equal(fp.fingerprint.rngSeed, expectedFingerprint.rngSeed, 'final RNG seed');
                assert.equal(count(fp.fingerprint.output, STARTUP), 1, 'startup appears exactly once');
                assert.equal(count(fp.fingerprint.output, '[F07:menu-open]'), 1, 'menu opened exactly once');
                assert.equal(count(fp.fingerprint.output, '[F07:menu-choice=beta]'), 1, 'choice delivered exactly once');
                assertPending(fp.fingerprint, 'line', 'final child');
                const expectedFinal = capture(reference);
                const saved = await request(second, { op: 'serialize' });
                assert.deepEqual(saved, { serialized: true });
                assert.ok(fs.existsSync(finalPath), 'second child wrote final checkpoint');
                assertWholeEnvelope(fs.readFileSync(finalPath, 'utf8'), expectedFinal, 'final line boundary');
            });
            assertBaseline(baseline, src, 'after both children');
        } finally {
            removeTempDir(temp);
        }
    });
