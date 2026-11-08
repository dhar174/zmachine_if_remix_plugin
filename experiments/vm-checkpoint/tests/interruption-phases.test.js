'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInstance, line, capture, FIXTURE, RUNNER, STORY,
    STORY_SHA256, REVISION, machineFingerprint, fingerprintDiff } = require('./helpers.js');
const { validateEnvelope, sha256Hex } = require('../lib/checkpoint-format.js');
const { PHASES, spawnCandidate } = require('../test-support/interruption-support.cjs');
const PREFIX = ['look', 'seed 42', 'take brass key', 'north'].map(line);
const MUTATIONS = ['seed 7', 'roll', 'south', 'inventory'].map(line);
const SUFFIX = ['inventory', 'seed 42', 'roll', 'look'].map(line);
const copy = value => JSON.parse(JSON.stringify(value));
const fingerprintEqual = (control, actual) => assert.deepEqual(fingerprintDiff(control, actual), []);
const boundary = adapter => {
    const { state, vm } = adapter.__g1bInternals();
    return copy({ request: state.requestLog.at(-1), readData: vm.read_data });
};
function write(file, bytes) {
    fs.writeFileSync(file, bytes); assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes));
}
function reference(inputs) {
    const adapter = createInstance(); adapter.start();
    const steps = inputs.map(input => copy(adapter.send(input)));
    for (const step of steps) {
        assert.deepEqual(step.errors, []); assert.deepEqual(step.unexpectedGlk, []);
        assert.notEqual(step.status, 'error');
    }
    return { adapter, steps };
}
function setup(t) {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(tempRoot, 'zirp-issue48-'));
    const artifactDir = path.join(dir, 'candidate'); fs.mkdirSync(artifactDir);
    const sessions = [];
    t.after(async () => {
        // Cleanup must not remove a live child's files, even after a failed assertion.
        for (const session of sessions) {
            await session.terminate(); assert.ok(session.closed); assert.ok(session.exit);
        }
        assert.equal(path.dirname(path.resolve(dir)), tempRoot);
        assert.ok(path.basename(dir).startsWith('zirp-issue48-'));
        assert.equal(fs.realpathSync(dir), dir);
        fs.rmSync(dir, { recursive: true }); assert.equal(fs.existsSync(dir), false);
    });
    const live = reference(PREFIX).adapter, envelope = capture(live);
    const baselineBytes = Buffer.from(JSON.stringify(envelope));
    const baselineFile = path.join(dir, 'baseline.json'); write(baselineFile, baselineBytes);
    const fingerprint = machineFingerprint(live), pending = boundary(live);
    const candidateControl = reference([...PREFIX, ...MUTATIONS]);
    const expectedEnvelope = capture(candidateControl.adapter);
    const expectedBytes = Buffer.from(JSON.stringify(expectedEnvelope));
    const store = path.join(dir, 'published.json');
    const storeBytes = Buffer.from(JSON.stringify({ revision: 0, output: 'baseline publication' }));
    write(store, storeBytes);
    let publicationCalls = 0;
    const c = { dir, live, sessions, baselineFile, baselineBytes, fingerprint, pending,
        get publicationCalls() { return publicationCalls; },
        expectedEnvelope, expectedBytes, candidateControl, artifact: path.join(artifactDir, 'checkpoint.json'),
        start() {
            const config = { candidateId: path.basename(dir), story: FIXTURE, checkpoint: baselineFile,
                artifact: c.artifact, inputs: MUTATIONS };
            assert.ok(!Object.values(config).includes(store), 'publication path never sent');
            const session = spawnCandidate(config); sessions.push(session); return session;
        },
        unchanged() {
            assert.deepEqual(fs.readFileSync(baselineFile), baselineBytes);
            assert.equal(JSON.stringify(capture(live)), baselineBytes.toString());
            assert.deepEqual(machineFingerprint(live), fingerprint);
            assert.deepEqual(boundary(live), pending);
        },
        unpublished() {
            assert.equal(publicationCalls, 0); assert.deepEqual(fs.readFileSync(store), storeBytes);
        },
        continueBaseline() {
            const control = reference([...PREFIX, ...SUFFIX]);
            assert.deepEqual(SUFFIX.map(input => copy(live.send(input))), control.steps.slice(PREFIX.length));
            fingerprintEqual(machineFingerprint(control.adapter), machineFingerprint(live));
        },
        // Fixture-allowlisted TEST publication, not production authority,
        // idempotency, durable commit or a detector of arbitrary unsafe state.
        publish(session, beforePublication = () => true) {
            c.unpublished(); c.unchanged();
            if (!session.closed || session.closed.code !== 0 || session.closed.signal
                || session.fault || session.stderr || session.phases.length !== PHASES.length
                || !session.records.some(record => record.type === 'finished')) return { eligible: false, reason: 'child' };
            const envelope = JSON.parse(fs.readFileSync(c.artifact, 'utf8'));
            try { validateEnvelope(envelope, { storyBytes: STORY, storySha256: STORY_SHA256,
                storySize: STORY.length, runtimeRevision: REVISION }); }
            catch (error) { return { eligible: false, reason: error.code }; }
            assert.deepEqual(envelope, expectedEnvelope);
            const recapture = path.join(artifactDir, 'recaptured.json');
            const response = runner(c.artifact, [{ op: 'serialize' }, ...SUFFIX.map(input => ({ input })),
                { op: 'fingerprint' }, { op: 'exit' }], recapture);
            assert.equal(response.status, 0); assert.equal(response.messages[0].ready, true);
            assert.equal(response.messages.filter(message => message.serialized === true).length, 1);
            assert.deepEqual(JSON.parse(fs.readFileSync(recapture, 'utf8')), envelope);
            const control = reference([...PREFIX, ...MUTATIONS, ...SUFFIX]);
            assert.deepEqual(response.messages.filter(message => message.step).map(message => message.step),
                control.steps.slice(PREFIX.length + MUTATIONS.length).map(slim));
            fingerprintEqual(machineFingerprint(control.adapter), response.messages.at(-1).fingerprint);
            c.unpublished(); c.unchanged();
            // This is a parent barrier AFTER clean child exit, not a kill.
            if (!beforePublication()) return { eligible: true, published: false };
            publicationCalls++;
            const publication = { revision: 1, output: envelope.payload.publishedOutput };
            write(store, JSON.stringify(publication));
            assert.equal(publicationCalls, 1); assert.notDeepEqual(fs.readFileSync(store), storeBytes);
            assert.deepEqual(JSON.parse(fs.readFileSync(store, 'utf8')), publication);
            return { eligible: true, published: true };
        },
    };
    return c;
}
function slim(step) {
    const { status, delta, output, gridOutput, requestLog, errors, unexpectedGlk } = step;
    return { status, delta, output, gridOutput, requestLog, errors, unexpectedGlk };
}
function runner(checkpoint, requests, out) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const args = [RUNNER, '--story', FIXTURE, '--checkpoint', checkpoint];
    if (out) args.push('--out', out);
    const result = spawnSync(process.execPath, args, { input: requests.map(value => JSON.stringify(value)).join('\n') + '\n',
        encoding: 'utf8', env, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, '');
    return { status: result.status, messages: result.stdout.trim().split('\n').map(JSON.parse) };
}
async function reach(c, session, target) {
    for (const phase of PHASES) {
        const record = await session.phase(phase);
        assert.equal(record.seq, PHASES.indexOf(phase) + 1);
        assert.equal(await session.phase(phase), record, 'early acknowledgments remain queued');
        if (phase === 'restored-boundary') {
            fingerprintEqual(c.fingerprint, record.evidence.fingerprint);
            assert.deepEqual(record.evidence.boundary, c.pending);
        }
        if (PHASES.indexOf(phase) >= PHASES.indexOf('mutation-complete')) {
            const privateOutput = await session.record('steps');
            assert.deepEqual(privateOutput.steps, c.candidateControl.steps.slice(PREFIX.length));
            assert.ok(privateOutput.steps.some(step => step.delta.length > 0));
            assert.ok(privateOutput.steps.some(step => step.delta.includes('[F08:roll=')));
            assert.notEqual(privateOutput.fingerprint.output, c.fingerprint.output);
            fingerprintEqual(machineFingerprint(c.candidateControl.adapter), privateOutput.fingerprint);
            assert.deepEqual(privateOutput.boundary, boundary(c.candidateControl.adapter));
        }
        if (phase === 'capture-complete' || phase === 'partial-write-complete' || phase === 'candidate-finished') {
            assert.equal(record.evidence.bytes, c.expectedBytes.length);
            assert.equal(record.evidence.sha256, sha256Hex(c.expectedBytes));
        }
        if (phase === 'partial-write-complete') {
            const n = Math.floor(c.expectedBytes.length / 2);
            assert.equal(record.evidence.written, n); assert.ok(n > 0 && n < c.expectedBytes.length);
            assert.deepEqual(fs.readFileSync(c.artifact), c.expectedBytes.subarray(0, n));
        } else if (phase === 'candidate-finished') {
            const finished = await session.record('finished'); assert.equal(finished.sha256, sha256Hex(c.expectedBytes));
            assert.deepEqual(fs.readFileSync(c.artifact), c.expectedBytes);
        } else { assert.equal(fs.existsSync(c.artifact), false); }
        c.unchanged(); c.unpublished();
        if (phase === target) return record;
        session.release(record);
    }
    assert.fail('unknown target phase');
}

