'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPublisher, publishEvidence } = require('../evidence-writer.js');
const { createLocks } = require('./evidence-lock.js');
const { launch } = require('./evidence-writer-parent.js');
const { preserveEvidence } = require('./evidence-preservation.js');

const OLD = '{"type":"run","label":"old"}\n{"type":"run_end","ok":true}\n';
const NEW = '{"type":"run","label":"new-é"}\n{"type":"step","output_delta":"native >\\n"}\n{"type":"run_end","ok":true}\n';

async function sandbox(fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zirp-evidence-writer-'));
    const outPath = path.join(root, 'probe-ifvms.jsonl');
    const peer = path.join(root, 'probe-bocfel.jsonl');
    fs.writeFileSync(outPath, OLD); fs.writeFileSync(peer, OLD);
    const children = [];
    const start = async (options = {}) => {
        const child = launch({ outPath, contents: NEW, pause: [], ...options });
        children.push(child); await child.start(); return child;
    };
    const inventory = (...extra) => assert.deepEqual(fs.readdirSync(root).sort(),
        ['probe-ifvms.jsonl', 'probe-bocfel.jsonl', ...extra].sort());
    try { await fn({ root, outPath, peer, start, inventory }); }
    finally {
        // Never remove a child artifact before exit and final pipe closure.
        await Promise.all(children.map(child => child.dispose()));
        assert.ok(path.dirname(root) === fs.realpathSync(os.tmpdir()) || path.dirname(root) === os.tmpdir());
        assert.ok(path.basename(root).startsWith('zirp-evidence-writer-'));
        fs.rmSync(root, { recursive: true });
        assert.equal(fs.existsSync(root), false);
    }
}

function canonical(file, contents) {
    assert.deepEqual(fs.readFileSync(file), Buffer.from(contents));
    const records = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
    assert.equal(records[0].type, 'run'); assert.equal(records.at(-1).type, 'run_end');
}

test('overlapping publishers conflict; unique stages preserve peer bytes and sequential order', { timeout: 120000 }, async t => {
    await sandbox(async ({ outPath, peer, start, inventory }) => {
        const owner = await start({ pause: ['stage-progress', 'stage-closed', 'published'] });
        const partial = await owner.phase();
        assert.ok(partial.written > 0 && partial.written < partial.length);
        const prefix = fs.readFileSync(partial.stage);
        assert.deepEqual(prefix, Buffer.from(NEW).subarray(0, partial.written));
        const contender = await start();
        assert.equal((await contender.result()).code, 'E_EVIDENCE_CONFLICT');
        assert.equal((await contender.finish()).exit.code, 1);
        canonical(outPath, OLD); canonical(peer, OLD);
        assert.deepEqual(fs.readFileSync(partial.stage), prefix);
        // An independently guarded adapter can publish while the first waits.
        const independent = await start({ outPath: peer });
        assert.equal((await independent.result()).ok, true);
        assert.equal((await independent.finish()).exit.code, 0);
        canonical(peer, NEW);
        owner.release(partial);
        const complete = await owner.phase();
        assert.equal(complete.phase, 'stage-closed');
        canonical(outPath, OLD); canonical(complete.stage, NEW);
        owner.release(complete);
        const published = await owner.phase();
        assert.equal(published.phase, 'published');
        canonical(outPath, NEW); canonical(peer, NEW);
        owner.release(published);
        assert.equal((await owner.result()).ok, true);
        t.diagnostic(JSON.stringify(await owner.finish()));
        await publishEvidence(outPath, OLD);
        canonical(outPath, OLD); canonical(peer, NEW); inventory();
    });
});

test('exclusive stage collision never truncates or removes a pre-existing artifact', async () => {
    await sandbox(async ({ outPath, peer, inventory }) => {
        const token = 'a'.repeat(32);
        const stage = outPath + '.' + process.pid + '.' + token + '.tmp';
        fs.writeFileSync(stage, 'peer-owned sentinel');
        await assert.rejects(createPublisher({ nonce: () => token })(outPath, NEW), { code: 'EEXIST', published: false });
        assert.equal(fs.readFileSync(stage, 'utf8'), 'peer-owned sentinel');
        canonical(outPath, OLD); canonical(peer, OLD); inventory(path.basename(stage));
    });
});

