'use strict';
// ==============================================================================
// helpers.js -- shared harness for the G1-B checkpoint probe tests.
// ------------------------------------------------------------------------------
// Discipline: EVERY interpreter instance gets its own copy of the story bytes
// (the vendored ZVM mutates the buffer in place), and every RESTORE runs in a
// fresh child process (lib/runner.js) so no VM can survive through a closure,
// singleton, or shared buffer.  Reference continuations run in-process from a
// pristine copy; restored continuations run in children that only ever see the
// checkpoint file plus the pinned fixture path.
// ==============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { supervise } = require('../test-support/bounded-child.cjs');
const { createIfvmsAdapter, REVISION } = require('../../vm-io/adapters/ifvms-adapter.js');
const { captureCheckpoint } = require('../lib/checkpoint-core.js');
const { machineFingerprint, fingerprintDiff, normalizeRngDraws } = require('../lib/fingerprint.js');
const { sha256Hex } = require('../lib/checkpoint-format.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'fixture.z5');
const LOOPSTORY = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'negative', 'loopstory.z5');
const SPINLOOP = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'negative', 'spinloop.z5');
const RUNNER = path.join(__dirname, '..', 'lib', 'runner.js');
const RESULTS_DIR = path.join(__dirname, '..', 'results');

const STORY = fs.readFileSync(FIXTURE);
const STORY_SHA256 = sha256Hex(STORY);
const LOOPSTORY_SHA256 = sha256Hex(fs.readFileSync(LOOPSTORY));

function createInstance() {
    return createIfvmsAdapter(Buffer.from(STORY));
}

const line = (text) => ({ kind: 'line', text });
const key = (k) => ({ kind: 'char', key: k });

function drive(adapter, inputs) {
    const settled = [];
    for (const input of inputs) settled.push(adapter.send(input));
    return settled;
}

function capture(adapter) {
    return captureCheckpoint(adapter, { storySha256: STORY_SHA256, storySize: STORY.length });
}

function writeEnvelope(envelope, name) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const p = path.join(RESULTS_DIR, name);
    fs.writeFileSync(p, JSON.stringify(envelope));
    return p;
}

// Fresh in-process run: prefix + suffix without any checkpoint, as the
// uninterrupted reference every restored continuation must match.
function runReference(prefix, suffix) {
    const adapter = createInstance();
    const startSettled = adapter.start();
    const preSteps = drive(adapter, prefix);
    const postSteps = drive(adapter, suffix);
    return { adapter, startSettled, preSteps, postSteps, fingerprint: machineFingerprint(adapter) };
}

// Spawn the restore runner child.  Returns { child, promise } where promise
// resolves to { ready, readyError, fingerprint, steps, exitCode, stderr }.
// `suffix` inputs are sent after the ready signal; `ops` extra requests
// (fingerprint/serialize) are sent after the suffix.
function spawnRestore(envelopePath, opts = {}) {
    const args = [RUNNER, '--story', FIXTURE, '--checkpoint', envelopePath];
    if (opts.outputLimit !== undefined) args.push('--output-limit', String(opts.outputLimit));
    if (opts.stallSerializeMs) args.push('--stall-serialize-ms', String(opts.stallSerializeMs));
    if (opts.out) args.push('--out', opts.out);
    if (opts.selftest) args.push('--selftest', opts.selftest);
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const result = { ready: false, readyError: null, fingerprint: null, steps: [], exitCode: null, child };
    const session = supervise(child, msg => {
        if (msg.ready === true) {
            result.ready = true; result.readyFingerprint = msg.fingerprint; result.fingerprint = msg.fingerprint;
        } else if (msg.ready === false) result.readyError = msg.error + (msg.code ? ' [' + msg.code + ']' : '');
        else if (msg.step) result.steps.push(msg.step);
        else if (msg.fingerprint) result.fingerprint = msg.fingerprint;
    });
    result.session = session;
    Object.defineProperties(result, {
        stderr: { get: () => session.collector.stderr },
        fault: { get: () => session.collector.fault },
        eligible: { get: () => session.eligible },
    });
    result.exited = new Promise(resolve => child.on('exit', code => { result.exitCode = code; resolve(code); }));
    let cursor = 0;
    result.nextMessage = timeout => session.wait(() => {
        const msg = session.collector.records[cursor];
        if (msg) { cursor++; return msg; }
    }, timeout || 30000);
    result.run = async suffix => {
        const boot = await result.nextMessage();
        if (boot.ready !== true) { result.readyError ||= 'no ready signal'; return result; }
        for (const input of suffix) {
            child.stdin.write(JSON.stringify({ input }) + '\n'); await result.nextMessage();
        }
        child.stdin.write(JSON.stringify({ op: 'fingerprint' }) + '\n'); await result.nextMessage();
        return result;
    };
    result.finish = async () => {
        child.stdin.write(JSON.stringify({ op: 'exit' }) + '\n'); return awaitExit(result, 10000);
    };
    return result;
}
async function awaitExit(rec, timeoutMs) {
    const closed = await rec.session.wait(() => rec.session.closed, timeoutMs || 10000, true);
    if (!rec.session.exit) throw new Error('missing child exit observation');
    rec.exitCode = closed.code; return closed.code;
}

module.exports = {
    REPO_ROOT, FIXTURE, LOOPSTORY, SPINLOOP, RUNNER, RESULTS_DIR,
    STORY, STORY_SHA256, LOOPSTORY_SHA256, REVISION,
    createInstance, line, key, drive, capture, writeEnvelope,
    runReference, spawnRestore, awaitExit,
    machineFingerprint, fingerprintDiff, normalizeRngDraws,
};
