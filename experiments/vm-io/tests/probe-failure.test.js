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

const VM_IO_DIR = path.dirname(__dirname);
const PROBE = path.join(VM_IO_DIR, 'probe.js');
const RESULTS_DIR = path.join(VM_IO_DIR, 'results');
const CANONICAL = {
    ifvms: path.join(RESULTS_DIR, 'probe-ifvms.jsonl'),
    bocfel: path.join(RESULTS_DIR, 'probe-bocfel.jsonl'),
};

function readRunEnd(adapterName) {
    return fs.readFileSync(CANONICAL[adapterName], 'utf8').trim().split('\n')
        .map(JSON.parse)
        .find((r) => r.type === 'run_end');
}

// Saves both canonical evidence files and returns a restore function.  A
// missing file (never expected in this repository) restores by deletion.
function preserveCanonicalEvidence() {
    const saved = {};
    for (const [name, p] of Object.entries(CANONICAL)) {
        saved[name] = { existed: fs.existsSync(p), bytes: fs.existsSync(p) ? fs.readFileSync(p) : null };
    }
    return () => {
        for (const [name, s] of Object.entries(saved)) {
            if (s.existed) fs.writeFileSync(CANONICAL[name], s.bytes);
            else fs.rmSync(CANONICAL[name], { force: true });
        }
    };
}

test('runSequence: an injected step error stops the sequence and marks the run incomplete', { timeout: 60000 }, async () => {
    await withLocks(['bocfel'], 60000, async () => {
        const restore = preserveCanonicalEvidence();
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
            const runEnd = readRunEnd('bocfel');
            assert.strictEqual(runEnd.final_status, 'error');
            assert.strictEqual(runEnd.incomplete, true);
            assert.strictEqual(runEnd.steps_completed, 2);
            assert.strictEqual(runEnd.step_errors, 1);
        } finally {
            restore();
        }
    });
});

test('probe CLI: a successful ifvms run exits 0 and reports completion', { timeout: 300000 }, () => {
    return withLocks(['ifvms'], 300000, () => {
        const restore = preserveCanonicalEvidence();
        try {
            const r = spawnSync('node', [PROBE, 'ifvms'], { encoding: 'utf8' });
            assert.strictEqual(r.status, 0, 'exit status must be 0, stderr: ' + r.stderr);
            assert.match(r.stderr, /probe complete: ifvms final_status=halted/);
            assert.strictEqual(readRunEnd('ifvms').final_status, 'halted');
        } finally {
            restore();
        }
    });
});

test('probe CLI: a bocfel launch that cannot spawn exits nonzero and reports the incomplete run', { timeout: 300000 }, () => {
    // A configured override whose command does not exist: the adapter records
    // the spawn failure, the errored first step stops the sequence, and the
    // CLI must fail loudly instead of reporting success.
    return withLocks(['bocfel'], 300000, () => {
        const restore = preserveCanonicalEvidence();
        try {
            const r = spawnSync('node', [PROBE, 'bocfel'], {
                encoding: 'utf8',
                env: { ...process.env, BOCFEL_COMMAND: 'definitely-missing-bocfel-binary-9x7' },
            });
            assert.notStrictEqual(r.status, 0, 'a failed run must exit nonzero, stderr: ' + r.stderr);
            assert.match(r.stderr, /probe failed: bocfel final_status=error/);
            const runEnd = readRunEnd('bocfel');
            assert.strictEqual(runEnd.final_status, 'error');
            assert.strictEqual(runEnd.incomplete, true);
        } finally {
            restore();
        }
    });
});