for (const operation of ['create', 'write', 'close', 'rename', 'owner-write']) {
    test('handled ' + operation + ' failure preserves canonical/peer bytes and removes owned artifacts', async () => {
        await sandbox(async ({ outPath, peer, inventory }) => {
            let injected = false;
            const boom = () => { injected = true; throw Object.assign(new Error('injected ' + operation), { code: 'EIO' }); };
            const io = { ...fsp,
                rename: async (...args) => { if (operation === 'rename') boom(); return fsp.rename(...args); },
                open: async (file, flags) => {
                    const stage = file.endsWith('.tmp');
                    if (stage && operation === 'create') boom();
                    const handle = await fsp.open(file, flags);
                    return { stat: () => handle.stat(),
                        write: async (...args) => {
                            if ((stage && operation === 'write') || (!stage && operation === 'owner-write')) {
                                if (!injected) { await handle.write(args[0], 0, 1, 0); boom(); }
                            }
                            return handle.write(...args);
                        },
                        close: async () => { if (stage && operation === 'close' && !injected) boom(); return handle.close(); },
                    };
                },
            };
            await assert.rejects(createPublisher({ io })(outPath, NEW), { code: 'EIO', published: false });
            assert.ok(injected); canonical(outPath, OLD); canonical(peer, OLD); inventory();
        });
    });
}

test('short writes reconstruct exact bytes; zero progress rejects and cleans up', async () => {
    await sandbox(async ({ outPath, peer, inventory }) => {
        let writes = 0;
        const ioFor = zero => ({ ...fsp, open: async (...args) => {
            const handle = await fsp.open(...args);
            return { stat: () => handle.stat(), close: () => handle.close(),
                write: (...[bytes, offset, length, position]) => {
                    writes++;
                    return zero && args[0].endsWith('.tmp') ? { bytesWritten: 0 } : handle.write(bytes, offset, Math.min(3, length), position);
                } };
        } });
        await createPublisher({ io: ioFor(false) })(outPath, NEW);
        assert.ok(writes > 10); canonical(outPath, NEW); canonical(peer, OLD); inventory();
        await assert.rejects(createPublisher({ io: ioFor(true) })(outPath, OLD), { code: 'E_EVIDENCE_WRITE', published: false });
        canonical(outPath, NEW); canonical(peer, OLD); inventory();
    });
});

for (const phase of ['guard-acquired', 'stage-progress', 'stage-closed', 'published']) {
    test('acknowledged interruption at ' + phase + ' is reaped and supervised cleanup owns only its artifacts', { timeout: 120000 }, async t => {
        await sandbox(async ({ outPath, peer, start, inventory }) => {
            const child = await start({ pause: [phase] });
            const ack = await child.phase();
            assert.equal(ack.phase, phase);
            const prefix = phase === 'stage-progress' ? fs.readFileSync(ack.stage) : null;
            if (prefix) {
                assert.ok(prefix.length > 0 && prefix.length < Buffer.byteLength(NEW));
                assert.deepEqual(prefix, Buffer.from(NEW).subarray(0, ack.written));
            }
            if (phase === 'stage-closed') canonical(ack.stage, NEW);
            canonical(outPath, phase === 'published' ? NEW : OLD); canonical(peer, OLD);
            const outcome = await child.finish(true);
            assert.ok(outcome.exit.code !== 0 || outcome.exit.signal, 'interrupted process is not a clean exit');
            canonical(outPath, phase === 'published' ? NEW : OLD); canonical(peer, OLD);
            if (prefix) assert.deepEqual(fs.readFileSync(ack.stage), prefix);
            if (phase === 'stage-closed') canonical(ack.stage, NEW);
            // No age/PID reclamation: a new publisher fails closed first.
            await assert.rejects(publishEvidence(outPath, OLD), { code: 'E_EVIDENCE_CONFLICT' });
            const expectedOwner = { token: ack.token, pid: ack.pid };
            assert.deepEqual(JSON.parse(fs.readFileSync(ack.owner, 'utf8')), expectedOwner);
            assert.equal(ack.stage, outPath + '.' + ack.pid + '.' + ack.token + '.tmp');
            if (fs.existsSync(ack.stage)) fs.unlinkSync(ack.stage);
            fs.unlinkSync(ack.owner); fs.rmdirSync(ack.guard);
            inventory();
            await publishEvidence(outPath, OLD); canonical(outPath, OLD); canonical(peer, OLD); inventory();
            t.diagnostic(JSON.stringify({ phase, prefixBytes: prefix?.length || 0, ...outcome }));
        });
    });
}

