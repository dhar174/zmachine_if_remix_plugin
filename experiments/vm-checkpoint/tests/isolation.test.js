'use strict';
// ==============================================================================
// isolation.test.js -- candidate discard, kill isolation, and hostile
// checkpoint rejection (G1-B probe, Issue #12 section 5; A15/A28/A34
// precursor evidence).
// ------------------------------------------------------------------------------
// Model: the BASELINE is a live in-parent interpreter at a captured
// checkpoint boundary.  Candidates are FRESH CHILD PROCESSES restored from
// the baseline's checkpoint file.  The baseline is invariant under every
// candidate outcome:
//   - re-capturing the baseline's checkpoint is byte-identical to the
//     original capture (no hidden state moved);
//   - the baseline's published transcript is unchanged;
//   - the baseline continues identically to a control run that never saw a
//     candidate (A15);
//   - killing a candidate during bootstrap, at the boundary, during the
//     serialization phase, or before the simulated publication boundary
//     cannot affect the baseline (A28 candidate-process half; durable-store
//     recovery belongs to #18/#21);
//   - malformed/hostile checkpoints are rejected in the child (exit nonzero)
//     with the baseline untouched (A34).
// The simulated publication store is a file ONLY the parent writes; child
// processes never receive its path (structural isolation, asserted
// behaviorally after every phase).
// ==============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
    createInstance, line, drive, capture, writeEnvelope,
    runReference, spawnRestore, awaitExit,
    machineFingerprint, fingerprintDiff, FIXTURE, SPINLOOP, RESULTS_DIR,
} = require('./helpers.js');

const BASE_PREFIX = [line('look'), line('take brass key'), line('north')];
const CANDIDATE_MUTATIONS = [line('seed 7'), line('roll'), line('south'), line('inventory')];
const BASELINE_SUFFIX = [line('inventory'), line('seed 42'), line('roll'), line('look')];
const STORE = path.join(RESULTS_DIR, 'publication-store.txt');

const STORE_CONTENT = 'published transcript store -- written only by the coordinator test\n';

function storeBytes() {
    return fs.existsSync(STORE) ? fs.readFileSync(STORE) : null;
}

function assertStoreUnchanged(context) {
    assert.deepStrictEqual(storeBytes(), Buffer.from(STORE_CONTENT), `publication store unchanged (${context})`);
}

function setUpStore() {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(STORE, STORE_CONTENT);
}

// The shared baseline fixture for this suite: a live interpreter at a
// captured boundary plus the byte-exact checkpoint envelope.
function makeBaseline() {
    const adapter = createInstance();
    adapter.start();
    drive(adapter, BASE_PREFIX);
    const fingerprint = machineFingerprint(adapter);
    const envelope = capture(adapter);
    const envelopeJson = JSON.stringify(envelope);
    return { adapter, fingerprint, envelope, envelopeJson };
}

function assertBaselineUnchanged(baseline, context) {
    const recaptured = capture(baseline.adapter);
    assert.strictEqual(JSON.stringify(recaptured), baseline.envelopeJson,
        `baseline checkpoint byte-identical after ${context}`);
    const fp = machineFingerprint(baseline.adapter);
    const diffs = fingerprintDiff(baseline.fingerprint, fp);
    assert.deepStrictEqual(diffs, [], `baseline fingerprint unchanged after ${context}`);
    assertStoreUnchanged(context);
}

test('discarded candidates leave the baseline completely unchanged (A15)', { timeout: 240000 }, async () => {
    setUpStore();
    const baseline = makeBaseline();
    const envPath = writeEnvelope(baseline.envelope, 'iso-base.json');
    const control = runReference(BASE_PREFIX, BASELINE_SUFFIX);

    try {
        // Candidate 1: mutate time, RNG, inventory, location, output; discard.
        {
            const child = spawnRestore(envPath);
            await child.run(CANDIDATE_MUTATIONS);
            assert.ok(child.ready, 'candidate 1 restored: ' + (child.readyError || ''));
            assert.ok(child.fingerprint.output.length > baseline.fingerprint.output.length,
                'candidate actually produced new output');
            assert.ok(child.steps.some((s) => s.delta.includes('[F08:roll=')), 'candidate consumed RNG draws');
            await child.finish();
            assert.strictEqual(child.exitCode, 0, 'candidate exited cleanly before discard');
        }
        assertBaselineUnchanged(baseline, 'candidate 1 discard');

        // Candidate 2: a fresh child from the SAME checkpoint, different
        // mutations; discard again (shared-memory / global-RNG / shared-Glk
        // detection).
        {
            const child = spawnRestore(envPath);
            await child.run([line('north'), line('examine token'), line('take brass key')]);
            assert.ok(child.ready, 'candidate 2 restored');
            await child.finish();
            assert.strictEqual(child.exitCode, 0, 'candidate 2 exited cleanly');
        }
        assertBaselineUnchanged(baseline, 'candidate 2 discard');

        // The baseline continues identically to the untouched control.
        for (let k = 0; k < BASELINE_SUFFIX.length; k++) {
            const got = baseline.adapter.send(BASELINE_SUFFIX[k]);
            assert.strictEqual(got.delta, control.postSteps[k].delta, `baseline continuation step ${k}`);
        }
        const diffs = fingerprintDiff(control.fingerprint, machineFingerprint(baseline.adapter));
        assert.deepStrictEqual(diffs, [], 'baseline final state equals the never-candidated control');
        assertStoreUnchanged('baseline continuation');
    } finally {
        fs.rmSync(STORE, { force: true });
    }
});

