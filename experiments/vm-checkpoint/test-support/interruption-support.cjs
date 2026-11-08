'use strict';
// Trusted test IPC controls phases; bounded private stdout is never publication.
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { supervise } = require('./bounded-child.cjs');
const PHASES = ['startup-entered', 'restored-boundary', 'mutation-complete',
    'serialization-entered', 'capture-complete', 'partial-write-complete', 'candidate-finished'];
function spawnCandidate(config) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(__dirname, 'interruption-child.cjs'), [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env, windowsHide: true,
    });
    const phases = [], records = []; let allowed = 1;
    const session = supervise(child, record => {
        assert.equal(record.type, ['steps', 'finished'][records.length]); records.push(record);
    });
    const fail = error => session.collector.fail(error);
    child.on('message', message => {
        if (!message || message.type !== 'phase' || message.candidateId !== config.candidateId
            || message.seq !== allowed || message.seq !== phases.length + 1
            || message.phase !== PHASES[message.seq - 1]) return fail(new Error('unexpected phase acknowledgment'));
        phases.push(message);
        session.notify();
    });
    const phase = name => session.wait(() => phases.find(record => record.phase === name));
    const send = message => child.send(message, error => { if (error) fail(error); });
    send({ type: 'start', ...config });
    return {
        child, phases, records, phase,
        record: type => session.wait(() => records.find(record => record.type === type)),
        release(record) {
            assert.equal(record, phases.at(-1)); assert.equal(record.seq, allowed); allowed++;
            send({ type: 'continue', candidateId: config.candidateId, seq: record.seq, phase: record.phase });
        },
        terminate: () => session.terminate(), close: () => session.close(),
        get exit() { return session.exit; }, get closed() { return session.closed; },
        get stderr() { return session.collector.stderr; }, get fault() { return session.collector.fault; },
    };
}
module.exports = { PHASES, spawnCandidate };
