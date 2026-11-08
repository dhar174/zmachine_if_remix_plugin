'use strict';

// One-shot TEST scaffold, not the normal runner or an entropy-provider API.
// Every invocation is a fresh process. Install controlled entropy before VM
// startup/restore, count all draws, and never receive the publication path.
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
if (![0, 0.9999999999999999].includes(request.entropy)) throw new Error('invalid test entropy');
let hostDraws = 0;
Math.random = () => { hostDraws++; return request.entropy; };
const { createIfvmsAdapter } = require('../../vm-io/adapters/ifvms-adapter.js');
const { captureCheckpoint, restoreCheckpoint } = require('../lib/checkpoint-core.js');
const { sha256Hex } = require('../lib/checkpoint-format.js');
const { machineFingerprint } = require('../lib/fingerprint.js');
const story = fs.readFileSync(request.story);
const context = { storySha256: sha256Hex(story), storySize: story.length };
const adapter = request.checkpoint
    ? restoreCheckpoint(JSON.parse(fs.readFileSync(request.checkpoint, 'utf8')), story)
    : createIfvmsAdapter(Buffer.from(story));
if (!request.checkpoint) adapter.start();
const startupHostDraws = hostDraws;
const snapshot = value => JSON.parse(JSON.stringify(value));
const stepHostDraws = [];
const steps = (request.inputs || []).map(input => {
    const before = hostDraws;
    const step = snapshot(adapter.send(input));
    stepHostDraws.push(hostDraws - before);
    return step;
});
const fingerprint = machineFingerprint(adapter);
let envelope = null, captureError = null;
try { envelope = captureCheckpoint(adapter, context); }
catch (error) { captureError = { code: error.code, message: error.message }; }
const beforeSuffix = hostDraws;
const suffixSteps = (request.suffix || []).map(input => snapshot(adapter.send(input)));
process.stdout.write(JSON.stringify({ steps, fingerprint, envelope, captureError,
    suffixSteps, finalFingerprint: machineFingerprint(adapter), hostDraws,
    startupHostDraws, stepHostDraws, suffixHostDraws: hostDraws - beforeSuffix }) + '\n');
