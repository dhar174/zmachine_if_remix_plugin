'use strict';
// Probe failure-injection tests (P1 review finding on probe.js): unexpected
// step errors must stop the sequence, and the CLI must exit nonzero for a
// failed or incomplete run instead of logging "probe complete" with exit 0.
//
// The evidence output path is static by design (no externally supplied value
// ever reaches a file path in probe.js), so these tests SAVE the canonical
// evidence files before writing runs and RESTORE them afterwards; a failed
// run's JSONL is a test artifact, never committed evidence.  Each test holds
// the per-adapter evidence lock (see evidence-lock.js) so concurrent test
// files never interleave writes into the same JSONL.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runSequence } = require('../probe.js');
const { withLocks } = require('./evidence-lock.js');
const { preserveEvidence } = require('./evidence-preservation.js');

const VM_IO_DIR = path.dirname(__dirname);
const PROBE = path.join(VM_IO_DIR, 'probe.js');
const RESULTS_DIR = path.join(VM_IO_DIR, 'results');
const CANONICAL = {
    ifvms: path.join(RESULTS_DIR, 'probe-ifvms.jsonl'),
    bocfel: path.join(RESULTS_DIR, 'probe-bocfel.jsonl'),
};

function readRunEnd(adapterName, lease) {
    lease.assertOwned();
    return fs.readFileSync(CANONICAL[adapterName], 'utf8').trim().split('\n')
        .map(JSON.parse)
        .find((r) => r.type === 'run_end');
}

// Own only the named adapter. Never snapshot/restore a peer without its lock.
function preserveCanonicalEvidence(adapterName, lease) {
    return preserveEvidence(CANONICAL[adapterName], lease);
}

test('runSequence: an injected step error stops the sequence and marks the run incomplete', { timeout: 60000 }, async () => {
    await withLocks(['bocfel'], 60000, async (lease) => {
        const restore = preserveCanonicalEvidence('bocfel', lease);
        try {
            let sends = 0;
            let shutdowns = 0;
            const stub = {
                describe: () => ({ runtime: 'stub', revision: 'test', mode: 'injected failure', license: 'n/a' }),
                start: async () => ({ status: 'waiting_for_line_input', delta: 'stub>', output: 'stub>' }),
                send: async () => {
                    sends++;
                    return { status: 'error', delta: '', output: '', error: 'injected failure' };
                },
                shutdown: async () => { shutdowns++; return { status: 'error', delta: '', output: '' }; },
            };
            const res = await runSequence('bocfel', { createAdapter: () => stub });
            assert.strictEqual(res.finalStatus, 'error');
            assert.strictEqual(res.stepErrors, 1);
            assert.strictEqual(sends, 1, 'stopOnError halts after the first errored step');
            assert.strictEqual(shutdowns, 1, 'the stopped run cleans its adapter up');
            const runEnd = readRunEnd('bocfel', lease);
            assert.strictEqual(runEnd.final_status, 'error');
            assert.strictEqual(runEnd.incomplete, true);
            assert.strictEqual(runEnd.steps_completed, 2);
            assert.strictEqual(runEnd.step_errors, 1);
        } finally {
            await restore();
        }
    });
});

test('probe CLI: a successful ifvms run exits 0 and reports completion', { timeout: 300000 }, () => {
    return withLocks(['ifvms'], 300000, async (lease) => {
        const restore = preserveCanonicalEvidence('ifvms', lease);
        try {
            const r = spawnSync(process.execPath, [PROBE, 'ifvms'], { encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
            assert.strictEqual(r.error, undefined);
            assert.strictEqual(r.status, 0, 'exit status must be 0, stderr: ' + r.stderr);
            assert.match(r.stderr, /probe complete: ifvms final_status=halted/);
            assert.strictEqual(readRunEnd('ifvms', lease).final_status, 'halted');
        } finally {
            await restore();
        }
    });
});

test('probe CLI: a bocfel launch that cannot spawn exits nonzero and reports the incomplete run', { timeout: 300000 }, () => {
    // A configured override whose command does not exist: the adapter records
    // the spawn failure, the errored first step stops the sequence, and the
    // CLI must fail loudly instead of reporting success.
    return withLocks(['bocfel'], 300000, async (lease) => {
        const restore = preserveCanonicalEvidence('bocfel', lease);
        try {
            const r = spawnSync(process.execPath, [PROBE, 'bocfel'], {
                encoding: 'utf8',
                timeout: 180000, maxBuffer: 1024 * 1024,
                env: { ...process.env, BOCFEL_COMMAND: 'definitely-missing-bocfel-binary-9x7' },
            });
            assert.strictEqual(r.error, undefined);
            assert.strictEqual(r.status, 1, 'a failed run must exit 1, stderr: ' + r.stderr);
            assert.match(r.stderr, /probe failed: bocfel final_status=error/);
            const runEnd = readRunEnd('bocfel', lease);
            assert.strictEqual(runEnd.final_status, 'error');
            assert.strictEqual(runEnd.incomplete, true);
        } finally {
            await restore();
        }
    });
});