test('replaced internal guard aborts before rename and leaves replacement owner untouched', { timeout: 120000 }, async () => {
    await sandbox(async ({ outPath, peer, start, inventory }) => {
        const child = await start({ pause: ['stage-closed'] });
        const ack = await child.phase();
        fs.unlinkSync(ack.owner); fs.rmdirSync(ack.guard);
        fs.mkdirSync(ack.guard); fs.writeFileSync(ack.owner, 'replacement owner');
        child.release(ack);
        const result = await child.result();
        assert.equal(result.code, 'E_EVIDENCE_OWNERSHIP'); assert.equal(result.published, false);
        assert.equal((await child.finish()).exit.code, 1);
        canonical(outPath, OLD); canonical(peer, OLD);
        assert.equal(fs.readFileSync(ack.owner, 'utf8'), 'replacement owner');
        assert.equal(fs.existsSync(ack.stage), false); inventory(path.basename(ack.guard));
    });
});

test('cleanup failure after rename reports visible publication without rollback', async () => {
    await sandbox(async ({ outPath, peer, inventory }) => {
        const io = { ...fsp, rmdir: async () => { throw Object.assign(new Error('injected cleanup failure'), { code: 'EIO' }); } };
        await assert.rejects(createPublisher({ io })(outPath, NEW), error => {
            assert.equal(error.code, 'E_EVIDENCE_CLEANUP'); assert.equal(error.published, true);
            assert.match(error.message, /published=true.*cleanup failed/); return true;
        });
        canonical(outPath, NEW); canonical(peer, OLD); inventory(path.basename(outPath) + '.publish.lock');
        assert.deepEqual(fs.readdirSync(outPath + '.publish.lock'), []);
    });
});

test('outer lock folder replacement rejects reads/restores and cannot release a new owner', async () => {
    await sandbox(async ({ root, outPath, peer, inventory }) => {
        const locks = path.join(root, 'isolated-locks');
        const withLocks = createLocks(locks);
        const file = path.join(locks, 'evidence-ifvms.lock');
        let restored = false, resumeReplacement;
        let replacement;
        await assert.rejects(withLocks(['ifvms'], 1000, async lease => {
            fs.unlinkSync(file); fs.rmdirSync(locks);
            replacement = withLocks(['ifvms'], 1000, async replacementLease => {
                replacementLease.assertOwned();
                await new Promise(resolve => { resumeReplacement = resolve; });
            });
            assert.throws(() => { lease.assertOwned(); restored = true; }, { code: 'E_EVIDENCE_OWNERSHIP' });
        }), { code: 'E_EVIDENCE_OWNERSHIP' });
        assert.equal(restored, false); assert.ok(fs.existsSync(file), 'former owner did not unlink replacement');
        resumeReplacement(); await replacement;
        assert.deepEqual(fs.readdirSync(locks), []); fs.rmdirSync(locks);
        canonical(outPath, OLD); canonical(peer, OLD); inventory();
    });
});

test('old outer locks are not stolen by timestamp', async () => {
    await sandbox(async ({ root, outPath, peer, inventory }) => {
        const locks = path.join(root, 'isolated-locks'); fs.mkdirSync(locks);
        const file = path.join(locks, 'evidence-ifvms.lock'); fs.writeFileSync(file, 'dead owner requires deliberate recovery');
        fs.utimesSync(file, 0, 0);
        await assert.rejects(createLocks(locks)(['ifvms'], 100, () => assert.fail('must not acquire')), /timed out/);
        assert.equal(fs.readFileSync(file, 'utf8'), 'dead owner requires deliberate recovery');
        fs.unlinkSync(file); fs.rmdirSync(locks); canonical(outPath, OLD); canonical(peer, OLD); inventory();
    });
});

test('adapter-specific preservation restores only its receipt and preserves original absence', async () => {
    await sandbox(async ({ root, outPath, peer, inventory }) => {
        const locks = path.join(root, 'isolated-locks');
        await createLocks(locks)(['ifvms'], 1000, async lease => {
            const restore = preserveEvidence(outPath, lease);
            await publishEvidence(outPath, NEW);
            await publishEvidence(peer, NEW);
            await restore();
            canonical(outPath, OLD); canonical(peer, NEW);
            fs.unlinkSync(outPath);
            const restoreAbsent = preserveEvidence(outPath, lease);
            await publishEvidence(outPath, NEW);
            await restoreAbsent();
            assert.equal(fs.existsSync(outPath), false); canonical(peer, NEW);
            await publishEvidence(outPath, OLD);
        });
        assert.deepEqual(fs.readdirSync(locks), []); fs.rmdirSync(locks); inventory();
    });
});

