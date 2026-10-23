'use strict';
// Shared integration-assertion module: runs the fixed probe sequence against
// one adapter and asserts the acceptance-mapping evidence.  Used identically
// for both candidates (ifvms integration, bocfel integration) so that no
// fixture or sequence divergence can creep in between comparisons.
//
// These are adapter-integration layer tests: they exercise the real
// interpreters against the committed fixture and record honestly-labeled
// PRECURSOR evidence for A10/A13/A14/A16/A19/A23 (engine artifacts such as
// receipts, stable IDs and commit semantics do not exist at this layer).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runSequence } = require('../probe.js');
const { withLocks } = require('./evidence-lock.js');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const EVIDENCE_IFVMS = path.join(RESULTS_DIR, 'probe-ifvms.jsonl');
const EVIDENCE_BOCFEL = path.join(RESULTS_DIR, 'probe-bocfel.jsonl');

// runSequence writes the canonical evidence file for the adapter; tests then
// read back that file for the run_end summary.  Writes and reads are
// serialized per adapter because node --test runs test files concurrently.
function runFor(adapterName) {
    const cacheKey = 'run-' + adapterName;
    if (!globalThis[cacheKey]) {
        globalThis[cacheKey] = withLocks([adapterName], 300000, () => runSequence(adapterName));
    }
    return globalThis[cacheKey];
}

async function readRunEnd(adapterName) {
    const p = adapterName === 'ifvms' ? EVIDENCE_IFVMS : EVIDENCE_BOCFEL;
    return withLocks([adapterName], 60000, () =>
        fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse).find((r) => r.type === 'run_end'));
}

