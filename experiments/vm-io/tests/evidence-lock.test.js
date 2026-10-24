'use strict';
// Regression tests for the evidence-lock exclusion contract.
//
// Defect found during the G1-B baseline run (2026-10-23): the evidence locks
// used to live in results/tmp-negative/, the same directory that
// negative.test.js clearTampered() deletes recursively.  Deleting a held
// lock file let a second process acquire it, and two concurrent probe runs
// then tore results/probe-bocfel.jsonl mid-record (deterministic on a
// machine with WSL bocfel: 5/5 full-suite runs produced a corrupt run
// record; CI never saw it because the bocfel negative tests skip there).
//
// Contract under test:
//   1. Locks must keep excluding while results/tmp-negative/ is deleted
//      underneath them (the exact clearTampered() behavior).
//   2. A released lock must be acquirable again (no wedging).
//   3. The lock directory itself must not live inside the cleanup zone.
//
// A dedicated lock name is used so these tests never contend with the real
// evidence suites; the deleted-directory hazard applied to every name
// because the lock DIRECTORY was shared.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withLocks, LOCK_DIR } = require('./evidence-lock.js');

const CHILD = path.join(__dirname, 'evidence-lock-child.js');
const LOCK_NAME = 'evidence-lock-regression';
const TMP_NEGATIVE = path.join(__dirname, '..', 'results', 'tmp-negative');

function childAttempt() {
    const r = spawnSync(process.execPath, [CHILD, LOCK_NAME], { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.error, undefined, 'child spawned cleanly: ' + (r.error && r.error.message));
    return { code: r.status, out: String(r.stdout) };
}

test('held evidence locks keep excluding while tmp-negative is deleted underneath them', { timeout: 60000 }, async () => {
    await withLocks([LOCK_NAME], 10000, async () => {
        fs.mkdirSync(TMP_NEGATIVE, { recursive: true });
        // Exactly what negative.test.js clearTampered() does.
        fs.rmSync(TMP_NEGATIVE, { recursive: true, force: true });
        const r = childAttempt();
        assert.strictEqual(r.code, 1, 'a second process must not acquire a held lock; stdout: ' + r.out);
        assert.match(r.out, /timed out acquiring evidence lock/);
    });
});

test('a released evidence lock is acquirable again', { timeout: 60000 }, () => {
    const r = childAttempt();
    assert.strictEqual(r.code, 0, 'lock must be acquirable after release; stdout: ' + r.out);
});

test('the lock directory is not inside the tmp-negative cleanup zone', () => {
    fs.mkdirSync(TMP_NEGATIVE, { recursive: true });
    const rel = path.relative(path.resolve(TMP_NEGATIVE), path.resolve(LOCK_DIR));
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel),
        'lock dir must resolve outside tmp-negative, got: ' + rel);
    assert.ok(!path.resolve(LOCK_DIR).startsWith(path.resolve(TMP_NEGATIVE) + path.sep),
        'lock dir must not be a descendant of tmp-negative');
});
