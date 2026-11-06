'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runWithExpectedVmDiagnostic } = require('./expected-vm-diagnostic.js');

const expected = { name: 'RangeError', message: /offset|bounds/i };

test('an expected VM diagnostic must match the adapter error and is not leaked', () => {
    const originalLog = console.log;
    const originalError = console.error;
    const diagnostic = new RangeError('offset outside bounds');
    const result = runWithExpectedVmDiagnostic(() => {
        assert.strictEqual(console.error, originalError);
        console.log(diagnostic);
        return { status: 'error', errors: [diagnostic.message] };
    }, expected);
    assert.deepStrictEqual(result.errors, [diagnostic.message]);
    assert.strictEqual(console.log, originalLog);
});

test('unexpected or duplicate output is forwarded and fails the check', () => {
    const originalLog = console.log;
    const forwarded = [];
    const diagnostic = new RangeError('offset outside bounds');
    console.log = (...args) => forwarded.push(args);
    try {
        assert.throws(() => runWithExpectedVmDiagnostic(() => {
            console.log(diagnostic);
            console.log('unexpected message');
            return { status: 'error', errors: [diagnostic.message] };
        }, expected), /unexpected console output was forwarded/);
        assert.deepStrictEqual(forwarded, [['unexpected message']]);
        forwarded.length = 0;
        assert.throws(() => runWithExpectedVmDiagnostic(() => {
            console.log(diagnostic);
            console.log(diagnostic);
            return { status: 'error', errors: [diagnostic.message] };
        }, expected), /unexpected console output was forwarded/);
        assert.deepStrictEqual(forwarded, [[diagnostic]]);
        forwarded.length = 0;
        const wrongKind = new TypeError('offset outside bounds');
        assert.throws(() => runWithExpectedVmDiagnostic(() => {
            console.log(wrongKind);
            return { status: 'error', errors: [wrongKind.message] };
        }, expected), /unexpected console output was forwarded/);
        assert.deepStrictEqual(forwarded, [[wrongKind]]);
        forwarded.length = 0;
        const wrongMessage = new RangeError('unexpected diagnostic');
        assert.throws(() => runWithExpectedVmDiagnostic(() => {
            console.log(wrongMessage);
            return { status: 'error', errors: [wrongMessage.message] };
        }, expected), /unexpected console output was forwarded/);
        assert.deepStrictEqual(forwarded, [[wrongMessage]]);
    } finally {
        console.log = originalLog;
    }
});

test('missing, mismatched or unrecorded diagnostics fail the check', () => {
    assert.throws(() => runWithExpectedVmDiagnostic(() => ({ status: 'error', errors: [] }), expected),
        /expected exactly one matching VM diagnostic/);
    assert.throws(() => runWithExpectedVmDiagnostic(() => {
        console.log(new RangeError('offset outside bounds'));
        return { status: 'error', errors: ['different error'] };
    }, expected), /adapter must record the same diagnostic/);
    assert.throws(() => runWithExpectedVmDiagnostic(() => {
        console.log(new RangeError('offset outside bounds'));
        return { status: 'halted', errors: ['offset outside bounds'] };
    }, expected), /VM diagnostic must be classified as an error/);
});

test('the original console is restored if the operation throws', () => {
    const originalLog = console.log;
    const failure = new Error('operation failed');
    assert.throws(() => runWithExpectedVmDiagnostic(() => { throw failure; }, expected), (e) => e === failure);
    assert.strictEqual(console.log, originalLog);
});
