'use strict';

// Experimental transport bounds, not VM allocation quotas or a sandbox.
const fs = require('node:fs');
const LIMITS = Object.freeze({
    storyBytes: 4 * 1024 * 1024, checkpointBytes: 32 * 1024 * 1024,
    jsonChars: 32 * 1024 * 1024, requestLineBytes: 64 * 1024,
    inputBytes: 8 * 1024 * 1024, recordBytes: 8 * 1024 * 1024,
    stdoutBytes: 32 * 1024 * 1024, stderrBytes: 64 * 1024,
    diagnosticBytes: 1024, outputChars: 4 * 1024 * 1024,
});
function fault(code, message) { return Object.assign(new Error(message), { code }); }

function readBoundedFile(file, maxBytes) {
    const fd = fs.openSync(file, 'r');
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw fault('E_FORMAT', 'input must be a regular file');
        if (stat.size > maxBytes) throw fault('E_SIZE', 'input file exceeds byte limit');
        const chunks = []; let total = 0;
        for (;;) {
            const chunk = Buffer.allocUnsafe(Math.min(65536, maxBytes + 1 - total));
            const n = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (n === 0) return Buffer.concat(chunks, total);
            total += n;
            if (total > maxBytes) throw fault('E_SIZE', 'input file exceeds byte limit');
            chunks.push(chunk.subarray(0, n));
        }
    } finally { fs.closeSync(fd); }
}
function decodeUtf8(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw fault('E_FORMAT', 'invalid UTF-8'); }
}
function parseCheckpoint(bytes) {
    if (bytes.length > LIMITS.checkpointBytes) throw fault('E_SIZE', 'checkpoint exceeds byte limit');
    const text = decodeUtf8(bytes);
    // Equal numeric byte/character caps make this guard redundant today:
    // valid UTF-8 has at least as many bytes as decoded UTF-16 code units.
    // Keep the explicitly declared character check before parsing as well.
    if (text.length > LIMITS.jsonChars) throw fault('E_SIZE', 'checkpoint exceeds character limit');
    try { return JSON.parse(text); }
    catch { throw fault('E_FORMAT', 'invalid checkpoint JSON'); }
}
function encodeCheckpoint(envelope) {
    // The VM, envelope and JSON string already exist: no allocation-quota claim.
    const text = JSON.stringify(envelope);
    if (text.length > LIMITS.jsonChars || Buffer.byteLength(text) > LIMITS.checkpointBytes)
        throw fault('E_SIZE', 'serialized checkpoint exceeds limit');
    return text;
}
function requestFramer() {
    let total = 0, length = 0, parts = [];
    return {
        *push(chunk) {
            total += chunk.length;
            if (total > LIMITS.inputBytes) throw fault('E_INPUT_LIMIT', 'protocol input limit exceeded');
            let start = 0;
            while (start < chunk.length) {
                const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
                const size = stop - start;
                if (length + size > LIMITS.requestLineBytes) throw fault('E_INPUT_LIMIT', 'request line limit exceeded');
                if (size) parts.push(Buffer.from(chunk.subarray(start, stop)));
                length += size;
                if (end < 0) break;
                const line = Buffer.concat(parts, length); parts = []; length = 0;
                yield line; start = end + 1;
            }
        },
        end() { const line = Buffer.concat(parts, length); parts = []; length = 0; return line; },
    };
}
function responseWriter(write) {
    let bytes = 0;
    return {
        async emit(value) {
            const text = JSON.stringify(value) + '\n', size = Buffer.byteLength(text);
            if (size > LIMITS.recordBytes || bytes + size > LIMITS.stdoutBytes - LIMITS.diagnosticBytes)
                throw fault('E_OUTPUT_LIMIT', 'output-limit-exceeded');
            bytes += size; await write(text);
        },
        async diagnostic(value) {
            // Callers supply fixed text/codes only, never rejected payload data.
            const text = JSON.stringify(value) + '\n', size = Buffer.byteLength(text);
            if (size > LIMITS.diagnosticBytes || bytes + size > LIMITS.stdoutBytes)
                throw fault('E_OUTPUT_LIMIT', 'terminal diagnostic exceeds reserved space');
            bytes += size; await write(text);
        },
        get bytes() { return bytes; },
    };
}
module.exports = { LIMITS, fault, readBoundedFile, decodeUtf8, parseCheckpoint, encodeCheckpoint, requestFramer, responseWriter };