test('killing a candidate during bootstrap, at the boundary, during serialization, and pre-publication cannot affect the baseline', { timeout: 240000 }, async () => {
    setUpStore();
    const baseline = makeBaseline();
    const envPath = writeEnvelope(baseline.envelope, 'iso-kill.json');

    try {
        // (a) Kill during bootstrap/startup: terminate while the child is
        // still loading node + vendored sources + restoring (before any
        // ready signal).
        {
            const child = spawnRestore(envPath);
            child.child.kill();
            const code = await awaitExit(child, 10000);
            assert.notStrictEqual(code, 0, 'bootstrap-killed child exits nonzero');
        }
        assertBaselineUnchanged(baseline, 'bootstrap kill');

        // (b) Kill while idle at the restored boundary.
        {
            const child = spawnRestore(envPath);
            const boot = await child.nextMessage(30000);
            assert.strictEqual(boot.ready, true, 'child reached the boundary before the kill');
            child.child.kill();
            const code = await awaitExit(child, 10000);
            assert.notStrictEqual(code, 0, 'boundary-killed child exits nonzero');
        }
        assertBaselineUnchanged(baseline, 'boundary kill');

        // (c) Kill during the serialization phase: the child is configured to
        // busy-stall inside its serialize op so the parent can kill it there;
        // no checkpoint file may appear.
        {
            const outPath = path.join(RESULTS_DIR, 'iso-serialize-target.json');
            fs.rmSync(outPath, { force: true });
            const child = spawnRestore(envPath, { stallSerializeMs: 30000, out: outPath });
            await child.nextMessage(30000); // ready
            child.child.stdin.write(JSON.stringify({ op: 'serialize' }) + '\n');
            await new Promise((r) => setTimeout(r, 500)); // let it enter the stall
            child.child.kill();
            const code = await awaitExit(child, 10000);
            assert.notStrictEqual(code, 0, 'serialization-killed child exits nonzero');
            await new Promise((r) => setTimeout(r, 200));
            assert.strictEqual(fs.existsSync(outPath), false, 'killed serialization wrote no checkpoint file');
        }
        assertBaselineUnchanged(baseline, 'serialization kill');

        // (d) Kill after mutations but before the parent reads the candidate
        // transcript (simulated pre-publication kill): the candidate's output
        // is never received, so nothing can be published.
        {
            const child = spawnRestore(envPath);
            const boot = await child.nextMessage(30000);
            assert.strictEqual(boot.ready, true);
            child.child.stdin.write(JSON.stringify({ input: line('seed 9') }) + '\n');
            await new Promise((r) => setTimeout(r, 120)); // mutation likely in flight/done
            child.child.kill();
            const code = await awaitExit(child, 10000);
            assert.notStrictEqual(code, 0, 'pre-publication-killed child exits nonzero');
        }
        assertBaselineUnchanged(baseline, 'pre-publication kill');
    } finally {
        fs.rmSync(STORE, { force: true });
    }
});

