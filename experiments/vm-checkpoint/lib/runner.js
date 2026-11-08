'use strict';
// Experimental fresh-process restore endpoint; private NDJSON is not publication.
// Exit 0 clean, 2 startup rejection, 3 output limit, 4 protocol/candidate failure.
// The legacy --stall-serialize-ms stall occurs BEFORE capture/write.
const fs = require('node:fs');
const { captureCheckpoint, restoreCheckpoint } = require('./checkpoint-core.js');
const { machineFingerprint } = require('./fingerprint.js');
const { sha256Hex } = require('./checkpoint-format.js');
const { LIMITS, fault, readBoundedFile, parseCheckpoint, encodeCheckpoint,
    decodeUtf8, requestFramer, responseWriter } = require('./transport-limits.js');
const RUNTIME_REVISION = require('../../vm-io/adapters/ifvms-adapter.js').REVISION;
function parseArgv(argv) {
    const opts = { outputLimit: LIMITS.outputChars, stallSerializeMs: 0 };
    const keys = { '--story': 'story', '--checkpoint': 'checkpoint', '--out': 'out',
        '--output-limit': 'outputLimit', '--stall-serialize-ms': 'stallSerializeMs', '--selftest': 'selftest' };
    for (let i = 2; i < argv.length; i += 2) {
        const key = argv[i], val = argv[i + 1];
        if (!Object.hasOwn(keys, key)) throw fault('E_FORMAT', 'unknown argument: ' + key.slice(0, 120));
        if (val === undefined || val.startsWith('--')) throw fault('E_FORMAT', 'missing value for ' + key);
        opts[keys[key]] = val;
    }
    if (!opts.story || !opts.checkpoint) throw fault('E_FORMAT', '--story and --checkpoint are required');
    opts.outputLimit = Number(opts.outputLimit); opts.stallSerializeMs = Number(opts.stallSerializeMs);
    if (!Number.isSafeInteger(opts.outputLimit) || opts.outputLimit <= 0 || opts.outputLimit > LIMITS.outputChars)
        throw fault('E_FORMAT', 'invalid --output-limit');
    if (!Number.isSafeInteger(opts.stallSerializeMs) || opts.stallSerializeMs < 0)
        throw fault('E_FORMAT', 'invalid --stall-serialize-ms');
    return opts;
}
const short = value => String(value).slice(0, 160);
const slimResult = res => ({ status: res.status, delta: res.delta, output: res.output,
    gridOutput: res.gridOutput, requestLog: res.requestLog, errors: res.errors, unexpectedGlk: res.unexpectedGlk });
async function main() {
    const writer = responseWriter(text => new Promise((resolve, reject) => {
        process.stdout.write(text, error => error ? reject(error) : resolve());
    }));
    let opts, story, storySha256, adapter;
    try {
        opts = parseArgv(process.argv);
        story = readBoundedFile(opts.story, LIMITS.storyBytes); storySha256 = sha256Hex(story);
        const envelope = parseCheckpoint(readBoundedFile(opts.checkpoint, LIMITS.checkpointBytes));
        adapter = restoreCheckpoint(envelope, story, { storySha256, storySize: story.length, runtimeRevision: RUNTIME_REVISION });
    } catch (error) {
        await writer.diagnostic({ ready: false, error: short(error.message),
            code: error.code && error.code.startsWith('E_') ? error.code : 'E_FORMAT' });
        process.exitCode = 2; return;
    }
    let failed = false, failureDetail = null, outputCount = 0, terminating = false, forcedExit = null;
    const markFailed = detail => { if (!failed) { failed = true; failureDetail = short(detail); } };
    const protocolError = async error => {
        markFailed('protocol error: ' + error);
        await writer.emit({ error, failed: true, detail: failureDetail });
    };
    const stop = code => { terminating = true; forcedExit = code; };
    async function terminal(error, ready = undefined) {
        const output = error.code === 'E_OUTPUT_LIMIT';
        stop(output ? 3 : 4);
        await writer.diagnostic({ ...(ready === undefined ? {} : { ready }),
            error: output ? 'output-limit-exceeded' : 'input-limit-exceeded', code: error.code, failed: true });
    }
    async function handle(bytes) {
        let msg;
        try {
            const line = decodeUtf8(bytes);
            if (!line.trim()) return;
            msg = JSON.parse(line);
        } catch { await protocolError('bad request line'); return; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)
            || (Object.hasOwn(msg, 'op') && !['exit', 'fingerprint', 'serialize'].includes(msg.op))) {
            await protocolError('unrecognized request'); return;
        }
        try {
            if (msg.op === 'exit') { stop(failed ? 4 : 0); return; }
            if (opts.selftest === 'step-error') {
                if (msg.input) {
                    markFailed('selftest: adapter step reported status error');
                    await writer.emit({ step: { status: 'error', delta: '', output: '', gridOutput: '', requestLog: [],
                        errors: ['selftest: step-error'], unexpectedGlk: [] } });
                } else await protocolError('selftest mode only answers input requests');
            } else if (opts.selftest === 'throw') {
                if (msg.input) throw new Error('selftest: thrown exception while handling input');
                await protocolError('selftest mode only answers input requests');
            } else if (msg.op === 'fingerprint') {
                await writer.emit({ fingerprint: machineFingerprint(adapter) });
            } else if (msg.op === 'serialize') {
                if (!opts.out) { await protocolError('serialize requested without --out'); return; }
                const t0 = Date.now();
                while (Date.now() - t0 < opts.stallSerializeMs) { /* legacy before-capture stall */ }
                const text = encodeCheckpoint(captureCheckpoint(adapter, { storySha256, storySize: story.length }));
                fs.writeFileSync(opts.out, text); await writer.emit({ serialized: true });
            } else if (msg.input) {
                const res = adapter.send(msg.input);
                outputCount += (res.delta || '').length;
                if ((Array.isArray(res.errors) && res.errors.length) || res.status === 'error')
                    markFailed('adapter step reported status error: ' + JSON.stringify(res.errors || []));
                if (outputCount > opts.outputLimit) throw fault('E_OUTPUT_LIMIT', 'output-limit-exceeded');
                await writer.emit({ step: slimResult(res) });
            } else await protocolError('unrecognized request');
        } catch (error) {
            if (error.code === 'E_OUTPUT_LIMIT') throw error;
            markFailed('exception while handling request: ' + error.message);
            await writer.emit({ error: short(error.message), code: error.code || null, failed: true, detail: failureDetail });
        }
    }
    try { await writer.emit({ ready: true, fingerprint: machineFingerprint(adapter), pid: process.pid }); }
    catch (error) {
        if (error.code !== 'E_OUTPUT_LIMIT') throw error;
        await terminal(error, false); process.exitCode = forcedExit; return;
    }
    const framer = requestFramer();
    try {
        // Awaited writes apply stdout backpressure before consuming more input.
        requests: for await (const chunk of process.stdin) {
            for (const bytes of framer.push(chunk)) {
                await handle(bytes);
                if (terminating) break requests;
            }
        }
        if (!terminating) await handle(framer.end());
    } catch (error) {
        if (error.code === 'E_INPUT_LIMIT' || error.code === 'E_OUTPUT_LIMIT') await terminal(error);
        else throw error;
    } finally { process.stdin.destroy(); }
    process.exitCode = forcedExit === null ? (failed ? 4 : 0) : forcedExit;
}
main().catch(() => { process.stdin.destroy(); process.exitCode = 4; });
