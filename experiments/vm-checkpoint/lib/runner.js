'use strict';
// ==============================================================================
// runner.js -- fresh-process restore endpoint for the G1-B probe (Issue #12).
// ------------------------------------------------------------------------------
// Invoked by tests as:  node runner.js --story <path> --checkpoint <path>
//                               [--output-limit N] [--stall-serialize-ms N]
// All arguments are static paths/numbers supplied by the parent test; no
// environment value ever reaches an argv element or a file path here.
//
// Protocol (newline-delimited JSON on stdout, one request per stdin line):
//   -> {"ready":true,"fingerprint":{...}}       after a successful restore
//   -> {"ready":false,"error":"...","code":...} + exit 2 on restore rejection
//   stdin {"input":{"kind":"line","text":".."}} -> {"step":{status,delta,...}}
//   stdin {"input":{"kind":"char","key":"b"}}   -> {"step":{...}}
//   stdin {"op":"fingerprint"}                  -> {"fingerprint":{...}}
//   stdin {"op":"serialize"}                    -> writes the CURRENT state as
//       a checkpoint to the fixed --out path, replies {"serialized":true}
//   stdin {"op":"exit"}                         -> clean exit 0
//   EOF on stdin                                -> exit 0
//
// The process holds no state except what it restored from the checkpoint
// file plus the story bytes it read from the pinned fixture path: no VM is
// inherited through any closure, singleton, or shared buffer.  --output-limit
// caps cumulative output (exit 3 when exceeded); --stall-serialize-ms lets
// the parent kill the child DURING the serialization phase (kill tests).
//
// Exit codes: 0 = clean run; 2 = checkpoint rejected / unreadable; 3 = output
// limit exceeded; 4 = candidate execution FAILED (an adapter step reported
// status 'error', or an exception was thrown while handling a request -- the
// failure evidence is still emitted, but exit-code callers can never mistake
// a failed candidate for a clean run).  --selftest step-error | throw is
// test scaffolding that deterministically drives the two failure-accounting
// paths; real pinned stories cannot be driven to a VM error on demand.
// ==============================================================================

const fs = require('node:fs');
const readline = require('node:readline');
const { captureCheckpoint, restoreCheckpoint } = require('./checkpoint-core.js');
const { machineFingerprint } = require('./fingerprint.js');
const { sha256Hex, CheckpointError } = require('./checkpoint-format.js');
// The pinned revision this runner actually executes -- the envelope's claimed
// identity is validated AGAINST this, never taken from it (a self-referential
// check would accept any forged runtime identity).
const RUNTIME_REVISION = require('../../vm-io/adapters/ifvms-adapter.js').REVISION;

function parseArgv(argv) {
    const opts = { story: null, checkpoint: null, out: null, outputLimit: 0, stallSerializeMs: 0, selftest: null };
    for (let i = 2; i < argv.length; i += 2) {
        const key = argv[i];
        const val = argv[i + 1];
        if (key === '--story') opts.story = val;
        else if (key === '--checkpoint') opts.checkpoint = val;
        else if (key === '--out') opts.out = val;
        else if (key === '--output-limit') opts.outputLimit = Number(val);
        else if (key === '--stall-serialize-ms') opts.stallSerializeMs = Number(val);
        else if (key === '--selftest') opts.selftest = val; // 'step-error' | 'throw' (test scaffolding only)
        else {
            process.stdout.write(JSON.stringify({ ready: false, error: 'unknown argument: ' + key }) + '\n');
            process.exit(2);
        }
    }
    return opts;
}

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function slimResult(res) {
    return {
        status: res.status,
        delta: res.delta,
        output: res.output,
        gridOutput: res.gridOutput,
        requestLog: res.requestLog,
        errors: res.errors,
        unexpectedGlk: res.unexpectedGlk,
    };
}

