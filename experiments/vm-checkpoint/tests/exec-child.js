'use strict';
// Fresh-process STORY executor for kill tests (G1-B probe).  Same stdin/out
// protocol as lib/runner.js but starting a story directly instead of
// restoring a checkpoint -- used for the unbounded-execution (spinloop)
// deadline kill, which a checkpoint-based runner cannot reach (a story that
// never reaches an input boundary can never be checkpointed).
// argv: node exec-child.js --story <path>   (static paths from the parent)

const fs = require('node:fs');
const readline = require('node:readline');
const { createIfvmsAdapter } = require('../../vm-io/adapters/ifvms-adapter.js');
const { machineFingerprint } = require('../lib/fingerprint.js');
const { sha256Hex } = require('../lib/checkpoint-format.js');

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

const storyPathIdx = process.argv.indexOf('--story');
if (storyPathIdx < 0) {
    emit({ ready: false, error: '--story is required' });
    process.exit(2);
}
const story = fs.readFileSync(process.argv[storyPathIdx + 1]);
const adapter = createIfvmsAdapter(Buffer.from(story));

// start() runs the game to the first input boundary -- or, for a
// nonterminating story, never returns (the parent enforces the deadline).
try {
    const settled = adapter.start();
    emit({ ready: true, status: settled.status, storySha256: sha256Hex(story) });
} catch (e) {
    emit({ ready: false, error: String(e && e.message ? e.message : e) });
    process.exit(2);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (lineStr) => {
    if (!lineStr.trim()) return;
    let msg;
    try { msg = JSON.parse(lineStr); } catch { emit({ error: 'bad request line' }); return; }
    try {
        if (msg.op === 'fingerprint') emit({ fingerprint: machineFingerprint(adapter) });
        else if (msg.op === 'exit') process.exit(0);
        else if (msg.input) emit({ step: adapter.send(msg.input) });
        else emit({ error: 'unrecognized request' });
    } catch (e) {
        emit({ error: String(e && e.message ? e.message : e) });
    }
});
rl.on('close', () => process.exit(0));
