'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInstance, line, key, drive, capture, FIXTURE, RUNNER,
    STORY, STORY_SHA256, REVISION, machineFingerprint } = require('./helpers.js');
const { sha256Hex, validateEnvelope, CheckpointError } = require('../lib/checkpoint-format.js');
const { rngStory } = require('../test-support/rng-story.cjs');

const CHILD = path.resolve(__dirname, '../test-support/rng-child.cjs');
const LOW = 0, HIGH = 0.9999999999999999;
const PREFIX = [line('seed 42')];
const RESTART = [line('restart'), line('yes')];
const SUFFIX = [line('roll'), line('look')];
const clean = value => { const result = structuredClone(value); delete result.undoDepth; return result; };

function scratch(t) {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'zirp-issue46-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(dir)), root);
        assert.ok(path.basename(dir).startsWith('zirp-issue46-'));
        assert.equal(fs.realpathSync(dir), dir);
        fs.rmSync(dir, { recursive: true });
    });
    return dir;
}
function write(file, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    fs.writeFileSync(file, bytes);
    assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), bytes);
    return file;
}
function processRun(script, args, input) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [script, ...args], {
        input, encoding: 'utf8', env, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, 'spawn/timeout error');
    assert.equal(result.signal, null, 'child reaped without signal');
    assert.equal(result.stderr, '', 'child stderr');
    return result;
}
function child(request) {
    const result = processRun(CHILD, [], JSON.stringify(request));
    assert.equal(result.status, 0, 'test scaffold exited cleanly');
    const record = JSON.parse(result.stdout);
    assert.deepEqual(record.fingerprint.errors, []);
    assert.deepEqual(record.finalFingerprint.errors, []);
    for (const step of [...record.steps, ...record.suffixSteps]) {
        assert.notEqual(step.status, 'error');
        assert.deepEqual(step.errors, []);
        assert.deepEqual(step.unexpectedGlk, []);
    }
    return record;
}
function baseline(dir) {
    const adapter = createInstance(); adapter.start(); drive(adapter, PREFIX);
    const envelope = capture(adapter);
    const file = write(path.join(dir, 'baseline.json'), envelope);
    const json = fs.readFileSync(file, 'utf8');
    const fingerprint = machineFingerprint(adapter);
    return { adapter, envelope, file, unchanged() {
        assert.equal(JSON.stringify(capture(adapter)), json);
        assert.equal(fs.readFileSync(file, 'utf8'), json);
        assert.deepEqual(machineFingerprint(adapter), fingerprint);
    } };
}

test('restart returns to unseeded mode: capture rejects and controlled continuations diverge', t => {
    const dir = scratch(t), base = baseline(dir);
    const runs = [LOW, HIGH].map(entropy => child({ story: FIXTURE,
        checkpoint: base.file, entropy, inputs: [...RESTART, line('roll')] }));
    for (const [index, run] of runs.entries()) {
        assert.equal(run.fingerprint.rngSeed, 0);
        assert.equal(run.captureError.code, 'E_RNG');
        assert.equal(run.envelope, null);
        assert.equal(run.startupHostDraws, 100, 'discarded fresh-restore startup');
        assert.deepEqual(run.stepHostDraws, [0, 100, 1], 'confirmation restarts library; roll draws once');
        assert.equal(run.hostDraws, 201);
        assert.match(run.steps.at(-1).delta, new RegExp('\\[F08:roll=' + (index ? 6 : 1) + '\\]'));
    }
    const restarted = createInstance(); restarted.start(); drive(restarted, [...PREFIX, ...RESTART]);
    assert.equal(restarted.inspect().rngSeed, 0);
    assert.throws(() => capture(restarted), e => e instanceof CheckpointError && e.code === 'E_RNG');
    base.unchanged();
    const control = createInstance(); control.start(); drive(control, [...PREFIX, ...SUFFIX]);
    drive(base.adapter, SUFFIX);
    assert.deepEqual(machineFingerprint(base.adapter), machineFingerprint(control));
});

test('ordinary runner refuses restart serialization: failure exit and no new checkpoint', t => {
    const dir = scratch(t), base = baseline(dir), out = path.join(dir, 'rejected.json');
    const requests = [...RESTART.map(input => ({ input })), { op: 'serialize' }, { op: 'exit' }];
    const result = processRun(RUNNER, ['--story', FIXTURE, '--checkpoint', base.file, '--out', out],
        requests.map(value => JSON.stringify(value)).join('\n') + '\n');
    assert.equal(result.status, 4);
    const messages = result.stdout.trim().split('\n').map(text => JSON.parse(text));
    assert.equal(messages[0].ready, true);
    assert.ok(messages.some(message => message.failed === true && /cannot checkpoint an unseeded/.test(message.error)));
    assert.ok(!messages.some(message => message.serialized === true));
    assert.equal(fs.existsSync(out), false);
    base.unchanged();
});

