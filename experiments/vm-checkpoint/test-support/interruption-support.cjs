'use strict';

// Only Node builtins here: the child imports PHASES before its startup gate.
// Test control and private stdout are distinct; neither channel publishes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const PHASES = ['startup-entered', 'restored-boundary', 'mutation-complete',
    'serialization-entered', 'capture-complete', 'partial-write-complete', 'candidate-finished'];

function spawnCandidate(config) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(__dirname, 'interruption-child.cjs'), [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env, windowsHide: true,
    });
    const phases = [], records = [], waiters = new Set();
    let allowed = 1, fault = null, buffer = '', stderr = '', exit = null, closed = null;
    const notify = () => { for (const wake of [...waiters]) wake(); };
    const fail = error => { fault ||= error; notify(); };
    child.on('error', fail);
    child.on('message', message => {
        if (!message || message.type !== 'phase' || message.candidateId !== config.candidateId
            || message.seq !== allowed || message.seq !== phases.length + 1
            || message.phase !== PHASES[message.seq - 1]) return fail(new Error('unexpected phase acknowledgment'));
        phases.push(message); notify();
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            try {
                const record = JSON.parse(line);
                assert.equal(record.type, ['steps', 'finished'][records.length]);
                records.push(record);
            } catch (error) { fail(error); }
        }
        notify();
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', (code, signal) => { exit = { code, signal }; notify(); });
    child.on('close', (code, signal) => {
        closed = { code, signal };
        if (buffer) fail(new Error('truncated private stdout record'));
        notify();
    });
    function wait(predicate, timeout = 30000, allowClosed = false) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => done(new Error('deadline waiting for interruption evidence')), timeout);
            function done(error, value) { clearTimeout(timer); waiters.delete(check); error ? reject(error) : resolve(value); }
            function check() {
                if (fault && !allowClosed) return done(fault);
                const value = predicate();
                if (value) return done(null, value);
                if (closed && !allowClosed) done(new Error('child closed before expected evidence'));
            }
            waiters.add(check); check();
        });
    }
    const send = message => child.send(message, error => { if (error) fail(error); });
    // All listeners exist before the child is allowed to start work.
    send({ type: 'start', ...config });
    return {
        child, phases, records,
        phase: name => wait(() => phases.find(record => record.phase === name)),
        record: type => wait(() => records.find(record => record.type === type)),
        release(record) {
            assert.equal(record, phases.at(-1)); assert.equal(record.seq, allowed);
            allowed++;
            send({ type: 'continue', candidateId: config.candidateId, seq: record.seq, phase: record.phase });
        },
        async terminate() {
            if (!closed && !exit) assert.equal(child.kill('SIGKILL'), true, 'kill request delivered');
            return wait(() => closed, 10000, true);
        },
        close: () => wait(() => closed, 10000, true),
        get exit() { return exit; }, get closed() { return closed; },
        get stderr() { return stderr; }, get fault() { return fault; },
    };
}
module.exports = { PHASES, spawnCandidate };