async function main() {
    const opts = parseArgv(process.argv);
    if (!opts.story || !opts.checkpoint) {
        emit({ ready: false, error: '--story and --checkpoint are required' });
        process.exit(2);
    }

    const story = fs.readFileSync(opts.story);
    const storySha256 = sha256Hex(story);
    let envelope;
    try {
        envelope = JSON.parse(fs.readFileSync(opts.checkpoint, 'utf8'));
    } catch (e) {
        emit({ ready: false, error: 'unreadable checkpoint file: ' + (e && e.message ? e.message : e), code: 'E_FORMAT' });
        process.exit(2);
    }

    let adapter;
    try {
        adapter = restoreCheckpoint(envelope, story, {
            storySha256,
            storySize: story.length,
            runtimeRevision: RUNTIME_REVISION,
        });
    } catch (e) {
        emit({ ready: false, error: String(e && e.message ? e.message : e), code: e.code || null });
        process.exit(2);
    }

    let outputCount = 0;
    // Failure accounting (PR #37 review): a candidate whose execution fails
    // -- an adapter step reporting status 'error', or an exception thrown
    // while handling a request -- must NOT exit 0.  The failure evidence is
    // still emitted (the parent may want the transcript of the failed run),
    // but the process exit status records the outcome: exit code 4 = failed
    // candidate execution (distinct from 2 = restore rejection and 3 =
    // output limit).
    let failed = false;
    let failureDetail = null;
    const markFailed = (detail) => {
        if (!failed) {
            failed = true;
            failureDetail = detail;
        }
    };
    const exitWithStatus = () => process.exit(failed ? 4 : 0);
    emit({ ready: true, fingerprint: machineFingerprint(adapter), pid: process.pid });

    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            emit({ error: 'bad request line' });
            return;
        }
        try {
            if (msg.op === 'exit') {
                rl.close();
                exitWithStatus();
            } else if (opts.selftest === 'step-error') {
                // Test scaffolding: deterministically exercise the
                // returned-error accounting path (real stories cannot be
                // driven to a VM error on demand).
                if (msg.input) {
                    markFailed('selftest: adapter step reported status error');
                    emit({ step: { status: 'error', delta: '', output: '', gridOutput: '', requestLog: [], errors: ['selftest: step-error'], unexpectedGlk: [] } });
                } else {
                    emit({ error: 'selftest mode only answers input requests' });
                }
            } else if (opts.selftest === 'throw') {
                // Test scaffolding: deterministically exercise the
                // thrown-exception accounting path.
                if (msg.input) {
                    throw new Error('selftest: thrown exception while handling input');
                }
                emit({ error: 'selftest mode only answers input requests' });
            } else if (msg.op === 'fingerprint') {
                emit({ fingerprint: machineFingerprint(adapter) });
            } else if (msg.op === 'serialize') {
                if (!opts.out) {
                    emit({ error: 'serialize requested without --out' });
                    return;
                }
                if (opts.stallSerializeMs > 0) {
                    // Test-only busy stall: keeps this process inside the
                    // serialization phase so the parent can kill it there.
                    const t0 = Date.now();
                    while (Date.now() - t0 < opts.stallSerializeMs) { /* spin */ }
                }
                const env = captureCheckpoint(adapter, { storySha256, storySize: story.length });
                fs.writeFileSync(opts.out, JSON.stringify(env));
                emit({ serialized: true });
            } else if (msg.input) {
                const res = adapter.send(msg.input);
                outputCount += (res.delta || '').length;
                if (Array.isArray(res.errors) && res.errors.length > 0 || res.status === 'error') {
                    markFailed('adapter step reported status error: ' + JSON.stringify(res.errors || []));
                }
                if (opts.outputLimit > 0 && outputCount > opts.outputLimit) {
                    emit({ step: slimResult(res), error: 'output-limit-exceeded', limit: opts.outputLimit });
                    process.exit(3);
                }
                emit({ step: slimResult(res) });
            } else {
                emit({ error: 'unrecognized request' });
            }
        } catch (e) {
            markFailed('exception while handling request: ' + String(e && e.message ? e.message : e));
            emit({ error: String(e && e.message ? e.message : e), failed: true, detail: failureDetail });
        }
    });
    rl.on('close', () => exitWithStatus());
}

main();
