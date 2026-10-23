'use strict';
// ==============================================================================
// roundtrip.test.js -- the G1-B boundary matrix (Issue #12 sections 3-4).
// ------------------------------------------------------------------------------
// For every boundary case, two or more independent repetitions:
//   1. reference  -- one uninterrupted in-process run of prefix+suffix from a
//      pristine story copy (the oracle).
//   2. probe      -- a second run drives prefix only, captures a checkpoint,
//      drops the interpreter, and a FRESH CHILD PROCESS (lib/runner.js)
//      restores from the checkpoint file alone and applies the identical
//      input suffix.
// Comparisons (see docs/evidence/g1-vm-recovery.md for the rules):
//   - full output/grid output equality after every suffix step (never only
//     fixture markers), normalized for unseeded-RNG draws, which are host
//     entropy per process and must NOT be equal;
//   - status sequence and event/marker ordering equality;
//   - machine-state fingerprint equality at the end (ram/stack/globals
//     digests, pc, frames, seed, request log), except fields fingerprintDiff
//     allowlists for declared reasons;
//   - no-republish: the restored instance's transcript at the first suffix
//     step equals the reference's, proving neither a replayed opening nor
//     lost text.
// The pending request must be reconstructed: the ready fingerprint's request
// log tail is the unanswered request of the checkpointed kind.
// ==============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const {
    createInstance, line, key, drive, capture, writeEnvelope,
    runReference, spawnRestore, awaitExit,
    machineFingerprint, fingerprintDiff, normalizeRngDraws,
} = require('./helpers.js');
const { extractMarkers } = require('../../vm-io/probe.js');

const REPS = [1, 2];

// The victory path: chamber -> gallery -> through the vault door -> pedestal.
const VICTORY = [
    line('look'), line('take brass key'), line('north'),
    line('unlock vault door with brass key'), line('open vault door'), line('north'),
    line('put brass key on pedestal'),
];

const CASES = [
    {
        name: 'initial line prompt (before any input)',
        prefix: [],
        suffix: [line('look'), line('inventory')],
    },
    {
        name: 'later line prompt after movement, a turn-consuming failed action, and the daemon chime',
        prefix: [line('look'), line('take stone panel'), line('take brass key'), line('north')],
        suffix: [line('inventory'), line('south'), line('seed 7'), line('roll')],
        expectTranscriptContains: ['[F06:event=chime]'],
    },
    {
        name: 'parser-disambiguation line prompt with unresolved input',
        prefix: [line('north'), line('examine token')],
        suffix: [line('blue'), line('inspect token')],
    },
    {
        name: 'read_char menu before the choice is consumed',
        prefix: [line('menu')],
        suffix: [key('b'), line('inventory')],
    },
    {
        name: 'boundary immediately after a menu answer (no duplicate delivery)',
        prefix: [line('menu'), key('b')],
        suffix: [line('inventory'), line('look')],
        expectTranscriptContainsOnce: ['[F07:menu-choice=beta]'],
    },
    {
        name: 'seeded RNG across draws and reseeding',
        prefix: [line('seed 42'), line('roll')],
        suffix: [line('roll'), line('roll'), line('seed 7'), line('roll')],
    },
    {
        name: 'unseeded RNG mode continuation (draws are per-process entropy)',
        prefix: [line('look')],
        suffix: [line('roll'), line('look')],
        rngMode: 'unseeded',
    },
    {
        name: 'endgame prompt (deadflag=2, RESTART/RESTORE/QUIT pending)',
        prefix: VICTORY,
        suffix: [line('quit')],
        expectFinalStatus: 'halted',
        expectTranscriptContains: ['[F12:terminal=victory]'],
    },
];

