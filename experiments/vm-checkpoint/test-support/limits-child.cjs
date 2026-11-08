'use strict';
// Original synthetic pipe/deadline cases; no story, import or publication.
const { LIMITS } = require('../lib/transport-limits.js');
const mode = process.argv[2];
const write = (stream, bytes) => new Promise(resolve => stream.write(bytes, resolve));
(async () => {
    if (mode === 'stall') {
        await write(process.stdout, '{"entered":true}\n'); setInterval(() => {}, 1000); return;
    }
    if (mode === 'stderr') await write(process.stderr, Buffer.alloc(LIMITS.stderrBytes + 1, 120));
    else if (mode === 'partial') await write(process.stdout, '{"partial":');
    else if (mode === 'malformed') await write(process.stdout, 'not-json\n');
    else if (mode === 'record' || mode === 'zero') await write(process.stdout, Buffer.alloc(LIMITS.recordBytes + 1, 120));
    else if (mode === 'aggregate') {
        const record = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }) + '\n';
        for (let i = 0; i < 33; i++) await write(process.stdout, record);
    } else throw new Error('unknown synthetic mode');
    process.exitCode = 0;
})();
