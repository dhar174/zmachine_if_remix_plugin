'use strict';

const assert = require('node:assert/strict');

// ifvms reports a fatal error to Glk and also console.logs the same Error.
// Capture only the one diagnostic a synchronous negative case expects.
// Forward every other console.log call and fail the test after the operation;
// console.error, raw streams and the interpreter itself remain untouched.
function runWithExpectedVmDiagnostic(run, { name, message }) {
    const originalLog = console.log;
    const expected = [];
    const unexpected = [];
    let result;

    console.log = (...args) => {
        const value = args[0];
        if (expected.length === 0 && args.length === 1 && value instanceof Error &&
            value.name === name && message.test(value.message)) {
            expected.push(value);
        } else {
            unexpected.push(args);
            originalLog.apply(console, args);
        }
    };
    try {
        result = run();
    } finally {
        console.log = originalLog;
    }

    assert.strictEqual(unexpected.length, 0, 'unexpected console output was forwarded');
    assert.strictEqual(expected.length, 1, 'expected exactly one matching VM diagnostic');
    assert.strictEqual(result.status, 'error', 'the VM diagnostic must be classified as an error');
    assert.deepStrictEqual(result.errors, [expected[0].message],
        'the adapter must record the same diagnostic reported by the VM');
    return result;
}

module.exports = { runWithExpectedVmDiagnostic };
