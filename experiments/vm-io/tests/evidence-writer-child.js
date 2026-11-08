'use strict';
// Trusted test child. Configuration arrives only after listeners are installed.
const fs = require('node:fs/promises');
const { createPublisher } = require('../evidence-writer.js');
let started = false;
process.once('message', async (config) => {
    if (started || config.type !== 'start') throw new Error('invalid start');
    started = true;
    let sequence = 0;
    let partialAcknowledged = false;
    const io = { ...fs, open: async (file, flags) => {
        const handle = await fs.open(file, flags);
        if (!file.endsWith('.tmp')) return handle;
        return {
            stat: () => handle.stat(), close: () => handle.close(),
            write: (bytes, offset, length, position) =>
                handle.write(bytes, offset, Math.min(length, Math.max(1, Math.floor(bytes.length / 2))), position),
        };
    } };
    const onPhase = async (phase, state) => {
        if (!config.pause.includes(phase)) return;
        // Only the first progress callback is a strict-prefix barrier.
        if (phase === 'stage-progress') {
            if (state.written >= state.length || partialAcknowledged) return;
            partialAcknowledged = true;
        }
        const message = { type: 'phase', id: config.id, phase, sequence: ++sequence, ...state };
        await new Promise((resolve, reject) => {
            const listener = (release) => {
                if (release.type !== 'release' || release.id !== config.id || release.phase !== phase || release.sequence !== sequence) {
                    reject(new Error('mismatched phase release'));
                } else resolve();
            };
            process.once('message', listener);
            process.send(message);
        });
    };
    try {
        await createPublisher({ io, onPhase })(config.outPath, Buffer.from(config.contents, 'utf8'));
        process.send({ type: 'result', id: config.id, ok: true }, () => process.disconnect());
    } catch (e) {
        process.exitCode = 1;
        process.send({ type: 'result', id: config.id, ok: false, code: e.code, published: e.published,
            message: e.message }, () => process.disconnect());
    }
});
process.send({ type: 'boot' });
