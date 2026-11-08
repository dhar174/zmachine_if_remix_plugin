'use strict';
const { spawn } = require('node:child_process');
const { supervise } = require('./bounded-child.cjs');
const child = spawn(process.execPath, process.argv.slice(3), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const session = supervise(child);
process.stdin.pipe(child.stdin);
(async () => {
    try { await session.wait(() => session.closed, Number(process.argv[2]), true); }
    catch { await session.terminate(); }
    if (!session.exit || !session.closed) throw new Error('missing child termination evidence');
    const collector = session.collector;
    process.stdout.write(collector.stdoutText);
    process.stderr.write(collector.fault ? 'bounded child failure: ' + (collector.fault.code || 'E_CHILD_PROTOCOL') + '\n' : collector.stderr);
    process.exitCode = collector.fault || session.closed.signal ? 4 : session.closed.code;
    process.stdin.unpipe(child.stdin); process.stdin.destroy();
})().catch(() => { process.stdin.destroy(); process.exitCode = 4; });
