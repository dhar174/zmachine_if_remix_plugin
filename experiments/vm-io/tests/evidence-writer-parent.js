'use strict';
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

function bounded(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    })]).finally(() => clearTimeout(timer));
}

function launch(config) {
    const id = crypto.randomBytes(16).toString('hex');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(__dirname, 'evidence-writer-child.js'), [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env,
    });
    const queue = [];
    let waiter, failure, exit, close, sequence = 0, terminal = false, booted = false;
    let stdout = '', stderr = '', bytes = 0;
    const fail = (error) => {
        failure = failure || error;
        if (waiter) { waiter.reject(failure); waiter = undefined; }
    };
    const closed = new Promise(resolve => {
        child.on('error', fail);
        child.on('exit', (code, signal) => { exit = { code, signal }; });
        child.on('close', (code, signal) => {
            close = { code, signal };
            if (!terminal) fail(new Error('child closed before result/barrier termination'));
            else if (waiter) fail(new Error('child closed before expected message'));
            resolve();
        });
    });
    child.stdout.on('data', data => {
        bytes += data.length;
        if (bytes <= 16384) stdout += data.toString('utf8');
        else { fail(new Error('unexpected child pipe overflow')); child.kill('SIGKILL'); }
    });
    child.stderr.on('data', data => {
        bytes += data.length;
        if (bytes <= 16384) stderr += data.toString('utf8');
        else { fail(new Error('unexpected child pipe overflow')); child.kill('SIGKILL'); }
    });
    child.on('message', message => {
        if (message.type === 'phase') {
            if (message.id !== id || message.sequence !== ++sequence || !config.pause.includes(message.phase) ||
                message.outPath !== config.outPath || message.pid !== child.pid || !/^[a-f0-9]{32}$/.test(message.token) ||
                message.guard !== config.outPath + '.publish.lock' || message.owner !== path.join(message.guard, 'owner.json') ||
                message.stage !== config.outPath + '.' + child.pid + '.' + message.token + '.tmp') {
                fail(new Error('invalid phase acknowledgment')); return;
            }
        } else if (message.type === 'result') {
            if (message.id !== id || terminal) { fail(new Error('invalid terminal result')); return; }
            terminal = true;
        } else if (message.type !== 'boot' || booted) { fail(new Error('unexpected IPC message')); return; }
        else booted = true;
        if (waiter) { const next = waiter; waiter = undefined; next.resolve(message); }
        else queue.push(message);
    });
    const next = async (type) => {
        if (failure) throw failure;
        const message = queue.length ? queue.shift() : await bounded(new Promise((resolve, reject) => {
            assert.equal(waiter, undefined); waiter = { resolve, reject };
        }), 30000, 'missing child acknowledgment: ' + type).finally(() => { waiter = undefined; });
        assert.equal(message.type, type, 'unexpected child message: ' + JSON.stringify(message));
        return message;
    };
    return {
        start: async () => { await next('boot'); child.send({ type: 'start', id, ...config }); },
        phase: () => next('phase'), result: () => next('result'),
        release: message => child.send({ type: 'release', id, phase: message.phase, sequence: message.sequence }),
        finish: async (kill = false) => {
            if (kill && !close) { terminal = true; child.kill('SIGKILL'); }
            await bounded(closed, 10000, 'child did not exit and close pipes');
            assert.ok(exit, 'exit observed separately from close');
            assert.deepEqual(close, exit);
            assert.equal(stdout, ''); assert.equal(stderr, '');
            if (failure) throw failure;
            return { exit, close };
        },
        dispose: async () => {
            if (!close) { terminal = true; child.kill('SIGKILL'); }
            await bounded(closed, 10000, 'cleanup could not reap child');
            assert.ok(exit); assert.ok(close);
        },
    };
}

module.exports = { launch };
