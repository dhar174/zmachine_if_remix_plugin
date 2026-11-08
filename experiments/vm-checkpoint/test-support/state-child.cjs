'use strict';

// One-shot test scaffold. No cache injection/clearing, vendor edits or bypass
// flags: both start and fresh restore use the ordinary checkpoint core.
const fs = require('node:fs');
const { createIfvmsAdapter } = require('../../vm-io/adapters/ifvms-adapter.js');
const { captureCheckpoint, restoreCheckpoint } = require('../lib/checkpoint-core.js');
const { machineFingerprint } = require('../lib/fingerprint.js');
const { observe, digest } = require('./state-support.cjs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const story = fs.readFileSync(request.story);
let adapter;
try {
    adapter = request.checkpoint
        ? restoreCheckpoint(JSON.parse(fs.readFileSync(request.checkpoint, 'utf8')), story)
        : createIfvmsAdapter(Buffer.from(story));
    if (!request.checkpoint) adapter.start();
} catch (error) {
    process.stdout.write(JSON.stringify({ ready: false, code: error.code, error: error.message }) + '\n');
    process.exitCode = 2;
}
if (adapter && process.exitCode !== 2) {
    const copy = value => JSON.parse(JSON.stringify(value));
    const before = observe(adapter);
    const steps = (request.inputs || []).map(input => copy(adapter.send(input)));
    const state = observe(adapter), fingerprint = machineFingerprint(adapter);
    let envelope = null, captureError = null;
    try { envelope = captureCheckpoint(adapter, { storySha256: digest(story), storySize: story.length }); }
    catch (error) { captureError = { code: error.code, message: error.message }; }
    const suffixSteps = (request.suffix || []).map(input => copy(adapter.send(input)));
    process.stdout.write(JSON.stringify({ ready: true, before, steps, state, fingerprint, envelope, captureError,
        suffixSteps, finalState: observe(adapter), finalFingerprint: machineFingerprint(adapter) }) + '\n');
}
