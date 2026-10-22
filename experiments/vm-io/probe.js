'use strict';
// ==============================================================================
// probe.js -- runs the fixed experimental sequence (Issue #11 task section 5)
// against an adapter and records structured JSONL evidence.
// ------------------------------------------------------------------------------
// Probe code, not a production adapter, and not a frozen product contract.
//
// Usage:
//   node probe.js <ifvms|bocfel>
//
// The sequence and the fixture are IDENTICAL for every adapter (no fixture
// changes between candidate comparisons).  Every record preserves the exact
// native output bytes (whitespace, prompt behavior, ordering); marker
// extraction is derived data, never a replacement for the raw transcript.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { createIfvmsAdapter } = require('./adapters/ifvms-adapter.js');
const { createBocfelAdapter } = require('./adapters/bocfel-adapter.js');

// experiments/vm-io -> experiments -> repository root
const VM_IO_DIR = __dirname;
const RESULTS_DIR = path.join(VM_IO_DIR, 'results');
const REPO_ROOT = path.dirname(path.dirname(VM_IO_DIR));
const STORY = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'fixture.z5');

const MARKER_RE = /\[(?:F\d{2}|DIAG|MARKERS|LOC):[^\]]*\]/g;

// The fixed experimental sequence.  Step 1 is the adapter start (the VM runs
// to its first input boundary); every later step delivers one input.
const SEQUENCE = [
    { id: 'S01-startup', purpose: 'load fixture; observe startup output and effects before player input (F01/A10)' },
    { id: 'S02-markers', input: { kind: 'line', text: 'markers' }, purpose: 'internal state snapshot: startup counter, turn count (F01)' },
    { id: 'S03-look', input: { kind: 'line', text: 'look' }, purpose: 'scene description (F02/A13)' },
    { id: 'S04-inventory-empty', input: { kind: 'line', text: 'inventory' }, purpose: 'inventory while empty (F03)' },
    { id: 'S05-take-panel', input: { kind: 'line', text: 'take panel' }, purpose: 'recognized-but-failed action; measure turn advance (F05/A14); chime expected at turn 3 (F06)' },
    { id: 'S06-take-key', input: { kind: 'line', text: 'take brass key' }, purpose: 'take the movable item (F03)' },
    { id: 'S07-inventory-full', input: { kind: 'line', text: 'inventory' }, purpose: 'inventory shows the key: real state change (F03/A13)' },
    { id: 'S08-north', input: { kind: 'line', text: 'north' }, purpose: 'valid movement (F04/A13); duplicate-token room (F09)' },
    { id: 'S09-examine-token', input: { kind: 'line', text: 'examine token' }, purpose: 'duplicate display names: parser disambiguation prompt (F09/A19)' },
    { id: 'S10-answer-blue', input: { kind: 'line', text: 'blue' }, purpose: 'resolve disambiguation; identity marker with object number (F09/A19)' },
    { id: 'S11-inspect-token', input: { kind: 'line', text: 'inspect token' }, purpose: 'second identity resolution via INSPECT meta verb (F09/A19)' },
    { id: 'S12-answer-red', input: { kind: 'line', text: 'red' }, purpose: 'resolve to the other token; distinct object number (F09/A19)' },
    { id: 'S13-seed-42', input: { kind: 'line', text: 'seed 42' }, purpose: 'enter predictable RNG mode (F08)' },
    { id: 'S14-roll-1', input: { kind: 'line', text: 'roll' }, purpose: 'seeded draw 1 of 3 (F08)' },
    { id: 'S15-roll-2', input: { kind: 'line', text: 'roll' }, purpose: 'seeded draw 2 of 3 (F08)' },
    { id: 'S16-roll-3', input: { kind: 'line', text: 'roll' }, purpose: 'seeded draw 3 of 3 (F08)' },
    { id: 'S17-reseed-42', input: { kind: 'line', text: 'seed 42' }, purpose: 'reseed for within-interpreter determinism check (F08)' },
    { id: 'S18-roll-1b', input: { kind: 'line', text: 'roll' }, purpose: 're-seeded draw 1 of 3 -- must equal S14 within this interpreter (F08)' },
    { id: 'S19-roll-2b', input: { kind: 'line', text: 'roll' }, purpose: 're-seeded draw 2 of 3 -- must equal S15 within this interpreter (F08)' },
    { id: 'S20-roll-3b', input: { kind: 'line', text: 'roll' }, purpose: 're-seeded draw 3 of 3 -- must equal S16 within this interpreter (F08)' },
    { id: 'S21-menu', input: { kind: 'line', text: 'menu' }, purpose: 'open character-input menu: expect a character-input boundary (F07/A16)' },
    { id: 'S22-menu-key-b', input: { kind: 'char', key: 'b' }, purpose: 'deliver a single key at the character boundary (F07/A16)' },
    { id: 'S23-unlock-door', input: { kind: 'line', text: 'unlock vault door with brass key' }, purpose: 'protected gate: explicit unlock (F10)' },
    { id: 'S24-open-door', input: { kind: 'line', text: 'open vault door' }, purpose: 'protected gate: explicit open (F10)' },
    { id: 'S25-north-vault', input: { kind: 'line', text: 'north' }, purpose: 'enter the vault (F04/F10)' },
    { id: 'S26-examine-pedestal', input: { kind: 'line', text: 'examine pedestal' }, purpose: 'extension anchor marker (F11)' },
    { id: 'S27-put-key-pedestal', input: { kind: 'line', text: 'put brass key on pedestal' }, purpose: 'reach the terminal state through the authored path (F12): victory marker, score sequence, endgame prompt' },
    { id: 'S28-quit', input: { kind: 'line', text: 'quit' }, purpose: 'leave the endgame through the authored quit path (F12)' },
    { id: 'S29-confirm-quit', input: { kind: 'line', text: 'y' }, purpose: 'confirm quit: VM should reach a clean halt (F12)' },
    { id: 'S30-shutdown', purpose: 'adapter shutdown; observe final execution status (halted/error)' },
];

