'use strict';
// Cross-process serialization for the canonical evidence files: node --test
// executes test files concurrently, and several suites run probe sequences
// that write results/probe-*.jsonl in place (probe.js has a static evidence
// path by design).  Writers and readers of those files take one lock per
// adapter; lock files live under the gitignored results/tmp-negative/ so a
// crashed run cannot wedge future runs permanently (locks older than ten
// minutes are treated as stale and stolen).

const fs = require('node:fs');
const path = require('node:path');

const LOCK_DIR = path.join(__dirname, '..', 'results', 'tmp-negative');
const POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 300000;
const STALE_MS = 600000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function withLocks(names, timeoutMs, fn) {
    const waitLimit = timeoutMs || DEFAULT_TIMEOUT_MS;
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    const deadline = Date.now() + waitLimit;
    const held = [];
    const release = () => {
        while (held.length) fs.rmSync(held.pop(), { force: true });
    };
    try {
        for (const name of names) {
            const lockPath = path.join(LOCK_DIR, 'evidence-' + name + '.lock');
            for (;;) {
                try {
                    fs.closeSync(fs.openSync(lockPath, 'wx'));
                    held.push(lockPath);
                    break;
                } catch (e) {
                    if (e.code !== 'EEXIST') throw e;
                    let stale = false;
                    try {
                        stale = (Date.now() - fs.statSync(lockPath).mtimeMs) > STALE_MS;
                    } catch { /* vanished between open and stat; retry */ }
                    if (stale) {
                        fs.rmSync(lockPath, { force: true });
                        continue;
                    }
                    if (Date.now() > deadline) {
                        throw new Error('timed out acquiring evidence lock: ' + name);
                    }
                    await sleep(POLL_MS);
                }
            }
        }
        return await fn();
    } finally {
        release();
    }
}

module.exports = { withLocks };