test('mid-turn host entropy survives reseeding: turn replay differs, each final snapshot recovers', t => {
    const dir = scratch(t), story = rngStory();
    assert.equal(story[0], 5);
    assert.equal(sha256Hex(story), 'a9a43f42442e897ceb4d35fd56ac33e15b50f71cccd4d295ac4fe09abdd9b39d');
    const storyFile = write(path.join(dir, 'entropy.z5'), story);
    const initial = child({ story: storyFile, entropy: LOW });
    assert.equal(initial.hostDraws, 0);
    assert.equal(initial.captureError, null);
    assert.equal(initial.envelope.payload.rng.seed, -42);
    assert.equal(initial.envelope.identity.storySha256, sha256Hex(story));
    assert.notEqual(sha256Hex(story), STORY_SHA256);
    const source = write(path.join(dir, 'initial.json'), initial.envelope);
    const runs = [LOW, HIGH].map(entropy => child({ story: storyFile, checkpoint: source,
        entropy, inputs: [key('x')], suffix: [key('y')] }));
    for (const [index, run] of runs.entries()) {
        assert.equal(run.hostDraws, 1);
        assert.equal(run.captureError, null, 'current capture accepts a reseeded final boundary');
        assert.equal(run.envelope.payload.rng.seed, -42);
        assert.equal(run.steps[0].delta, (index ? '6' : '1') + '\n');
        const file = write(path.join(dir, 'final-' + index + '.json'), run.envelope);
        const restored = child({ story: storyFile, checkpoint: file, entropy: index ? LOW : HIGH,
            suffix: [key('y')] });
        assert.equal(restored.hostDraws, 0, 'seeded snapshot continuation uses no host entropy');
        assert.deepEqual(restored.envelope, run.envelope, 'whole envelope recaptured');
        assert.deepEqual(restored.suffixSteps, run.suffixSteps);
        assert.deepEqual(clean(restored.finalFingerprint), clean(run.finalFingerprint));
        assert.equal(restored.finalFingerprint.quit, true);
    }
    assert.notEqual(runs[0].fingerprint.ramSha256, runs[1].fingerprint.ramSha256);
    assert.notEqual(runs[0].fingerprint.globalsSha256, runs[1].fingerprint.globalsSha256);
    assert.notEqual(runs[0].fingerprint.output, runs[1].fingerprint.output);
    assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), initial.envelope);
});

test('parent-only publication requires complete seeded recovery evidence, not step output or exit alone', t => {
    const dir = scratch(t), base = baseline(dir);
    const store = write(path.join(dir, 'published.json'), { revision: 0, output: 'baseline' });
    const before = fs.readFileSync(store);
    // This is a fixture-allowlisted TEST gate, not a generic entropy detector
    // or production coordinator. No child receives the store path.
    function publish(inputs, corrupt = false) {
        const candidate = child({ story: FIXTURE, checkpoint: base.file, entropy: LOW, inputs });
        assert.ok(candidate.steps.some(step => step.delta.length > 0), 'candidate produced speculative output');
        assert.deepEqual(fs.readFileSync(store), before, 'steps do not publish');
        if (candidate.captureError) return false;
        const envelope = structuredClone(candidate.envelope);
        if (corrupt) envelope.integrity.envelopeSha256 = '0'.repeat(64);
        try { validateEnvelope(envelope, { storySha256: STORY_SHA256, storySize: STORY.length,
            storyBytes: STORY, runtimeRevision: REVISION }); }
        catch (error) { assert.equal(error.code, 'E_DIGEST'); return false; }
        const file = write(path.join(dir, 'candidate.json'), envelope);
        const recovered = child({ story: FIXTURE, checkpoint: file, entropy: HIGH, suffix: SUFFIX });
        const control = child({ story: FIXTURE, checkpoint: base.file, entropy: LOW, inputs, suffix: SUFFIX });
        for (const run of [candidate, recovered, control]) {
            assert.equal(run.startupHostDraws, 100, 'transient startup entropy is not turn replay evidence');
            assert.ok(run.stepHostDraws.every(count => count === 0), 'qualified turn draws are seeded');
            assert.equal(run.suffixHostDraws, 0);
            assert.equal(run.hostDraws, 100);
        }
        assert.deepEqual(recovered.envelope, envelope);
        assert.deepEqual(recovered.suffixSteps, control.suffixSteps);
        assert.deepEqual(clean(recovered.finalFingerprint), clean(control.finalFingerprint));
        base.unchanged();
        write(store, { revision: 1, output: envelope.payload.publishedOutput });
        return true;
    }
    assert.equal(publish(RESTART), false);
    assert.deepEqual(fs.readFileSync(store), before); base.unchanged();
    assert.equal(publish([line('roll')], true), false);
    assert.deepEqual(fs.readFileSync(store), before); base.unchanged();
    assert.equal(publish([line('roll')]), true);
    assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).revision, 1);
    assert.notDeepEqual(fs.readFileSync(store), before); base.unchanged();
});
