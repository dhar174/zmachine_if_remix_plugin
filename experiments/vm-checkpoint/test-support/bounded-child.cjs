'use strict';
// Private pipe collection, not publication or OS isolation.
const { LIMITS, fault, decodeUtf8 } = require('../lib/transport-limits.js');
function pipeCollector(onRecord = () => {}, onFault = () => {}) {
    let problem = null, stdoutBytes = 0, stderrBytes = 0, lineBytes = 0;
    let parts = []; const errors = [], records = [], texts = []; let completeBytes = 0;
    const fail = error => { if (!problem) { problem = error; parts = []; lineBytes = 0; onFault(error); } };
    return {
        stdout(chunk) {
            if (problem) return;
            stdoutBytes += chunk.length;
            if (stdoutBytes > LIMITS.stdoutBytes) return fail(fault('E_CHILD_OUTPUT_LIMIT', 'child stdout limit exceeded'));
            let start = 0;
            while (start < chunk.length && !problem) {
                const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
                if (lineBytes + stop - start + (end < 0 ? 0 : 1) > LIMITS.recordBytes)
                    return fail(fault('E_CHILD_OUTPUT_LIMIT', 'child stdout record limit exceeded'));
                if (stop > start) parts.push(Buffer.from(chunk.subarray(start, stop)));
                lineBytes += stop - start;
                if (end < 0) break;
                let text, value;
                try { text = decodeUtf8(Buffer.concat(parts, lineBytes)); value = JSON.parse(text); }
                catch { fail(fault('E_CHILD_PROTOCOL', 'invalid child stdout record')); return; }
                completeBytes += lineBytes + 1;
                parts = []; lineBytes = 0; texts.push(text + '\n'); records.push(value);
                try { onRecord(value); } catch (error) { fail(error); }
                start = end + 1;
            }
        },
        feedStderr(chunk) {
            if (problem) return;
            if (stderrBytes + chunk.length > LIMITS.stderrBytes) return fail(fault('E_CHILD_OUTPUT_LIMIT', 'child stderr limit exceeded'));
            stderrBytes += chunk.length; errors.push(Buffer.from(chunk));
        },
        end() { if (lineBytes) fail(fault('E_CHILD_PROTOCOL', 'truncated child stdout record')); },
        fail,
        get fault() { return problem; }, get records() { return records; },
        get stdoutText() { return texts.join(''); },
        get stderr() { return Buffer.concat(errors, stderrBytes).toString('utf8'); },
        get retainedLineBytes() { return lineBytes; },
        get retainedStdoutBytes() { return completeBytes + lineBytes; },
        get counts() { return { stdoutBytes, stderrBytes }; },
    };
}
function supervise(child, onRecord = () => {}) {
    let exit = null, closed = null, reportedFailure = false; const waiters = new Set();
    const notify = () => { for (const check of [...waiters]) check(); };
    let killTimer = null;
    const collector = pipeCollector(value => {
        reportedFailure ||= value?.failed === true || value?.ready === false || !!value?.captureError
            || value?.step?.status === 'error' || (Array.isArray(value?.steps) && value.steps.some(step => step.status === 'error'));
        onRecord(value); notify();
    }, () => {
        if (!exit && !closed) child.kill('SIGKILL');
        if (!closed && !killTimer) {
            killTimer = setTimeout(() => { collector.fail(fault('E_TERMINATION', 'child pipe closure deadline exceeded')); notify(); }, 10000);
            killTimer.unref();
        }
        notify();
    });
    child.stdout.on('data', chunk => collector.stdout(chunk));
    child.stderr.on('data', chunk => collector.feedStderr(chunk));
    child.on('error', error => collector.fail(error));
    child.stdin?.on('error', error => { if (!exit && !closed) collector.fail(error); });
    child.on('exit', (code, signal) => { exit = { code, signal }; notify(); });
    child.on('close', (code, signal) => {
        closed = { code, signal }; collector.end(); clearTimeout(killTimer); notify();
    });
    function wait(predicate, timeout = 30000, allowClosed = false) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const error = fault('E_DEADLINE', 'deadline waiting for child evidence');
                collector.fail(error); done(error);
            }, timeout);
            function done(error, value) { clearTimeout(timer); waiters.delete(check); error ? reject(error) : resolve(value); }
            function check() {
                if (collector.fault && !allowClosed) return done(collector.fault);
                const value = predicate();
                if (value) return done(null, value);
                if (closed && !allowClosed) done(fault('E_CHILD_PROTOCOL', 'child closed before expected evidence'));
            }
            waiters.add(check); check();
        });
    }
    return {
        child, collector, wait, notify,
        close: () => wait(() => closed, 10000, true),
        async terminate() { if (!exit && !closed) child.kill('SIGKILL'); return this.close(); },
        get exit() { return exit; }, get closed() { return closed; },
        get eligible() { return !!closed && !!exit && closed.code === 0 && exit.code === 0
            && !closed.signal && !exit.signal && !reportedFailure && !collector.fault && !collector.stderr; },
    };
}
module.exports = { pipeCollector, supervise };