for (const target of PHASES) {
    test('acknowledged interruption at ' + target + ' leaves baseline and publication unchanged', { timeout: 120000 }, async t => {
        const c = setup(t), session = c.start();
        await reach(c, session, target);
        assert.equal(session.exit, null, 'child is live at the acknowledged barrier');
        const closed = await session.terminate();
        assert.ok(closed.signal || closed.code !== 0, 'killed child did not exit cleanly');
        assert.deepEqual(session.exit, closed); assert.equal(session.stderr, ''); assert.equal(session.fault, null);
        if (target === 'partial-write-complete') {
            assert.deepEqual(fs.readFileSync(c.artifact), c.expectedBytes.subarray(0, Math.floor(c.expectedBytes.length / 2)));
            const out = path.join(c.dir, 'refused.json');
            const rejected = runner(c.artifact, [{ op: 'serialize' }, { op: 'exit' }], out);
            assert.equal(rejected.status, 2); assert.equal(rejected.messages.length, 1);
            assert.equal(rejected.messages[0].ready, false); assert.equal(rejected.messages[0].code, 'E_FORMAT');
            assert.equal(fs.existsSync(out), false);
        } else if (target === 'candidate-finished') {
            assert.deepEqual(fs.readFileSync(c.artifact), c.expectedBytes);
            validateEnvelope(JSON.parse(c.expectedBytes), { storyBytes: STORY, storySha256: STORY_SHA256,
                storySize: STORY.length, runtimeRevision: REVISION });
        } else { assert.equal(fs.existsSync(c.artifact), false); }
        assert.deepEqual(c.publish(session), { eligible: false, reason: 'child' });
        c.unchanged(); c.unpublished(); c.continueBaseline(); c.unpublished();
        t.diagnostic(JSON.stringify({ case: target, phases: session.phases.map(({ phase, seq }) => ({ phase, seq })),
            expectedFullBytes: c.expectedBytes.length, artifactBytes: fs.existsSync(c.artifact) ? fs.statSync(c.artifact).size : 0,
            artifactSha256: fs.existsSync(c.artifact) ? sha256Hex(fs.readFileSync(c.artifact)) : null,
            exit: session.exit, close: session.closed, privateRecords: session.records.map(record => record.type),
            baselineUnchanged: true, baselineContinuationEqual: true, publicationCalls: c.publicationCalls }));
    });
}

