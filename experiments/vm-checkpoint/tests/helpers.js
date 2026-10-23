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
    if (opts.outputLimit) args.push('--output-limit', String(opts.outputLimit));
    if (opts.stallSerializeMs) args.push('--stall-serialize-ms', String(opts.stallSerializeMs));
    if (opts.out) args.push('--out', opts.out);
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const result = { ready: false, readyError: null, fingerprint: null, steps: [], exitCode: null, stderr: '' };
    let stdoutBuf = '';
    let pendingResolve = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk;
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
            const lineStr = stdoutBuf.slice(0, idx);
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!lineStr.trim()) continue;
            let msg;
            try { msg = JSON.parse(lineStr); } catch { result.stderr += 'unparseable stdout: ' + lineStr + '\n'; continue; }
            if (msg.ready === true) {
                result.ready = true;
                result.readyFingerprint = msg.fingerprint;
                result.fingerprint = msg.fingerprint;
            } else if (msg.ready === false) {
                result.readyError = msg.error + (msg.code ? ' [' + msg.code + ']' : '');
            } else if (msg.step) {
                result.steps.push(msg.step);
            } else if (msg.fingerprint) {
                result.fingerprint = msg.fingerprint;
            }
            if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(msg); }
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { result.stderr += c; });

    const nextMessage = (timeoutMs) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for runner message')), timeoutMs || 30000);
        pendingResolve = (msg) => { clearTimeout(timer); resolve(msg); };
    });

    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    result.exited = exited;
    result.child = child;
    result.nextMessage = nextMessage;

    result.run = async (suffix) => {
        const boot = await nextMessage(30000);
        if (boot.ready !== true) { result.readyError = result.readyError || 'no ready signal'; return result; }
        result.ready = true;
        for (const input of suffix) {
            child.stdin.write(JSON.stringify({ input }) + '\n');
            await nextMessage(30000);
        }
        child.stdin.write(JSON.stringify({ op: 'fingerprint' }) + '\n');
        await nextMessage(30000);
        // The child stays alive after run(): tests may send further inputs or
        // ops (e.g. refused-input probes on a halted restore).  Callers end
        // the child via finish() or kill().
        return result;
    };
    result.finish = async () => {
        child.stdin.write(JSON.stringify({ op: 'exit' }) + '\n');
        return awaitExit(result, 10000);
    };
    return result;
}

// Await a child's exit; fail the test if it does not die within the timeout
// (the "no surviving child processes" evidence).
async function awaitExit(rec, timeoutMs) {
    const code = await Promise.race([
        rec.exited,
        new Promise((_, reject) => setTimeout(() => reject(new Error('child process did not exit within ' + timeoutMs + 'ms (leaked)')), timeoutMs || 10000)),
    ]);
    rec.exitCode = code;
    return code;
}

module.exports = {
    REPO_ROOT, FIXTURE, LOOPSTORY, SPINLOOP, RUNNER, RESULTS_DIR,
    STORY, STORY_SHA256, LOOPSTORY_SHA256, REVISION,
    createInstance, line, key, drive, capture, writeEnvelope,
    runReference, spawnRestore, awaitExit,
    machineFingerprint, fingerprintDiff, normalizeRngDraws,
};