function integrate(adapterName, skipReason) {
    const opt = { skip: skipReason || false };
    if (skipReason) {
        test(adapterName + ' integration (skipped)', opt, () => {});
        return;
    }

    let steps, byId;

    test(adapterName + ': full sequence runs to a clean halt', { timeout: 180000 }, async () => {
        ({ steps } = await runFor(adapterName));
        byId = Object.fromEntries(steps.map((s) => [s.id, s]));
        assert.ok(steps.length >= 29, 'all sequence steps executed');
        assert.strictEqual(byId['S28-quit'].output_delta, '', 'endgame QUIT halts without confirmation output');
        assert.strictEqual(byId['S28-quit'].status_after, 'halted', 'VM halts on the endgame QUIT answer');
        assert.strictEqual(byId['S29-confirm-quit'].output_delta, '', 'post-halt delivery is a no-op: no resume-past-quit output');
        assert.strictEqual(byId['S29-confirm-quit'].status_after, 'halted', 'status remains halted after the refused post-halt input');
    });

    // A10 precursor: startup code executes before the first input prompt.
    test(adapterName + ' A10 (precursor): startup side effect executes before the first prompt', async () => {
        await runFor(adapterName);
        const s01 = byId['S01-startup'];
        assert.strictEqual(s01.status_after, 'waiting_for_line_input');
        const idxMarker = s01.output_delta.indexOf('[F01:startup=7]');
        assert.ok(idxMarker >= 0, 'startup marker present');
        assert.ok(idxMarker < s01.output_delta.indexOf('>'), 'marker printed before the first prompt');
        assert.ok(idxMarker < s01.output_delta.indexOf('G1A IO Probe Fixture'), 'marker printed before the banner');
    });

    // A13 precursor: successful authored commands produce real state and
    // transcript changes.
    test(adapterName + ' A13 (precursor): ordinary commands change state and transcript', async () => {
        await runFor(adapterName);
        assert.ok(byId['S03-look'].output_delta.includes('[LOC:chamber]'));
        assert.ok(byId['S04-inventory-empty'].output_delta.includes('nothing'), 'inventory empty before taking');
        assert.ok(byId['S06-take-key'].output_delta.includes('Taken.'), 'library take acknowledgment');
        assert.ok(byId['S07-inventory-full'].output_delta.includes('brass key'), 'inventory reflects the taken key');
        assert.ok(byId['S08-north'].output_delta.includes('[LOC:gallery]'), 'movement changed location');
    });

    // A14 precursor: a recognized failed action consumes a turn and runs
    // timers.
    test(adapterName + ' A14 (precursor): failed action advances the turn and fires the scheduled event', async () => {
        await runFor(adapterName);
        const s05 = byId['S05-take-panel'];
        assert.ok(/hardly portable|fixed in place/.test(s05.output_delta), 'the action failed in fiction');
        assert.ok(s05.markers.includes('[F06:turn=3]'), 'turn counter advanced on the failed action');
        assert.ok(s05.markers.includes('[F06:event=chime]'), 'scheduled event fired at turn 3');
        // Turn markers advance strictly by one per non-meta turn.
        const turns = steps.flatMap((s) => s.markers
            .filter((m) => m.startsWith('[F06:turn='))
            .map((m) => Number(m.slice('[F06:turn='.length, -1))));
        assert.ok(turns.length >= 15, 'turn markers recorded through the run');
        for (let i = 1; i < turns.length; i++) {
            assert.strictEqual(turns[i], turns[i - 1] + 1, 'turn counter strictly consecutive');
        }
    });

    // A16 precursor: character prompts require the character-input path.
    test(adapterName + ' A16 (precursor): character menu uses a distinct character-input boundary', async () => {
        await runFor(adapterName);
        const s21 = byId['S21-menu'];
        assert.strictEqual(s21.status_after, 'waiting_for_character_input', 'menu is a character boundary');
        const s22 = byId['S22-menu-key-b'];
        assert.ok(s22.markers.includes('[F07:menu-key=98]'), 'key delivered as ZSCII 98 (b)');
        assert.ok(s22.markers.includes('[F07:menu-choice=beta]'), 'choice resolved from character input');
        assert.strictEqual(s22.status_after, 'waiting_for_line_input', 'game resumed after the menu');
    });

    // A19 precursor: duplicate display names do not establish identical
    // identity; disambiguation and internal object numbers are observable.
    // BLUE is resolved through EXAMINE (F09 marker), RED through the INSPECT
    // meta verb (DIAG marker); both carry internal object numbers.
    test(adapterName + ' A19 (precursor): duplicate names are distinguishable identities', async () => {
        await runFor(adapterName);
        const s09 = byId['S09-examine-token'];
        assert.ok(/Which do you mean/.test(s09.output_delta), 'parser disambiguation prompt observed');
        const blue = byId['S10-answer-blue'].output_delta.match(/\[F09:token-id=BLUE object#(\d+)\]/);
        const red = byId['S12-answer-red'].output_delta.match(/\[DIAG:inspect-object#(\d+)/);
        assert.ok(blue && red, 'both identities resolved with object-number evidence');
        assert.notStrictEqual(Number(blue[1]), Number(red[1]), 'same display name, distinct object numbers');
    });

    // A23 precursor: read-only inspection is distinct from issuing a native
    // command (meta MARKERS/INSPECT never run the turn daemon).
    test(adapterName + ' A23 (precursor): diagnostic inspection does not advance time', async () => {
        await runFor(adapterName);
        assert.ok(!/\[F06:turn=\d+\]/.test(byId['S02-markers'].output_delta), 'MARKERS ran no daemon');
        assert.ok(!/\[F06:turn=\d+\]/.test(byId['S11-inspect-token'].output_delta), 'INSPECT ran no daemon');
    });

    // F10/F11/F12 and RNG determinism.
    test(adapterName + ' gate, anchor, terminal state and RNG determinism', async () => {
        await runFor(adapterName);
        assert.ok(byId['S23-unlock-door'].markers.includes('[F10:door-unlocked]'));
        assert.ok(byId['S24-open-door'].markers.includes('[F10:door-opened]'));
        assert.ok(byId['S25-north-vault'].output_delta.includes('[LOC:vault]'));
        assert.ok(byId['S26-examine-pedestal'].markers.includes('[F11:anchor=pedestal]'));
        const s27 = byId['S27-put-key-pedestal'];
        assert.ok(s27.markers.includes('[F12:terminal=victory]'), 'terminal state reached through the authored path');
        assert.ok(/Would you like to RESTART, RESTORE a saved game or QUIT/.test(s27.output_delta), 'library end sequence observed');
    });

    test(adapterName + ' run_end summary: halted with reproducible seeded draws', async () => {
        await runFor(adapterName);
        const runEnd = await readRunEnd(adapterName);
        assert.strictEqual(runEnd.final_status, 'halted');
        assert.strictEqual(runEnd.halted, true);
        assert.strictEqual(runEnd.within_interpreter_rng_reproducible, true);
        assert.notDeepStrictEqual(runEnd.seeded_draws_first_pass, []);
        assert.deepStrictEqual(runEnd.seeded_draws_first_pass, runEnd.seeded_draws_second_pass);
    });
}

module.exports = { integrate };
