'use strict';
// Preserve synchronous test-call ergonomics while a separate parent supervises
// the actual candidate with independent stdout/stderr limits and pipe closure.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LIMITS } = require('../lib/transport-limits.js');
exports.spawnSync = (exe, args, options = {}) => {
    if (exe !== process.execPath) throw new Error('bounded sync support only launches Node fixtures');
    return spawnSync(process.execPath, [path.join(__dirname, 'bounded-sync-parent.cjs'), String(options.timeout || 30000), ...args], {
        ...options, timeout: (options.timeout || 30000) + 15000,
        maxBuffer: LIMITS.stdoutBytes + LIMITS.stderrBytes, windowsHide: true,
    });
};
