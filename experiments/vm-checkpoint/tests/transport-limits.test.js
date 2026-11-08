'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnSync: boundedSpawnSync } = require('../test-support/bounded-sync.cjs');
const { LIMITS, readBoundedFile, parseCheckpoint, encodeCheckpoint, decodeUtf8,
    requestFramer, responseWriter } = require('../lib/transport-limits.js');
const { pipeCollector, supervise } = require('../test-support/bounded-child.cjs');
const { createInstance, line, drive, capture, machineFingerprint, runReference,
    fingerprintDiff, FIXTURE, RUNNER } = require('./helpers.js');
const PREFIX = [line('look'), line('seed 42'), line('take brass key'), line('north')];
const SUFFIX = [line('inventory'), line('seed 42'), line('roll'), line('look')];
const code = value => error => error.code === value;
async function context(fn) {
    const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'zirp-issue49-'));
    assert.equal(path.dirname(fs.realpathSync(dir)), parent);
    const baseline = createInstance(); baseline.start(); drive(baseline, PREFIX);
    const envelope = capture(baseline), bytes = Buffer.from(JSON.stringify(envelope)), fp = machineFingerprint(baseline);
    const checkpoint = path.join(dir, 'baseline.json'), store = path.join(dir, 'store'), out = path.join(dir, 'candidate.json');
    fs.writeFileSync(checkpoint, bytes); fs.writeFileSync(store, 'published baseline');
    assert.deepEqual(fs.readFileSync(checkpoint), bytes);
    const sessions = []; let publications = 0;
    const c = { dir, checkpoint, store, out, envelope,
        start(args = [], input = '', extra = {}) {
            const child = spawn(process.execPath, [...(extra.preload ? ['--require', extra.preload] : []), RUNNER,
                '--story', extra.story || FIXTURE, '--checkpoint', extra.checkpoint || checkpoint, '--out', extra.out || out, ...args],
            { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            const session = supervise(child); sessions.push(session);
            if (!extra.keepOpen) child.stdin.end(input); return session;
        },
        synthetic(mode, lateKill = false) {
            const child = spawn(process.execPath, [path.join(__dirname, '../test-support/limits-child.cjs'), mode],
                { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            // Test-only simulation of a kill arriving too late. The real child
            // must finish naturally with 0; production supervision is unchanged.
            if (lateKill) child.kill = () => true;
            const session = supervise(child); sessions.push(session); return session;
        },
        async publish(session) {
            assert.equal(session.eligible, true); const final = parseCheckpoint(readBoundedFile(out, LIMITS.checkpointBytes));
            const recapture = path.join(dir, 'recapture.json');
            const fresh = c.start([], '{"op":"serialize"}\n' + SUFFIX.map(input => JSON.stringify({ input })).join('\n') + '\n{"op":"exit"}\n',
                { checkpoint: out, out: recapture });
            const rows = await closed(fresh, 0); assert.equal(fresh.eligible, true);
            assert.deepEqual(parseCheckpoint(readBoundedFile(recapture, LIMITS.checkpointBytes)), final);
            const control = createInstance(); control.start(); drive(control, [...PREFIX, line('look')]);
            const keys = ['status', 'delta', 'output', 'gridOutput', 'requestLog', 'errors', 'unexpectedGlk'];
            const select = step => Object.fromEntries(keys.map(key => [key, step[key]]));
            const expected = SUFFIX.map(input => JSON.parse(JSON.stringify(select(control.send(input)))));
            assert.deepEqual(rows.filter(row => row.step).map(row => row.step), expected);
            publications++; fs.writeFileSync(store, 'qualified fixture publication');
        },
    };
    try {
        await fn(c);
        assert.deepEqual(fs.readFileSync(checkpoint), bytes);
        assert.deepEqual(capture(baseline), envelope); assert.deepEqual(machineFingerprint(baseline), fp);
        const reference = runReference(PREFIX, SUFFIX);
        // Compare every JSON-visible field, excluding only adapter methods.
        assert.deepEqual(JSON.parse(JSON.stringify(drive(baseline, SUFFIX))), JSON.parse(JSON.stringify(reference.postSteps)));
        assert.deepEqual(fingerprintDiff(machineFingerprint(baseline), reference.fingerprint), []);
        assert.equal(fs.readFileSync(store, 'utf8'), publications ? 'qualified fixture publication' : 'published baseline');
        assert.ok(publications <= 1);
    } finally {
        for (const s of sessions) {
            await s.terminate(); assert.ok(s.exit && s.closed, 'exit and pipe-close observed');
        }
        assert.equal(path.dirname(fs.realpathSync(dir)), parent);
        assert.ok(path.basename(dir).startsWith('zirp-issue49-')); fs.rmSync(dir, { recursive: true });
        assert.equal(fs.existsSync(dir), false);
    }
}
async function closed(s, expected) {
    const result = await s.close(); assert.ok(s.exit); assert.deepEqual(result, s.exit);
    if (expected !== undefined) { assert.equal(result.code, expected); assert.equal(result.signal, null); }
    return s.collector.records;
}
test('bounded reader: exact cap, cap plus one, short reads, growth, and closed descriptors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zirp-issue49-reader-')), file = path.join(dir, 'input');
    const originalRead = fs.readSync, originalStat = fs.fstatSync, originalClose = fs.closeSync;
    let closes = 0;
    try {
        fs.closeSync = fd => { closes++; return originalClose(fd); };
        fs.writeFileSync(file, Buffer.alloc(64, 120));
        fs.readSync = (fd, b, off, n, pos) => originalRead(fd, b, off, Math.min(n, 3), pos);
        closes = 0; assert.equal(readBoundedFile(file, 64).length, 64); assert.equal(closes, 1);
        fs.writeFileSync(file, Buffer.alloc(65)); closes = 0;
        assert.throws(() => readBoundedFile(file, 64), code('E_SIZE')); assert.equal(closes, 1);
        fs.writeFileSync(file, Buffer.alloc(64));
        fs.fstatSync = fd => {
            const stat = originalStat(fd), grow = fs.openSync(file, 'a');
            fs.writeSync(grow, 'x'); originalClose(grow); return stat;
        };
        closes = 0; assert.throws(() => readBoundedFile(file, 64), code('E_SIZE')); assert.equal(closes, 1);
    } finally { fs.readSync = originalRead; fs.fstatSync = originalStat; fs.closeSync = originalClose; fs.rmSync(dir, { recursive: true }); }
});
test('checkpoint byte cap precedes decoding/parsing; UTF-8 is fatal; serialization is capped', () => {
    const original = JSON.parse; let calls = 0;
    try {
        JSON.parse = text => { calls++; return original(text); };
        assert.throws(() => parseCheckpoint(Buffer.alloc(LIMITS.checkpointBytes + 1)), code('E_SIZE'));
        assert.equal(calls, 0);
        assert.deepEqual(parseCheckpoint(Buffer.from('{}' + ' '.repeat(LIMITS.checkpointBytes - 2))), {});
        assert.equal(calls, 1);
        const unicode = Buffer.from('"' + '😀'.repeat(LIMITS.checkpointBytes / 4) + '"');
        assert.ok(unicode.toString('utf8').length < LIMITS.jsonChars);
        assert.throws(() => parseCheckpoint(unicode), code('E_SIZE')); assert.equal(calls, 1);
        assert.throws(() => parseCheckpoint(Buffer.from([0x22, 0xff, 0x22])), code('E_FORMAT'));
        assert.throws(() => parseCheckpoint(Buffer.from('{')), code('E_FORMAT'));
        assert.throws(() => encodeCheckpoint({ padding: 'x'.repeat(LIMITS.checkpointBytes) }), code('E_SIZE'));
    } finally { JSON.parse = original; }
});
test('request framing counts bytes, fragments Unicode, caps lines and cumulative input', () => {
    const f = requestFramer(), input = Buffer.from('{"value":"😀"}\n'); let lines = [];
    for (const byte of input) lines.push(...f.push(Buffer.from([byte])));
    assert.deepEqual(JSON.parse(decodeUtf8(lines[0])), { value: '😀' });
    assert.equal([...requestFramer().push(Buffer.alloc(LIMITS.requestLineBytes, 32))].length, 0);
    const large = requestFramer(); [...large.push(Buffer.alloc(LIMITS.requestLineBytes, 32))];
    assert.throws(() => [...large.push(Buffer.from('x'))], code('E_INPUT_LIMIT'));
    const total = requestFramer(), chunk = Buffer.alloc(65536, 10);
    for (let i = 0; i < LIMITS.inputBytes / chunk.length; i++) for (const ignored of total.push(chunk)) void ignored;
    assert.throws(() => [...total.push(Buffer.from('\n'))], code('E_INPUT_LIMIT'));
});
test('response record and aggregate caps suppress payloads and reserve the terminal diagnostic', async () => {
    const writes = [], writer = responseWriter(async text => writes.push(text));
    const record = { pad: 'x'.repeat(LIMITS.recordBytes - 11) };
    await writer.emit(record); assert.equal(Buffer.byteLength(writes[0]), LIMITS.recordBytes);
    const before = writes.length;
    await assert.rejects(writer.emit({ pad: 'x'.repeat(LIMITS.recordBytes) }), code('E_OUTPUT_LIMIT'));
    assert.equal(writes.length, before);
    await writer.emit(record); await writer.emit(record);
    await assert.rejects(writer.emit(record), code('E_OUTPUT_LIMIT'));
    await writer.diagnostic({ error: 'output-limit-exceeded', code: 'E_OUTPUT_LIMIT', failed: true });
    assert.ok(writer.bytes <= LIMITS.stdoutBytes); assert.ok(Buffer.byteLength(writes.at(-1)) <= 1024);
});
for (const kind of ['oversize', 'truncated', 'invalid-utf8', 'story-oversize']) {
    test('ordinary runner rejects ' + kind + ' before readiness and without artifacts', async () => context(async c => {
        const file = path.join(c.dir, 'bad');
        if (kind.includes('oversize')) { const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, (kind === 'story-oversize' ? LIMITS.storyBytes : LIMITS.checkpointBytes) + 1); fs.closeSync(fd); }
        else fs.writeFileSync(file, kind === 'truncated' ? Buffer.from('{') : Buffer.from([0xff]));
        const s = c.start([], '', kind === 'story-oversize' ? { story: file } : { checkpoint: file });
        const rows = await closed(s, 2); assert.equal(rows.length, 1); assert.equal(rows[0].ready, false);
        assert.equal(rows[0].code, kind.includes('oversize') ? 'E_SIZE' : 'E_FORMAT'); assert.equal(s.eligible, false);
        assert.equal(fs.existsSync(c.out), false);
    }));
}
for (const newline of ['', '\n']) {
    test('ordinary runner terminates oversized request ' + (newline ? 'with LF' : 'without LF'), async () => context(async c => {
        const s = c.start([], 'x'.repeat(LIMITS.requestLineBytes + 1) + newline + '\n{"op":"serialize"}\n');
        const rows = await closed(s, 4); assert.equal(rows[0].ready, true);
        assert.equal(rows[1].code, 'E_INPUT_LIMIT'); assert.equal(rows.length, 2); assert.equal(fs.existsSync(c.out), false);
    }));
}
test('ordinary runner enforces cumulative input and suppresses the oversize real fixture step', async () => context(async c => {
    const s = c.start([], Buffer.alloc(LIMITS.inputBytes + 1, 10));
    const rows = await closed(s, 4); assert.equal(rows.at(-1).code, 'E_INPUT_LIMIT');
    const chatty = c.start(['--output-limit', '1'], '{"input":{"kind":"line","text":"look"}}\n{"op":"serialize"}\n');
    const output = await closed(chatty, 3); assert.equal(output.length, 2);
    assert.equal(output[1].error, 'output-limit-exceeded'); assert.equal(output[1].code, 'E_OUTPUT_LIMIT');
    assert.equal(output[1].step, undefined); assert.ok(Buffer.byteLength(JSON.stringify(output[1])) < 1024);
    assert.equal(fs.existsSync(c.out), false);
}));
test('output CLI cannot disable/raise the ceiling; clean candidate can serialize and publish', async () => context(async c => {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', String(LIMITS.outputChars + 1)]) {
        const rows = await closed(c.start(['--output-limit', value]), 2); assert.equal(rows[0].ready, false);
    }
    await closed(c.start(['--output-limit']), 2);
    const s = c.start([], '{"input":{"kind":"line","text":"look"}}\n{"op":"serialize"}\n{"op":"exit"}\n');
    const rows = await closed(s, 0); assert.ok(rows.some(row => row.serialized)); assert.ok(rows.some(row => row.step));
    await c.publish(s);
}));
test('ordinary serialization size guard preserves an existing output file', async () => context(async c => {
    // Guard scaffolding after a real capture, not a story-produced envelope.
    const preload = path.join(c.dir, 'oversize.cjs');
    const source = 'const core = require(' + JSON.stringify(require.resolve('../lib/checkpoint-core.js')) + ');\n'
        + 'const real = core.captureCheckpoint; core.captureCheckpoint = (...args) => ({ ...real(...args), padding: "x".repeat(32*1024*1024) });\n';
    fs.writeFileSync(preload, source); assert.equal(fs.readFileSync(preload, 'utf8'), source);
    fs.writeFileSync(c.out, 'existing candidate');
    const s = c.start([], '{"op":"serialize"}\n{"op":"exit"}\n', { preload });
    const rows = await closed(s, 4); assert.equal(rows[0].ready, true); assert.equal(rows[1].code, 'E_SIZE');
    assert.equal(rows.some(row => row.serialized), false); assert.equal(s.eligible, false);
    assert.equal(fs.readFileSync(c.out, 'utf8'), 'existing candidate');
}));
test('synchronous test facade retains bounded diagnostics and reports collection failure', async () => context(async c => {
    const result = boundedSpawnSync(process.execPath, [path.join(__dirname, '../test-support/limits-child.cjs'), 'stderr'],
        { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 4); assert.equal(result.signal, null);
    assert.equal(result.stdout, ''); assert.match(result.stderr, /^bounded child failure: E_CHILD_OUTPUT_LIMIT\n$/);
    assert.ok(Buffer.byteLength(result.stderr) <= LIMITS.stderrBytes); assert.equal(fs.existsSync(c.out), false);
}));
test('collector preserves callback assertion diagnostics and keeps the fault sticky', () => {
    const collector = pipeCollector(() => assert.fail('callback assertion preserved'));
    collector.stdout(Buffer.from('{"valid":true}\n'));
    assert.equal(collector.fault.code, 'ERR_ASSERTION');
    assert.match(collector.fault.message, /callback assertion preserved/);
    const original = collector.fault;
    collector.stdout(Buffer.from('{"later":true}\n')); collector.end();
    assert.equal(collector.fault, original); assert.equal(collector.records.length, 1);
});
test('unexpected runner failure emits a bounded diagnostic and exits 4', async () => context(async c => {
    // Explicit guard scaffolding; no production hook or altered VM execution.
    const preload = path.join(c.dir, 'unexpected.cjs');
    const source = 'require(' + JSON.stringify(require.resolve('../lib/fingerprint.js'))
        + ').machineFingerprint = () => { throw new Error("synthetic internal failure"); };\n';
    fs.writeFileSync(preload, source); assert.equal(fs.readFileSync(preload, 'utf8'), source);
    const s = c.start([], '', { preload }); const rows = await closed(s, 4);
    assert.equal(rows.length, 1); assert.equal(rows[0].code, 'E_INTERNAL'); assert.equal(rows[0].failed, true);
    assert.equal(rows[0].detail, 'synthetic internal failure'); assert.equal(s.eligible, false);
    assert.ok(Buffer.byteLength(JSON.stringify(rows[0]) + '\n') <= LIMITS.diagnosticBytes);
    assert.equal(s.collector.stderr, ''); assert.equal(fs.existsSync(c.out), false);
}));
test('broken stdout uses bounded stderr failure evidence and remains ineligible', async () => context(async c => {
    const s = c.start([], '', { keepOpen: true });
    await s.wait(() => s.collector.records[0]); assert.equal(s.collector.records[0].ready, true);
    s.child.stdout.destroy(); s.child.stdin.end('{"op":"fingerprint"}\n');
    await closed(s, 4); assert.equal(s.eligible, false);
    assert.equal(s.collector.stderr, 'runner internal failure (E_INTERNAL)\n');
    assert.ok(Buffer.byteLength(s.collector.stderr) <= LIMITS.stderrBytes); assert.equal(fs.existsSync(c.out), false);
}));
for (const mode of ['record', 'aggregate', 'stderr', 'partial', 'malformed', 'zero', 'stall']) {
    test('bounded synthetic child: ' + mode, { timeout: 120000 }, async t => context(async c => {
        const s = c.synthetic(mode, mode === 'zero');
        if (mode === 'stall') {
            await s.wait(() => s.collector.records[0]);
            await assert.rejects(s.wait(() => false, 100), code('E_DEADLINE'));
        }
        await closed(s, mode === 'zero' ? 0 : undefined);
        assert.ok(s.collector.fault); assert.equal(s.eligible, false);
        assert.ok(s.collector.counts.stderrBytes <= LIMITS.stderrBytes);
        assert.ok(s.collector.retainedStdoutBytes <= LIMITS.stdoutBytes);
        assert.equal(s.collector.retainedLineBytes, 0); assert.equal(fs.existsSync(c.out), false);
        t.diagnostic(JSON.stringify({ mode, exit: s.exit, close: s.closed, eligible: s.eligible,
            fault: s.collector.fault.code, counts: s.collector.counts,
            retainedStdoutBytes: s.collector.retainedStdoutBytes, retainedStderrBytes: Buffer.byteLength(s.collector.stderr),
            baselineAndStoreUnchanged: true, publicationCalls: 0 }));
    }));
}
