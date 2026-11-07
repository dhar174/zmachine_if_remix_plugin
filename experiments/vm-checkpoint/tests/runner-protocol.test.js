'use strict';

// Issue #44: exercise the ordinary fresh-process runner through its actual
// newline-delimited stdin/stdout protocol, including termination with queued
// responses. No --selftest is used for the three reproduced protocol defects.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
    createInstance, line, drive, capture, machineFingerprint, fingerprintDiff,
    FIXTURE, RUNNER, spawnRestore, awaitExit,
} = require('./helpers.js');

let tempRoot;
let checkpoint;
let baseline;
let baselineJson;
let baselineFingerprint;

before(() => {
    const tempParent = fs.realpathSync(os.tmpdir());
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(tempParent, 'zirp-issue44-protocol-')));
    const rel = path.relative(tempParent, tempRoot);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    assert.ok(path.basename(tempRoot).startsWith('zirp-issue44-protocol-'));
    baseline = createInstance();
    baseline.start();
    drive(baseline, [line('seed 42')]);
    baselineJson = JSON.stringify(capture(baseline));
    baselineFingerprint = machineFingerprint(baseline);
    checkpoint = path.join(tempRoot, 'baseline.json');
    fs.writeFileSync(checkpoint, baselineJson);
    assert.equal(fs.readFileSync(checkpoint, 'utf8'), baselineJson);
});

afterEach(() => {
    if (!baseline) return;
    assert.equal(JSON.stringify(capture(baseline)), baselineJson, 'live baseline checkpoint changed');
    assert.deepEqual(fingerprintDiff(baselineFingerprint, machineFingerprint(baseline)), [], 'live baseline fingerprint changed');
    assert.equal(fs.readFileSync(checkpoint, 'utf8'), baselineJson, 'checkpoint file changed');
});

after(() => {
    if (!tempRoot) return;
    const parent = fs.realpathSync(os.tmpdir());
    const resolved = fs.realpathSync(tempRoot);
    const rel = path.relative(parent, resolved);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    assert.ok(path.basename(resolved).startsWith('zirp-issue44-protocol-'));
    fs.rmSync(resolved, { recursive: true, force: true });
    assert.equal(fs.existsSync(resolved), false);
});

function run(lines, opts = {}) {
    const args = [RUNNER, '--story', FIXTURE, '--checkpoint', opts.checkpoint || checkpoint];
    if (opts.outputLimit) args.push('--output-limit', String(opts.outputLimit));
    if (opts.selftest) args.push('--selftest', opts.selftest);
    if (opts.out) args.push('--out', opts.out);
    const result = spawnSync(process.execPath, args, {
        input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 30000,
        maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, 'runner could not complete');
    assert.equal(result.signal, null, 'runner terminated by signal');
    assert.equal(result.stderr, '', 'runner emitted stderr');
    const rows = result.stdout.split('\n').filter(Boolean).map((row) => JSON.parse(row));
    return { status: result.status, rows };
}

const errors = [
    ['malformed JSON', '{', 'bad request line'],
    ['unknown operation', '{"op":"not-an-operation"}', 'unrecognized request'],
    ['serialize without output path', '{"op":"serialize"}', 'serialize requested without --out'],
];
for (const [name, input, expected] of errors) {
    for (const termination of ['EOF', 'explicit exit']) {
        test(name + ' reports structured failure and exits 4 on ' + termination, () => {
            const lines = termination === 'EOF' ? [input] : [input, '{"op":"exit"}'];
            const result = run(lines);
            assert.equal(result.rows[0].ready, true);
            assert.equal(result.rows.length, 2);
            assert.equal(result.rows[1].error, expected);
            assert.equal(result.rows[1].failed, true);
            assert.match(result.rows[1].detail, /protocol error/);
            assert.equal(result.status, 4);
        });
    }
}

test('unknown op cannot be hidden by a simultaneous input', () => {
    const result = run(['{"op":"unknown","input":{"kind":"line","text":"look"}}', '{"op":"fingerprint"}', '{"op":"exit"}']);
    assert.equal(result.rows[0].ready, true);
    assert.equal(result.rows[1].error, 'unrecognized request');
    assert.equal(result.rows[1].failed, true);
    assert.deepEqual(result.rows[2].fingerprint, result.rows[0].fingerprint, 'unknown op executed input');
    assert.equal(result.status, 4);
});

test('failure is sticky across subsequent valid and invalid requests', () => {
    const result = run(['{"op":"unknown"}', '{"op":"fingerprint"}', '{', '{"op":"exit"}']);
    assert.equal(result.rows.length, 4);
    assert.equal(result.rows[1].error, 'unrecognized request');
    assert.equal(result.rows[1].failed, true);
    assert.ok(result.rows[2].fingerprint);
    assert.equal(result.rows[3].error, 'bad request line');
    assert.equal(result.rows[3].failed, true);
    assert.equal(result.rows[3].detail, result.rows[1].detail, 'first failure detail was not retained');
    assert.equal(result.status, 4);
});

test('non-object JSON requests are structured protocol failures', () => {
    for (const input of ['null', '[]', '42', '"text"']) {
        const result = run([input, '{"op":"exit"}']);
        assert.equal(result.rows[1].error, 'unrecognized request');
        assert.equal(result.rows[1].failed, true);
        assert.equal(result.status, 4);
    }
});

test('later candidate input can run but cannot clear a protocol failure', () => {
    const result = run(['{', '{"input":{"kind":"line","text":"look"}}', '{"op":"exit"}']);
    assert.equal(result.rows[1].error, 'bad request line');
    assert.equal(result.rows[1].failed, true);
    assert.ok(result.rows[2].step && result.rows[2].step.status !== 'error');
    assert.equal(result.status, 4);
});

test('protocol evidence drains before immediate EOF or explicit exit', { timeout: 120000 }, () => {
    for (const ending of ['EOF', 'explicit exit']) {
        const lines = Array(2500).fill('{');
        if (ending === 'explicit exit') lines.push('{"op":"exit"}');
        const result = run(lines);
        assert.equal(result.rows[0].ready, true);
        assert.equal(result.rows.length, 2501, ending + ': missing structured responses');
        for (const row of result.rows.slice(1)) {
            assert.equal(row.error, 'bad request line');
            assert.equal(row.failed, true);
        }
        assert.equal(result.status, 4);
    }
});

test('explicit exit terminates while the parent keeps stdin open', { timeout: 60000 }, async () => {
    const child = spawnRestore(checkpoint);
    try {
        assert.equal((await child.nextMessage(30000)).ready, true);
        child.child.stdin.write('{\n');
        const error = await child.nextMessage(30000);
        assert.equal(error.error, 'bad request line');
        assert.equal(error.failed, true);
        child.child.stdin.write('{"op":"exit"}\n');
        assert.equal(await awaitExit(child, 10000), 4);
        assert.equal(child.stderr, '');
    } finally {
        child.child.kill();
        await awaitExit(child, 10000).catch(() => {});
    }
});

test('explicit exit ignores later already-buffered requests', () => {
    const result = run(['{"op":"exit"}', '{', '{"input":{"kind":"line","text":"look"}}']);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].ready, true);
    assert.equal(result.status, 0);
});