test('an unbounded candidate is preempted by a parent-enforced deadline and reaped', { timeout: 120000 }, async () => {
    setUpStore();
    const baseline = makeBaseline();
    try {
        // A story whose startup never terminates (nonrecursive infinite loop)
        // runs in a fresh child; the parent kills it at the deadline.
        const child = spawn(process.execPath, [
            path.join(__dirname, 'exec-child.js'), '--story', SPINLOOP,
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (c) => { stdout += c; });
        const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
        await new Promise((r) => setTimeout(r, 2000));
        assert.strictEqual(stdout.includes('"ready":true'), false, 'spinloop never reaches a ready boundary');
        child.kill();
        const { code } = await Promise.race([
            exited,
            new Promise((_, reject) => setTimeout(() => reject(new Error('spinloop child leaked: did not exit after kill')), 10000)),
        ]);
        assert.notStrictEqual(code, 0, 'deadline-killed spinloop exits nonzero');
        assertBaselineUnchanged(baseline, 'unbounded-execution kill');
    } finally {
        fs.rmSync(STORE, { force: true });
    }
});

test('the candidate output limit stops a chatty candidate nonzero', { timeout: 120000 }, async () => {
    setUpStore();
    const baseline = makeBaseline();
    const envPath = writeEnvelope(baseline.envelope, 'iso-limit.json');
    try {
        const child = spawnRestore(envPath, { outputLimit: 400 });
        const boot = await child.nextMessage(30000);
        assert.strictEqual(boot.ready, true);
        // Repeated room descriptions exceed the cap quickly.
        for (let i = 0; i < 10; i++) {
            child.child.stdin.write(JSON.stringify({ input: line('look') }) + '\n');
        }
        // Pump messages until the process exits with the limit error.
        const exited = await Promise.race([
            child.exited,
            new Promise((_, reject) => setTimeout(() => reject(new Error('output-limit child did not exit')), 30000)),
        ]);
        assert.strictEqual(exited, 3, 'output-limit exit code 3');
        assertBaselineUnchanged(baseline, 'output-limit stop');
    } finally {
        fs.rmSync(STORE, { force: true });
    }
});

test('malformed and hostile checkpoints are rejected in the child without touching the baseline (A34)', { timeout: 240000 }, async () => {
    setUpStore();
    const baseline = makeBaseline();
    const envPath = writeEnvelope(baseline.envelope, 'iso-hostile.json');
    const { sha256Hex, canonicalPayloadString } = require('../lib/checkpoint-format.js');

    const variants = {};
    variants['not-json'] = 'this is not json {{{';
    variants['empty-file'] = '';
    // Digest liar: flip output text without updating the digest.
    {
        const e = JSON.parse(baseline.envelopeJson);
        e.payload.publishedOutput.output += 'LIE';
        variants['digest-liar'] = JSON.stringify(e);
    }
    // Wrong story identity (loopstory digest), honest digest.
    {
        const e = JSON.parse(baseline.envelopeJson);
        e.identity.storySha256 = require('./helpers.js').LOOPSTORY_SHA256;
        e.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(e.payload));
        variants['wrong-story'] = JSON.stringify(e);
    }
    // Wrong runtime revision, honest digest.
    {
        const e = JSON.parse(baseline.envelopeJson);
        e.identity.runtimeRevision = 'deadbeefdeadbeef';
        e.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(e.payload));
        variants['wrong-runtime'] = JSON.stringify(e);
    }
    // Unsupported boundary kind.
    {
        const e = JSON.parse(baseline.envelopeJson);
        e.boundary = { kind: 'timed-input' };
        e.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(e.payload));
        variants['bad-boundary'] = JSON.stringify(e);
    }
    // Structurally valid but corrupt quetzal: truncated base64 with a
    // recomputed honest digest -- must fail at the VM layer.
    {
        const e = JSON.parse(baseline.envelopeJson);
        e.payload.quetzalB64 = e.payload.quetzalB64.slice(0, 40);
        e.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(e.payload));
        variants['corrupt-quetzal'] = JSON.stringify(e);
    }

    const expectedCodes = {
        'not-json': 'E_FORMAT',
        'empty-file': 'E_FORMAT',
        'digest-liar': 'E_DIGEST',
        'wrong-story': 'E_STORY',
        'wrong-runtime': 'E_RUNTIME',
        'bad-boundary': 'E_BOUNDARY',
        'corrupt-quetzal': null, // VM-layer failure surfaces as a plain error
    };

    const childProcesses = [];
    try {
        for (const [name, content] of Object.entries(variants)) {
            const p = writeEnvelopeRaw(content, 'hostile-' + name + '.json');
            const child = spawnRestore(p);
            childProcesses.push(child);
            const boot = await child.nextMessage(30000);
            assert.strictEqual(boot.ready, false, `${name}: child must refuse to restore`);
            if (expectedCodes[name]) {
                assert.strictEqual(boot.code, expectedCodes[name],
                    `${name}: expected code ${expectedCodes[name]}, got: ${boot.code} (${boot.error})`);
            }
            const code = await awaitExit(child, 30000);
            assert.strictEqual(code, 2, `${name}: rejected child exits 2, got ${code}`);
            assertBaselineUnchanged(baseline, `${name} rejection`);
        }
    } finally {
        // A leaked child would keep this test process's pipes open and hang
        // the suite; every spawned child is killed no matter what happened.
        for (const child of childProcesses) {
            try { child.child.kill(); await awaitExit(child, 5000); } catch { /* already gone */ }
        }
        fs.rmSync(STORE, { force: true });
    }
});

function writeEnvelopeRaw(content, name) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const p = path.join(RESULTS_DIR, name);
    fs.writeFileSync(p, content);
    return p;
}
