'use strict';
// Internal probe publisher, not a durable store or a filesystem security boundary.
// Tests substitute filesystem operations/barriers; the CLI supplies neither.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function fault(code, message) {
    return Object.assign(new Error(message), { code });
}

function sameFile(a, b) {
    return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}

async function writeAll(handle, bytes, progress = async () => {}) {
    let offset = 0;
    while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) {
            throw fault('E_EVIDENCE_WRITE', 'evidence write made invalid progress');
        }
        offset += bytesWritten;
        await progress(offset);
    }
}

function createPublisher({ io = fs, nonce = () => crypto.randomBytes(16).toString('hex'),
    onPhase = async () => {} } = {}) {
    return async function publishEvidence(outPath, contents) {
        const token = nonce();
        if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('invalid internal publication nonce');
        const guard = outPath + '.publish.lock';
        const owner = path.join(guard, 'owner.json');
        const stage = outPath + '.' + process.pid + '.' + token + '.tmp';
        const ownerBytes = Buffer.from(JSON.stringify({ token, pid: process.pid }) + '\n');
        const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
        const context = { outPath, guard, owner, stage, token, pid: process.pid, length: bytes.length };
        let directoryIdentity, ownerIdentity, stageIdentity, handle;
        let ownerComplete = false, published = false, failure;
        const cleanupErrors = [];
        const assertDirectory = async () => {
            const current = await io.lstat(guard);
            if (!current.isDirectory() || !sameFile(current, directoryIdentity)) {
                throw fault('E_EVIDENCE_OWNERSHIP', 'evidence publication guard was replaced');
            }
        };
        const assertOwner = async () => {
            try {
                await assertDirectory();
                const current = await io.lstat(owner);
                if (!sameFile(current, ownerIdentity) || !(await io.readFile(owner)).equals(ownerBytes)) {
                    throw new Error('owner changed');
                }
            } catch (e) {
                throw fault('E_EVIDENCE_OWNERSHIP', 'lost evidence publication ownership: ' + e.message);
            }
        };
        const unlinkOwned = async (file, identity) => {
            let current;
            try { current = await io.lstat(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
            if (!sameFile(current, identity)) throw fault('E_EVIDENCE_OWNERSHIP', 'refusing to remove replaced evidence artifact');
            await io.unlink(file);
        };
        try {
            try { await io.mkdir(guard); } catch (e) {
                if (e.code === 'EEXIST') throw fault('E_EVIDENCE_CONFLICT', 'E_EVIDENCE_CONFLICT: evidence publisher already owns target');
                throw e;
            }
            directoryIdentity = await io.lstat(guard);
            handle = await io.open(owner, 'wx');
            ownerIdentity = await handle.stat();
            await writeAll(handle, ownerBytes);
            await handle.close();
            handle = undefined;
            ownerComplete = true;
            await onPhase('guard-acquired', context);
            handle = await io.open(stage, 'wx');
            stageIdentity = await handle.stat();
            await writeAll(handle, bytes, (written) => onPhase('stage-progress', { ...context, written }));
            await handle.close();
            handle = undefined;
            await onPhase('stage-closed', context);
            await assertOwner();
            if (!sameFile(await io.lstat(stage), stageIdentity)) {
                throw fault('E_EVIDENCE_OWNERSHIP', 'evidence staging file was replaced');
            }
            await io.rename(stage, outPath);
            published = true;
            await onPhase('published', context);
        } catch (e) { failure = e; }
        // A failed close is retried for cleanup, and remains a failure even if
        // the retry succeeds. No recursive removal can delete a peer's guard.
        if (handle) {
            try { await handle.close(); } catch (e) { cleanupErrors.push(e); }
        }
        if (stageIdentity && !published) {
            try { await unlinkOwned(stage, stageIdentity); } catch (e) { cleanupErrors.push(e); }
        }
        if (directoryIdentity) {
            try {
                if (ownerComplete) await assertOwner();
                else await assertDirectory();
                if (ownerIdentity) await unlinkOwned(owner, ownerIdentity);
                await io.rmdir(guard);
            } catch (e) { cleanupErrors.push(e); }
        }
        if (failure || cleanupErrors.length) {
            failure = failure || fault(cleanupErrors[0].code === 'E_EVIDENCE_OWNERSHIP'
                ? 'E_EVIDENCE_OWNERSHIP' : 'E_EVIDENCE_CLEANUP', 'evidence published but cleanup failed');
            failure.published = published;
            failure.cleanupErrors = cleanupErrors;
            failure.message += '; published=' + published + (cleanupErrors.length ? '; cleanup failed: ' + cleanupErrors.map(e => e.message).join('; ') : '');
            throw failure;
        }
        return { published: true };
    };
}

module.exports = { createPublisher, publishEvidence: createPublisher() };
