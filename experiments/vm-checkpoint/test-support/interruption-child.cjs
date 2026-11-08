'use strict';

// TEST ONLY. These barriers surround real core calls; they do not interrupt
// synchronous capture or the ordinary runner's writeFileSync implementation.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PHASES } = require('./interruption-support.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let receiver;
process.on('message', message => {
    if (!receiver) return fail(new Error('unexpected control message'));
    const pending = receiver; receiver = null; pending.resolve(message);
});
process.on('disconnect', () => {
    if (receiver) { const pending = receiver; receiver = null; pending.reject(new Error('control disconnected at barrier')); }
});
function receive() {
    assert.ok(!receiver);
    return new Promise((resolve, reject) => { receiver = { resolve, reject }; });
}
function fail(error) {
    process.stderr.write('interruption scaffold: ' + error.message + '\n');
    process.exitCode = 4;
    if (receiver) { const pending = receiver; receiver = null; pending.reject(error); }
    if (process.connected) process.disconnect();
}
const stdout = record => new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(record) + '\n', error => error ? reject(error) : resolve());
});
function writeRange(file, bytes, start, end, flags) {
    const fd = fs.openSync(file, flags);
    try {
        let offset = start;
        while (offset < end) {
            const written = fs.writeSync(fd, bytes, offset, end - offset);
            assert.ok(written > 0, 'short write must make progress'); offset += written;
        }
    } finally { fs.closeSync(fd); }
}
async function main() {
    const config = await receive();
    assert.equal(config.type, 'start'); assert.equal(typeof config.candidateId, 'string');
    for (const name of ['story', 'checkpoint', 'artifact']) assert.equal(typeof config[name], 'string');
    assert.ok(Array.isArray(config.inputs));
    let sequence = 0;
    async function barrier(phase, evidence = {}) {
        assert.equal(PHASES[sequence], phase); const seq = ++sequence;
        // Install the release receiver BEFORE sending the acknowledgment.
        const release = receive();
        await new Promise((resolve, reject) => process.send({ type: 'phase',
            candidateId: config.candidateId, seq, phase, evidence }, error => error ? reject(error) : resolve()));
        const message = await release;
        assert.deepEqual(message, { type: 'continue', candidateId: config.candidateId, seq, phase });
    }
    await barrier('startup-entered'); // before any VM/core module is loaded
    const { restoreCheckpoint, captureCheckpoint } = require('../lib/checkpoint-core.js');
    const { machineFingerprint } = require('../lib/fingerprint.js');
    const story = fs.readFileSync(config.story);
    const adapter = restoreCheckpoint(JSON.parse(fs.readFileSync(config.checkpoint, 'utf8')), story);
    const snapshot = () => JSON.parse(JSON.stringify(machineFingerprint(adapter)));
    const boundary = () => {
        const { vm, state } = adapter.__g1bInternals();
        return JSON.parse(JSON.stringify({ request: state.requestLog.at(-1), readData: vm.read_data }));
    };
    await barrier('restored-boundary', { fingerprint: snapshot(), boundary: boundary() });
    const steps = config.inputs.map(input => JSON.parse(JSON.stringify(adapter.send(input))));
    await stdout({ type: 'steps', steps, fingerprint: snapshot(), boundary: boundary() });
    await barrier('mutation-complete', { fingerprint: snapshot(), boundary: boundary() });
    await barrier('serialization-entered'); // BEFORE capture, never an in-capture claim
    const envelope = captureCheckpoint(adapter, { storySha256: digest(story), storySize: story.length });
    const bytes = Buffer.from(JSON.stringify(envelope));
    const evidence = { bytes: bytes.length, sha256: digest(bytes) };
    await barrier('capture-complete', evidence);
    const midpoint = Math.floor(bytes.length / 2);
    assert.ok(midpoint > 0 && midpoint < bytes.length);
    writeRange(config.artifact, bytes, 0, midpoint, 'wx');
    assert.deepEqual(fs.readFileSync(config.artifact), bytes.subarray(0, midpoint));
    await barrier('partial-write-complete', { ...evidence, written: midpoint });
    writeRange(config.artifact, bytes, midpoint, bytes.length, 'a');
    assert.deepEqual(fs.readFileSync(config.artifact), bytes);
    await stdout({ type: 'finished', ...evidence });
    await barrier('candidate-finished', evidence);
    process.disconnect(); process.exitCode = 0;
}
main().catch(fail);
