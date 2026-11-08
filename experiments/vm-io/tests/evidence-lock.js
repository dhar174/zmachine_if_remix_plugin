'use strict';
// Outer test-harness lock: owns save/run/read/restore cycles, not just the
// publisher's final rename. Keep outside tmp-negative; never steal by age.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCK_DIR = path.join(os.tmpdir(), 'zirp-vm-io-evidence-locks');
const POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 300000;

function createLocks(lockDir) {
    return async function withLocks(names, timeoutMs, fn) {
        fs.mkdirSync(lockDir, { recursive: true });
        const deadline = Date.now() + (timeoutMs || DEFAULT_TIMEOUT_MS);
        const held = [];
        let released = false;
        const assertOne = (entry) => {
            try {
                const current = fs.lstatSync(entry.file);
                if (current.dev !== entry.identity.dev || current.ino !== entry.identity.ino ||
                    current.birthtimeMs !== entry.identity.birthtimeMs || !fs.readFileSync(entry.file).equals(entry.bytes)) {
                    throw new Error('owner changed');
                }
            } catch (e) {
                throw Object.assign(new Error('lost evidence lock ownership: ' + entry.file + ': ' + e.message),
                    { code: 'E_EVIDENCE_OWNERSHIP' });
            }
        };
        const lease = { assertOwned: () => {
            if (released || !held.length) throw Object.assign(new Error('evidence lock lease is inactive'), { code: 'E_EVIDENCE_OWNERSHIP' });
            held.forEach(assertOne);
        } };
        let failure, result;
        try {
            for (const name of [...new Set(names)].sort()) {
                if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid internal evidence lock name');
                const file = path.join(lockDir, 'evidence-' + name + '.lock');
                for (;;) {
                    let fd;
                    try { fd = fs.openSync(file, 'wx'); } catch (e) {
                        if (e.code !== 'EEXIST') throw e;
                        if (Date.now() >= deadline) throw new Error('timed out acquiring evidence lock: ' + name);
                        await new Promise(resolve => setTimeout(resolve, POLL_MS));
                        continue;
                    }
                    const bytes = Buffer.from(JSON.stringify({ token: crypto.randomBytes(16).toString('hex'), pid: process.pid }) + '\n');
                    try {
                        const identity = fs.fstatSync(fd);
                        const entry = { file, identity, bytes: Buffer.alloc(0) };
                        held.push(entry);
                        try { fs.writeFileSync(fd, bytes); }
                        finally { entry.bytes = fs.readFileSync(file); }
                    } finally { fs.closeSync(fd); }
                    break;
                }
            }
            lease.assertOwned();
            result = await fn(lease);
            lease.assertOwned();
        } catch (e) { failure = e; }
        const releaseErrors = [];
        released = true;
        while (held.length) {
            const entry = held.pop();
            try { assertOne(entry); fs.unlinkSync(entry.file); } catch (e) { releaseErrors.push(e); }
        }
        if (failure || releaseErrors.length) {
            failure = failure || releaseErrors[0];
            failure.releaseErrors = releaseErrors;
            throw failure;
        }
        return result;
    };
}

module.exports = { withLocks: createLocks(LOCK_DIR), createLocks, LOCK_DIR };