// Static evidence-output map: no dynamic path segments anywhere.
const EVIDENCE_FILES = {
    ifvms: path.join(RESULTS_DIR, 'probe-ifvms.jsonl'),
    bocfel: path.join(RESULTS_DIR, 'probe-bocfel.jsonl'),
};

function extractMarkers(text) {
    return text.match(MARKER_RE) || [];
}

async function runSequence(adapterName) {
    // The output file is selected statically from the fixed evidence map; no
    // externally supplied value ever reaches a file path in this tool.
    const outPath = adapterName === 'ifvms' ? EVIDENCE_FILES.ifvms : EVIDENCE_FILES.bocfel;
    const story = fs.readFileSync(STORY);
    const storySha256 = crypto.createHash('sha256').update(story).digest('hex');

    let adapter;
    if (adapterName === 'ifvms') {
        adapter = createIfvmsAdapter(story);
    } else if (adapterName === 'bocfel') {
        adapter = createBocfelAdapter(STORY);
    } else {
        throw new Error('unknown adapter: ' + adapterName);
    }

    const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
    const write = (obj) => out.write(JSON.stringify(obj) + '\n');

    write({
        type: 'run',
        adapter: adapterName,
        runtime: adapter.describe(),
        story: STORY,
        story_sha256: storySha256,
        sequence_version: 1,
        platform: {
            os: os.type() + ' ' + os.release(),
            arch: os.arch(),
            node: process.version,
        },
        started: new Date().toISOString(),
    });

    const steps = [];
    let statusBefore = null;
    for (let i = 0; i < SEQUENCE.length; i++) {
        const step = SEQUENCE[i];
        const t0 = Date.now();
        let result;
        try {
            if (step.input) {
                result = await adapter.send(step.input);
            } else if (i === 0) {
                result = adapter.start();
                if (result && typeof result.then === 'function') result = await result;
            } else if (step.id === 'S30-shutdown' && adapter.shutdown) {
                result = await adapter.shutdown();
            } else {
                result = { status: 'running', delta: '', output: '', note: 'no-op step' };
            }
        } catch (e) {
            result = { status: 'error', delta: '', output: '', error: String(e && e.message ? e.message : e) };
        }
        const record = {
            type: 'step',
            n: i + 1,
            id: step.id,
            purpose: step.purpose,
            input: step.input || null,
            status_before: statusBefore,
            status_after: result.status,
            output_delta: result.delta,
            markers: extractMarkers(result.delta),
            time_ms: Date.now() - t0,
        };
        if (result.error) record.error = result.error;
        if (result.stderr) record.stderr = result.stderr;
        write(record);
        steps.push(record);
        statusBefore = result.status;
    }

    // Derived summary: the facts the evidence doc and tests build on.
    const rollSteps = steps.filter((s) => /^S(1[4-6]|1[89]|20)-/.test(s.id));
    const rolls = rollSteps.flatMap((s) => s.markers
        .filter((m) => m.startsWith('[F08:roll='))
        .map((m) => Number(m.slice('[F08:roll='.length, -1))));
    const turnMarkers = steps.flatMap((s) => s.markers
        .filter((m) => m.startsWith('[F06:turn='))
        .map((m) => Number(m.slice('[F06:turn='.length, -1))));
    write({
        type: 'run_end',
        finished: new Date().toISOString(),
        final_status: statusBefore,
        halted: statusBefore === 'halted',
        seeded_draws_first_pass: rolls.slice(0, 3),
        seeded_draws_second_pass: rolls.slice(3, 6),
        within_interpreter_rng_reproducible: rolls.length >= 6
            && JSON.stringify(rolls.slice(0, 3)) === JSON.stringify(rolls.slice(3, 6)),
        turn_marker_values: turnMarkers,
    });
    out.end();
    await new Promise((r) => out.on('close', r));
    return { steps, finalStatus: statusBefore };
}

module.exports = { runSequence, SEQUENCE, STORY, extractMarkers };

if (require.main === module) {
    // Literal dispatch only: the adapter name from argv never reaches a file
    // path or a dynamic member lookup.
    if (process.argv[2] === 'ifvms') {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        runSequence('ifvms')
            .then(({ finalStatus }) => console.error('probe complete: ifvms final_status=' + finalStatus))
            .catch((e) => { console.error('probe failed: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
    } else if (process.argv[2] === 'bocfel') {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        runSequence('bocfel')
            .then(({ finalStatus }) => console.error('probe complete: bocfel final_status=' + finalStatus))
            .catch((e) => { console.error('probe failed: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
    } else {
        console.error('usage: node probe.js <ifvms|bocfel>');
        process.exit(1);
    }
}
