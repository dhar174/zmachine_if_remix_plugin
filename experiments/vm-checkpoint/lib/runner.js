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
    const opts = { story: null, checkpoint: null, out: null, outputLimit: 0, stallSerializeMs: 0 };
    for (let i = 2; i < argv.length; i += 2) {
        const key = argv[i];
        const val = argv[i + 1];
        if (key === '--story') opts.story = val;
        else if (key === '--checkpoint') opts.checkpoint = val;
        else if (key === '--out') opts.out = val;
        else if (key === '--output-limit') opts.outputLimit = Number(val);
        else if (key === '--stall-serialize-ms') opts.stallSerializeMs = Number(val);
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
            if (msg.op === 'fingerprint') {
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
            } else if (msg.op === 'exit') {
                rl.close();
                process.exit(0);
            } else if (msg.input) {
                const res = adapter.send(msg.input);
                outputCount += (res.delta || '').length;
                if (opts.outputLimit > 0 && outputCount > opts.outputLimit) {
                    emit({ step: slimResult(res), error: 'output-limit-exceeded', limit: opts.outputLimit });
                    process.exit(3);
                }
                emit({ step: slimResult(res) });
            } else {
                emit({ error: 'unrecognized request' });
            }
        } catch (e) {
            emit({ error: String(e && e.message ? e.message : e) });
        }
    });
    rl.on('close', () => process.exit(0));
}

main();
