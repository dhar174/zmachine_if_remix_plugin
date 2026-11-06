'use strict';
// Worker runner for the bounded-execution negative tests: loads the ifvms
// adapter inside this worker thread and runs the story's startup to its
// first input boundary.  For a nonterminating story this never returns --
// the parent test enforces the deadline with worker.terminate(), which
// preempts even a busy synchronous loop.  The adapter path is a static
// require; workerData carries the story bytes and the expected-diagnostic flag.

const { parentPort, workerData } = require('node:worker_threads');
const { createIfvmsAdapter } = require('../adapters/ifvms-adapter.js');
const { runWithExpectedVmDiagnostic } = require('./expected-vm-diagnostic.js');

const adapter = createIfvmsAdapter(Buffer.from(workerData.story));
const result = workerData.expectDiagnostic
    ? runWithExpectedVmDiagnostic(() => adapter.start(), {
        name: 'RangeError', message: /^Offset is outside the bounds of the DataView$/,
    })
    : adapter.start();
parentPort.postMessage({ status: result.status, errors: result.errors });