test('round trips at every supported boundary match the uninterrupted reference', { timeout: 600000 }, async (t) => {
    for (const c of CASES) {
        for (const rep of REPS) {
            await t.test(`[${c.name}] repetition ${rep}`, { timeout: 180000 }, async () => {
                // 1. Uninterrupted reference.
                const ref = runReference(c.prefix, c.suffix);
                assert.deepStrictEqual(ref.fingerprint.errors, [], 'reference run must be error-free');
                for (const needle of c.expectTranscriptContains || []) {
                    assert.ok(ref.fingerprint.output.includes(needle), 'reference transcript must contain ' + needle);
                }
                for (const needle of c.expectTranscriptContainsOnce || []) {
                    assert.strictEqual(ref.fingerprint.output.split(needle).length - 1, 1, 'reference must contain ' + needle + ' exactly once');
                }

                // 2. Probe run: prefix, capture, destroy, child restore + suffix.
                const src = createInstance();
                src.start();
                drive(src, c.prefix);
                const srcFp = machineFingerprint(src);
                const env = capture(src);
                const envPath = writeEnvelope(env, `roundtrip-${sanitize(c.name)}-${rep}.json`);

                const child = spawnRestore(envPath);
                try {
                    await child.run(c.suffix);
                    assert.ok(child.ready, 'child restored: ' + (child.readyError || ''));
                    assert.strictEqual(child.readyError, null);
                    assert.strictEqual(child.steps.length, c.suffix.length, 'one step per suffix input');

                    // Pending request reconstructed: the READY fingerprint's log
                    // tail must be the unanswered request of the checkpoint kind
                    // (the final fingerprint's tail legitimately differs once the
                    // suffix has been applied).
                    const kind = env.boundary.kind;
                    if (kind !== 'halted') {
                        const tail = child.readyFingerprint.requestLog[child.readyFingerprint.requestLog.length - 1];
                        const wantRequest = kind === 'char' ? 'char' : 'line';
                        assert.strictEqual(tail.request, wantRequest, 'restored pending request kind');
                        assert.strictEqual(tail.answeredWith, null, 'restored request must be pending, not answered');
                    }

                    // Capture boundary is a real state, not the opening room:
                    // the checkpointed transcript must be non-trivial unless the
                    // case is deliberately the first prompt.
                    if (c.prefix.length > 0) {
                        assert.ok(env.payload.publishedOutput.output.length > 200, 'checkpoint carries published output');
                    }

                    // 3. Comparisons.
                    for (let k = 0; k < c.suffix.length; k++) {
                        const rs = child.steps[k];
                        const rr = ref.postSteps[k];
                        assert.strictEqual(rs.status, rr.status, `step ${k} status`);
                        assert.strictEqual(rs.errors.length, 0, `step ${k} child errors`);
                        assert.deepStrictEqual(rs.unexpectedGlk, [], `step ${k} no unexpected Glk calls in the restored continuation`);
                        const cmp = (s) => (c.rngMode === 'unseeded' ? normalizeRngDraws(s) : s);
                        assert.strictEqual(cmp(rs.delta), cmp(rr.delta), `step ${k} output delta`);
                        assert.strictEqual(cmp(rs.output), cmp(rr.output), `step ${k} full transcript (no republish, no loss)`);
                        assert.strictEqual(cmp(rs.gridOutput), cmp(rr.gridOutput), `step ${k} grid/status transcript`);
                        assert.deepStrictEqual(
                            extractMarkers(cmp(rs.delta)), extractMarkers(cmp(rr.delta)), `step ${k} marker ordering`);
                    }

                    const diffs = fingerprintDiff(ref.fingerprint, child.fingerprint);
                    const allowed = c.rngMode === 'unseeded' ? ['output'] : [];
                    const unexpected = diffs.filter((d) => !allowed.includes(d));
                    assert.deepStrictEqual(unexpected, [], 'final machine-state fingerprint differences');
                    if (c.rngMode === 'unseeded') {
                        assert.strictEqual(child.fingerprint.rngSeed, 0, 'unseeded mode keeps seed 0');
                        // Both runs must have produced structurally valid draws.
                        const rolls = (s) => extractMarkers(s.delta).filter((m) => m.startsWith('[F08:roll='));
                        for (const s of child.steps) {
                            for (const m of rolls(s)) {
                                const n = Number(m.slice('[F08:roll='.length, -1));
                                assert.ok(n >= 1 && n <= 6, 'unseeded draw in range: ' + m);
                            }
                        }
                    }
                    if (c.expectFinalStatus) {
                        assert.strictEqual(child.fingerprint.halted, true, 'final halted state');
                        assert.strictEqual(child.fingerprint.quit, true, 'final quit flag');
                    }
                } finally {
                    child.child.kill();
                    await awaitExit(child, 10000).catch(() => {});
                }
            });
        }
    }
});