for (const outcome of ['cancel', 'publish', 'invalid-envelope']) {
    test('parent publication gate: ' + outcome, { timeout: 120000 }, async t => {
        const c = setup(t), session = c.start();
        const finished = await reach(c, session, 'candidate-finished');
        session.release(finished);
        assert.deepEqual(await session.close(), { code: 0, signal: null });
        assert.equal(session.stderr, ''); assert.equal(session.fault, null);
        if (outcome === 'invalid-envelope') {
            const mutant = JSON.parse(fs.readFileSync(c.artifact, 'utf8'));
            mutant.integrity.envelopeSha256 = '0'.repeat(64); write(c.artifact, JSON.stringify(mutant));
            assert.deepEqual(c.publish(session), { eligible: false, reason: 'E_DIGEST' }); c.unpublished();
        } else {
            let barriers = 0;
            assert.deepEqual(c.publish(session, () => {
                barriers++; assert.ok(session.closed); c.unpublished(); return outcome === 'publish';
            }), { eligible: true, published: outcome === 'publish' });
            assert.equal(barriers, 1);
            if (outcome === 'cancel') c.unpublished();
        }
        c.unchanged(); c.continueBaseline();
        t.diagnostic(JSON.stringify({ case: outcome, exit: session.exit, close: session.closed,
            phases: session.phases.map(record => record.phase), privateRecords: session.records.map(record => record.type),
            baselineUnchanged: true, baselineContinuationEqual: true, publicationCalls: c.publicationCalls }));
    });
}

test('barrier protocol refuses a release for the wrong sequence and closes the child', { timeout: 120000 }, async t => {
    const c = setup(t), session = c.start(); const record = await session.phase('startup-entered');
    session.child.send({ type: 'continue', candidateId: record.candidateId, phase: record.phase, seq: record.seq + 1 });
    assert.deepEqual(await session.close(), { code: 4, signal: null });
    assert.match(session.stderr, /^interruption scaffold: /);
    assert.equal(session.phases.length, 1); assert.equal(fs.existsSync(c.artifact), false);
    assert.deepEqual(c.publish(session), { eligible: false, reason: 'child' });
    c.unchanged(); c.unpublished(); c.continueBaseline();
});