test('clean requests exit 0 on EOF and explicit exit', () => {
    for (const ending of ['EOF', 'explicit exit']) {
        const lines = ['{"input":{"kind":"line","text":"look"}}', '{"op":"fingerprint"}'];
        if (ending === 'explicit exit') lines.push('{"op":"exit"}');
        const result = run(lines);
        assert.equal(result.rows[0].ready, true);
        assert.ok(result.rows[1].step && result.rows[1].step.status !== 'error');
        assert.ok(result.rows[2].fingerprint);
        assert.equal(result.status, 0);
    }
});

test('successful serialization remains a clean run', () => {
    const out = path.join(tempRoot, 'candidate.json');
    assert.equal(fs.existsSync(out), false);
    const result = run(['{"op":"serialize"}', '{"op":"exit"}'], { out });
    assert.equal(result.rows[0].ready, true);
    assert.equal(result.rows[1].serialized, true);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).format, 'zirp-g1b-checkpoint');
});

test('protocol failure cannot replace an immediate output-limit exit 3', () => {
    const result = run(['{', '{"input":{"kind":"line","text":"look"}}'], { outputLimit: 1 });
    assert.equal(result.rows[1].error, 'bad request line');
    assert.equal(result.rows[1].failed, true);
    assert.equal(result.rows[2].error, 'output-limit-exceeded');
    assert.equal(result.status, 3);
});

test('checkpoint rejection still exits 2 before readiness', () => {
    const bad = path.join(tempRoot, 'invalid.json');
    fs.writeFileSync(bad, '{');
    assert.equal(fs.readFileSync(bad, 'utf8'), '{');
    const result = run([], { checkpoint: bad });
    assert.equal(result.rows[0].ready, false);
    assert.equal(result.rows[0].code, 'E_FORMAT');
    assert.equal(result.status, 2);
});

for (const mode of ['step-error', 'throw']) {
    test('selftest ' + mode + ' preserves failure exit 4', () => {
        const result = run(['{"input":{"kind":"line","text":"look"}}', '{"op":"exit"}'], { selftest: mode });
        assert.equal(result.rows[0].ready, true);
        if (mode === 'step-error') assert.equal(result.rows[1].step.status, 'error');
        else assert.equal(result.rows[1].failed, true);
        assert.equal(result.status, 4);
    });
    test('selftest ' + mode + ' rejects non-input protocol requests', () => {
        const result = run(['{"op":"fingerprint"}', '{"op":"exit"}'], { selftest: mode });
        assert.equal(result.rows[1].error, 'selftest mode only answers input requests');
        assert.equal(result.rows[1].failed, true);
        assert.equal(result.status, 4);
    });
}
