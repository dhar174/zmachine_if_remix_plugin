'use strict';
// Bocfel integration: the same shared acceptance-mapping suite against the
// non-Glk Bocfel child process.  Evidence produced this way is WSL2-only on
// this machine and must not be reported as native-Windows behavior.  The
// suite skips with an explicit reason when the interpreter is not resolvable.

const { test } = require('node:test');
const { integrate } = require('./integrate.js');
const { probeBocfelAvailable } = require('../adapters/bocfel-adapter.js');

const available = probeBocfelAvailable();
const skipReason = available
    ? false
    : 'bocfel non-Glk binary not resolvable; build once and install at ~/.local/bin/bocfel in the default WSL distro (see experiments/vm-io/README.md)';

if (!available) {
    test('bocfel availability probe', { skip: skipReason }, () => {});
} else {
    integrate('bocfel', false);
}