test('Windows open-reader rename refusal fails without torn canonical bytes', {
    skip: process.platform !== 'win32' && 'Windows sharing-refusal case', timeout: 120000,
}, async () => {
    await sandbox(async ({ outPath, peer, start, inventory }) => {
        const child = await start({ pause: ['stage-closed'] });
        const before = await child.phase(); assert.equal(before.phase, 'stage-closed');
        const reader = fs.openSync(outPath, 'r');
        try {
            child.release(before);
            const result = await child.result();
            assert.equal(result.ok, false); assert.equal(result.published, false);
            assert.ok(['EPERM', 'EACCES'].includes(result.code), JSON.stringify(result));
            assert.equal((await child.finish()).exit.code, 1);
            assert.equal(fs.readFileSync(reader, 'utf8'), OLD);
            canonical(outPath, OLD); canonical(peer, OLD); inventory();
        } finally { fs.closeSync(reader); }
    });
});

test('internal publication guard still excludes after an outer lock folder is deleted', { timeout: 120000 }, async () => {
    await sandbox(async ({ root, outPath, peer, start, inventory }) => {
        const locks = path.join(root, 'isolated-locks');
        await assert.rejects(createLocks(locks)(['ifvms'], 1000, async lease => {
            const owner = await start({ pause: ['stage-closed'] });
            const ack = await owner.phase();
            fs.unlinkSync(path.join(locks, 'evidence-ifvms.lock')); fs.rmdirSync(locks);
            assert.throws(() => lease.assertOwned(), { code: 'E_EVIDENCE_OWNERSHIP' });
            const contender = await start();
            assert.equal((await contender.result()).code, 'E_EVIDENCE_CONFLICT');
            assert.equal((await contender.finish()).exit.code, 1);
            canonical(outPath, OLD); canonical(peer, OLD); canonical(ack.stage, NEW);
            await owner.finish(true);
            assert.deepEqual(JSON.parse(fs.readFileSync(ack.owner)), { token: ack.token, pid: ack.pid });
            fs.unlinkSync(ack.stage); fs.unlinkSync(ack.owner); fs.rmdirSync(ack.guard);
            inventory();
        }), { code: 'E_EVIDENCE_OWNERSHIP' });
        canonical(outPath, OLD); canonical(peer, OLD); inventory();
    });
});

test('replaced guard at release reports published bytes and preserves replacement', { timeout: 120000 }, async () => {
    await sandbox(async ({ outPath, peer, start, inventory }) => {
        const child = await start({ pause: ['published'] });
        const ack = await child.phase();
        fs.unlinkSync(ack.owner); fs.rmdirSync(ack.guard);
        fs.mkdirSync(ack.guard); fs.writeFileSync(ack.owner, 'replacement owner');
        child.release(ack);
        const result = await child.result();
        assert.equal(result.ok, false); assert.equal(result.published, true);
        assert.equal(result.code, 'E_EVIDENCE_OWNERSHIP');
        assert.equal((await child.finish()).exit.code, 1);
        canonical(outPath, NEW); canonical(peer, OLD);
        assert.equal(fs.readFileSync(ack.owner, 'utf8'), 'replacement owner');
        inventory(path.basename(ack.guard));
    });
});

test('released outer lease cannot authorize a later receipt restore', async () => {
    await sandbox(async ({ root, outPath, peer, inventory }) => {
        const locks = path.join(root, 'isolated-locks');
        let restore, savedLease;
        await createLocks(locks)(['ifvms'], 1000, lease => {
            savedLease = lease; restore = preserveEvidence(outPath, lease);
        });
        await publishEvidence(outPath, NEW);
        assert.throws(() => savedLease.assertOwned(), { code: 'E_EVIDENCE_OWNERSHIP' });
        await assert.rejects(restore(), { code: 'E_EVIDENCE_OWNERSHIP' });
        canonical(outPath, NEW); canonical(peer, OLD);
        assert.deepEqual(fs.readdirSync(locks), []); fs.rmdirSync(locks); inventory();
    });
});