test('restored halted execution refuses new input without output or state change', { timeout: 120000 }, async () => {
    const ref = runReference([...VICTORY, line('quit')], []);
    assert.strictEqual(ref.fingerprint.halted, true, 'reference ends halted');

    const src = createInstance();
    src.start();
    drive(src, [...VICTORY, line('quit')]);
    const env = capture(src);
    assert.strictEqual(env.boundary.kind, 'halted', 'halted boundary captured');
    const envPath = writeEnvelope(env, 'roundtrip-halted.json');

    const child = spawnRestore(envPath);
    try {
        await child.run([]);
        assert.ok(child.ready, 'halted checkpoint restores: ' + (child.readyError || ''));

        const before = child.fingerprint;
        child.child.stdin.write(JSON.stringify({ input: line('y') }) + '\n');
        const refused = await child.nextMessage(30000);
        assert.ok(refused.step, 'refusal produced a settled result');
        assert.strictEqual(refused.step.status, 'halted', 'status remains halted');
        assert.strictEqual(refused.step.delta, '', 'no output for refused input');
        assert.ok(
            refused.step.unexpectedGlk.some((u) => u.call === 'send-after-halt'),
            'refusal recorded as send-after-halt');
        child.child.stdin.write(JSON.stringify({ op: 'fingerprint' }) + '\n');
        const after = await child.nextMessage(30000);
        assert.strictEqual(after.fingerprint.output, before.output, 'transcript unchanged');
        assert.strictEqual(after.fingerprint.ramSha256, before.ramSha256, 'memory unchanged');
        assert.strictEqual(after.fingerprint.pc, before.pc, 'pc unchanged');
        assert.strictEqual(after.fingerprint.rngSeed, before.rngSeed, 'rng unchanged');
        assert.strictEqual(JSON.stringify(after.fingerprint.requestLog), JSON.stringify(before.requestLog), 'request log unchanged');
    } finally {
        child.child.kill();
        await awaitExit(child, 10000).catch(() => {});
    }
});

test('in-memory undo is declared-unsupported: restore_undo after restore is safe and empty', { timeout: 120000 }, async () => {
    const ref = runReference([line('look'), line('take brass key')], [line('undo')]);
    assert.ok(ref.fingerprint.undoDepth >= 0, 'reference undo depth observed');

    const src = createInstance();
    src.start();
    drive(src, [line('look'), line('take brass key')]);
    const env = capture(src);
    const envPath = writeEnvelope(env, 'roundtrip-undo.json');
    const child = spawnRestore(envPath);
    try {
        await child.run([line('undo')]);
        assert.ok(child.ready, 'restored: ' + (child.readyError || ''));
        assert.strictEqual(child.steps[0].status, 'waiting_for_line_input', 'undo attempt is handled safely');
        assert.strictEqual(child.steps[0].errors.length, 0, 'no error from empty undo');
        assert.strictEqual(child.fingerprint.undoDepth, 0, 'restored instance starts with no undo history');
        assert.ok(child.fingerprint.undoDepth <= ref.fingerprint.undoDepth, 'restored undo depth never exceeds the source history');
    } finally {
        child.child.kill();
        await awaitExit(child, 10000).catch(() => {});
    }
});

function sanitize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
