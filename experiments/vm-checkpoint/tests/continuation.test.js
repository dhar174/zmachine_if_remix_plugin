'use strict';
// ==============================================================================
// continuation.test.js -- read-continuation address/span validation (Issue #41,
// A34), including the review-finding constructions (validated image must be
// the applied image; parseaddr must lie outside the text continuation write
// span).
// ------------------------------------------------------------------------------
// The pending read's continuation writes (typed text, parse-table entries)
// land in VM memory only when input arrives -- after ready:true -- so a
// hostile or corrupt envelope can point bufaddr/parseaddr anywhere and only
// fault the child later (observed on pre-#41 code: bufaddr=0xFFFFFF with an
// honestly recomputed digest restored ready:true, then threw
// "RangeError: Offset is outside the bounds of the DataView" on the next
// input and exited 4).
//
// Discipline: every negative below is an HONEST-DIGEST mutation of a genuine
// seeded fixture capture, so only the semantic continuation-span rulebook can
// refuse it.  Negative tests run through the ORDINARY restoring child
// (lib/runner.js, no --selftest) and assert ready:false, no ready:true, exit
// 2, and the intended error code, with the baseline recaptured byte-
// identically after every rejection.  All addresses/capacities are DERIVED
// from the captured envelope at runtime (quetzal UMem image + readData) --
// nothing fixture-specific is hardcoded; the fixture's own values happen to
// be bufaddr=4382/parseaddr=4751/static base 5423/version 5.
// ==============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const {
    createInstance, line, key, drive, capture, writeEnvelope, runReference,
    spawnRestore, awaitExit, STORY, STORY_SHA256, REVISION,
    machineFingerprint, fingerprintDiff,
} = require('./helpers.js');
const {
    validateEnvelope, CheckpointError, sha256Hex, canonicalPayloadString, quetzalUmem,
} = require('../lib/checkpoint-format.js');

const PREFIX = [line('look'), line('seed 42'), line('take brass key')];
const EXPECTED_STORY = {
    storySha256: STORY_SHA256,
    storySize: STORY.length,
    runtimeRevision: REVISION,
    storyBytes: STORY,
};
// Without trusted story bytes the header cross-check is out of scope (the
// UMem-internal checks still run) -- exercised by the version-forge cases.
const EXPECTED = {
    storySha256: STORY_SHA256,
    storySize: STORY.length,
    runtimeRevision: REVISION,
};

function capturedLineEnvelope() {
    const src = createInstance();
    src.start();
    drive(src, PREFIX);
    return capture(src);
}

function expectCode(fn, code) {
    try {
        fn();
    } catch (e) {
        assert.ok(e instanceof CheckpointError, 'expected CheckpointError, got: ' + e);
        assert.strictEqual(e.code, code, 'wrong rejection code, wanted ' + code + ' got ' + e.code + ': ' + e.message);
        return;
    }
    assert.fail('expected rejection with code ' + code + ', but validation passed');
}

// Honest-digest mutation of the payload: the test exercises SEMANTIC
// validation, not the integrity digest.
function mutatePayload(env, fn) {
    const m = JSON.parse(JSON.stringify(env));
    fn(m.payload);
    m.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(m.payload));
    return m;
}

// Layout facts derived from the checkpointed memory image (never hardcoded).
function layout(env) {
    const u = quetzalUmem(env.payload.quetzalB64);
    return {
        umem: u,
        staticBase: (u[0x0E] << 8) | u[0x0F],
        bufaddr: env.payload.readData.bufaddr,
        parseaddr: env.payload.readData.parseaddr,
        bufferLen: env.payload.readData.buffer.length,
    };
}

// Hostile construction: flip a byte inside the checkpointed UMem image and
// recompute the payload digest honestly.  Locates the UMem chunk with the
// same IFF walk the validator uses (quetzalUmem) plus its offset.
function withUmemByte(env, addr, value) {
    const q = Buffer.from(env.payload.quetzalB64, 'base64');
    let off = 12;
    while (off + 8 <= q.length) {
        const type = q.toString('ascii', off, off + 4);
        const len = q.readUInt32BE(off + 4);
        if (type === 'UMem') {
            q[off + 8 + addr] = value;
            env.payload.quetzalB64 = q.toString('base64');
            env.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(env.payload));
            return env;
        }
        off += 8 + len + (len % 2);
    }
    assert.fail('no UMem chunk in the baseline quetzal');
}

// The shared live baseline: a real interpreter at a captured seeded line
// boundary, plus the byte-exact envelope and fingerprint for invariance
// checks after every child rejection.
function makeBaseline() {
    const adapter = createInstance();
    adapter.start();
    drive(adapter, PREFIX);
    const envelope = capture(adapter);
    return {
        adapter,
        envelope,
        envelopeJson: JSON.stringify(envelope),
        fingerprint: machineFingerprint(adapter),
    };
}

// Baseline invariance: byte-identical recapture + unchanged fingerprint.
function assertBaselineUnchanged(baseline, context) {
    const recaptured = capture(baseline.adapter);
    assert.strictEqual(JSON.stringify(recaptured), baseline.envelopeJson,
        'baseline checkpoint byte-identical after ' + context);
    const diffs = fingerprintDiff(baseline.fingerprint, machineFingerprint(baseline.adapter));
    assert.deepStrictEqual(diffs, [], 'baseline fingerprint unchanged after ' + context);
}

// ---------------------------------------------------------------------------
// Positive controls: the span rulebook must accept every genuine checkpoint
// kind, not just the mutated line case.
// ---------------------------------------------------------------------------

test('a genuine seeded line checkpoint passes continuation validation (positive control)', () => {
    const env = capturedLineEnvelope();
    assert.strictEqual(validateEnvelope(env, EXPECTED_STORY), true);
    assert.strictEqual(validateEnvelope(env, EXPECTED), true);
});

test('a genuine seeded char checkpoint passes validation without line-buffer requirements (positive control)', () => {
    const a = createInstance();
    a.start();
    drive(a, [line('seed 42'), line('menu')]);
    const env = capture(a);
    assert.strictEqual(env.boundary.kind, 'char');
    assert.strictEqual(validateEnvelope(env, EXPECTED_STORY), true);
    assert.strictEqual(validateEnvelope(env, EXPECTED), true);
});

test('a genuine halted checkpoint passes validation (positive control)', () => {
    const src = createInstance();
    src.start();
    const path = ['look', 'seed 42', 'take brass key', 'north', 'unlock vault door with brass key', 'open vault door', 'north', 'put brass key on pedestal', 'quit'];
    let settled = null;
    for (const t of path) settled = src.send({ kind: 'line', text: t });
    assert.strictEqual(settled.status, 'halted', 'endgame quit must halt');
    const env = capture(src);
    assert.strictEqual(env.boundary.kind, 'halted');
    assert.strictEqual(validateEnvelope(env, EXPECTED_STORY), true);
    assert.strictEqual(validateEnvelope(env, EXPECTED), true);
});

// ---------------------------------------------------------------------------
// Rejections at the validation layer (restoreCheckpoint calls this before any
// interpreter exists; the child-runner equivalents are asserted below).
// ---------------------------------------------------------------------------

test('bufaddr=0xFFFFFF (the reported repro) rejects with E_BOUNDARY', () => {
    const env = capturedLineEnvelope();
    const m = mutatePayload(env, (p) => { p.readData.bufaddr = 0xFFFFFF; });
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_BOUNDARY');
    expectCode(() => validateEnvelope(m, EXPECTED), 'E_BOUNDARY');
});

test('parseaddr=0xFFFFFF (the reported repro) rejects with E_BOUNDARY', () => {
    const env = capturedLineEnvelope();
    const m = mutatePayload(env, (p) => { p.readData.parseaddr = 0xFFFFFF; });
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_BOUNDARY');
    expectCode(() => validateEnvelope(m, EXPECTED), 'E_BOUNDARY');
});

test('a near-end bufaddr whose text-buffer span overflows writable memory rejects with E_BOUNDARY', () => {
    const env = capturedLineEnvelope();
    const { staticBase, bufferLen } = layout(env);
    assert.ok(staticBase - 1 > 0x40, 'derived near-end address must be a usable test value');
    const m = mutatePayload(env, (p) => { p.readData.bufaddr = staticBase - 1; });
    // bufaddr+1 (count byte) + bufferLen (text) cannot fit before the static base.
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_BOUNDARY');
});

test('a parse table whose declared span overflows writable memory rejects with E_BOUNDARY', () => {
    const env = capturedLineEnvelope();
    const { staticBase } = layout(env);
    // Move parseaddr near the end of dynamic memory AND declare a capacity
    // that cannot fit (checkpointed memory byte set through the image).
    const near = staticBase - 3;
    const m = mutatePayload(env, (p) => { p.readData.parseaddr = near; });
    withUmemByte(m, near, 15);
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_BOUNDARY');
    // Same span math with the SENTINEL: parseaddr = 0 stays legal.
    const sentinel = mutatePayload(env, (p) => { p.readData.parseaddr = 0; });
    assert.strictEqual(validateEnvelope(sentinel, EXPECTED_STORY), true, 'parseaddr=0 is the documented no-tokenise sentinel and must stay valid');
});

test('a buffer length disagreeing with the checkpointed capacity byte rejects with E_STRUCTURE', () => {
    const env = capturedLineEnvelope();
    const { bufaddr, bufferLen } = layout(env);
    const m = mutatePayload(env, (p) => { p.readData.buffer.push(0); });
    assert.notStrictEqual(m.payload.readData.buffer.length, layout(m).umem[bufaddr], 'mutation must actually break the capacity tie');
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_STRUCTURE');
});

test('a checkpointed static base disagreeing with the UMem chunk length rejects with E_STRUCTURE', () => {
    const env = capturedLineEnvelope();
    const { staticBase } = layout(env);
    const forged = staticBase + 1;
    const m = mutatePayload(env, () => {}); // no-op clone, bytes rewritten below
    withUmemByte(m, 0x0E, forged >> 8);
    withUmemByte(m, 0x0F, forged & 0xFF);
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_STRUCTURE');
});

test('a checkpointed header disagreeing with the trusted story bytes rejects with E_STRUCTURE', () => {
    const env = capturedLineEnvelope();
    const m = mutatePayload(env, () => {}); // no-op clone
    withUmemByte(m, 0, 7); // version byte: 5 -> 7
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_STRUCTURE');
    // Without story bytes the trusted-story cross-check is out of scope: the
    // UMem-internal checks still run, and a v7 capacity tie (>=5 branch)
    // stays consistent, so this documents the opt-in boundary of the check.
    assert.strictEqual(validateEnvelope(m, EXPECTED), true);
});

test('a parseaddr inside the text-buffer continuation write span rejects with E_BOUNDARY (review F2)', () => {
    const env = capturedLineEnvelope();
    const { bufaddr } = layout(env);
    // Inside [bufaddr+1, bufaddr+1+bufferLen]: handle_line_input writes the
    // response there BEFORE tokenise re-reads the parse capacity byte, so
    // the validated capacity would not be the effective capacity.
    const m = mutatePayload(env, (p) => { p.readData.parseaddr = bufaddr + 2; });
    expectCode(() => validateEnvelope(m, EXPECTED_STORY), 'E_BOUNDARY');
    // The one overlap position that stays safe: parseaddr = bufaddr names
    // the text buffer's own capacity byte, which the text write never
    // overwrites -- the validated capacity stays the effective one.
    const boundaryCase = mutatePayload(env, (p) => { p.readData.parseaddr = bufaddr; });
    assert.strictEqual(validateEnvelope(boundaryCase, EXPECTED_STORY), true, 'parseaddr = bufaddr (the capacity byte itself) is the modeled-safe overlap boundary');
});

test('a quetzal whose validated memory image is not the applied image rejects with E_STRUCTURE (review F1/F7)', () => {
    const env = capturedLineEnvelope();
    const { staticBase } = layout(env);

    // Two UMem chunks: the vendored parser keeps the LAST CMem/UMem chunk,
    // so a benign first image with a hostile second one would validate one
    // image and restore another.
    const doubleUmem = mutatePayload(env, () => {});
    {
        const q = Buffer.from(doubleUmem.payload.quetzalB64, 'base64');
        const chunk = Buffer.alloc(8 + staticBase + (staticBase % 2));
        chunk.write('UMem', 0, 'ascii');
        chunk.writeUInt32BE(staticBase, 4);
        // Hostile second image: everything-zero dynamic memory -- its header
        // would not even parse as a Z-machine (this is rejected by the
        // multiple-chunk rule before its contents matter).
        chunk.fill(0, 8);
        const combined = Buffer.concat([q, chunk]);
        combined.writeUInt32BE(combined.length - 8, 4);
        doubleUmem.payload.quetzalB64 = combined.toString('base64');
    }
    doubleUmem.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(doubleUmem.payload));
    expectCode(() => validateEnvelope(doubleUmem, EXPECTED_STORY), 'E_STRUCTURE');

    // A compressed CMem memory chunk is not the uncompressed autosave image
    // (rename the UMem chunk in place -- same byte length).
    const cmem = mutatePayload(env, () => {});
    {
        const q = Buffer.from(cmem.payload.quetzalB64, 'base64');
        let off = 12;
        while (off + 8 <= q.length) {
            const type = q.toString('ascii', off, off + 4);
            const len = q.readUInt32BE(off + 4);
            if (type === 'UMem') { q.write('CMem', off, 'ascii'); cmem.payload.quetzalB64 = q.toString('base64'); break; }
            off += 8 + len + (len % 2);
        }
    }
    cmem.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(cmem.payload));
    expectCode(() => validateEnvelope(cmem, EXPECTED_STORY), 'E_STRUCTURE');

    // A FORM size field inconsistent with the buffer would fault the
    // vendored parser with an unstructured error before it ever reached a
    // stable code -- rejected at validation instead (review F7).  Genuine
    // save_file output always has FORM area == buffer length exactly, so
    // both directions of inconsistency reject without over-rejection.
    const badForm = mutatePayload(env, () => {});
    {
        const q = Buffer.from(badForm.payload.quetzalB64, 'base64');
        q.writeUInt32BE(q.length - 7, 4); // declared area +1 past the buffer
        badForm.payload.quetzalB64 = q.toString('base64');
    }
    badForm.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(badForm.payload));
    expectCode(() => validateEnvelope(badForm, EXPECTED_STORY), 'E_STRUCTURE');
    const trailing = mutatePayload(env, () => {});
    {
        const q = Buffer.from(trailing.payload.quetzalB64, 'base64');
        // Appended bytes beyond the declared area are invisible to the
        // writer but were the raw material for the F8 straddler exploit;
        // they must not be tolerated.
        const padded = Buffer.concat([q, Buffer.alloc(8)]);
        trailing.payload.quetzalB64 = padded.toString('base64');
    }
    trailing.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(trailing.payload));
    expectCode(() => validateEnvelope(trailing, EXPECTED_STORY), 'E_STRUCTURE');

    // Straddling chunk header (review F8): a len-0 chunk landing the next
    // offset one byte before the declared area end leaves a header the
    // vendored parser would read ACROSS the area end while a skip-bounded
    // walk would never see it -- validation must refuse it, never skip it,
    // or validation and restore could disagree about which memory image is
    // applied.
    const straddler = mutatePayload(env, () => {});
    {
        const q = Buffer.from(straddler.payload.quetzalB64, 'base64');
        const filler = Buffer.alloc(8);
        filler.write('ZZZZ', 0, 'ascii'); // len-0 chunk ends exactly 1 byte before the area end
        const combined = Buffer.concat([q, filler, Buffer.alloc(1)]);
        combined.writeUInt32BE(combined.length - 8, 4);
        straddler.payload.quetzalB64 = combined.toString('base64');
    }
    straddler.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(straddler.payload));
    expectCode(() => validateEnvelope(straddler, EXPECTED_STORY), 'E_STRUCTURE');
});

// ---------------------------------------------------------------------------
// Child-runner negatives: the ordinary restoring child (lib/runner.js, no
// --selftest) must refuse BEFORE ready:true, exit 2 with the intended code,
// and leave the live baseline untouched.
// ---------------------------------------------------------------------------

test('honest-digest continuation-span mutations are rejected by the ordinary child runner before readiness (A34)', { timeout: 240000 }, async () => {
    const baseline = makeBaseline();
    const { staticBase } = layout(baseline.envelope);

    // Every variant is an HONEST-DIGEST mutation of the genuine capture.
    const honest = (e) => {
        e.integrity.payloadSha256 = sha256Hex(canonicalPayloadString(e.payload));
        return e;
    };
    const variants = {};
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        e.payload.readData.bufaddr = 0xFFFFFF;
        variants['bufaddr-ffffff'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        e.payload.readData.parseaddr = 0xFFFFFF;
        variants['parseaddr-ffffff'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        e.payload.readData.bufaddr = staticBase - 1;
        variants['bufaddr-near-end'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        const near = staticBase - 3;
        e.payload.readData.parseaddr = near;
        const q = Buffer.from(e.payload.quetzalB64, 'base64');
        let off = 12;
        while (off + 8 <= q.length) {
            const type = q.toString('ascii', off, off + 4);
            const len = q.readUInt32BE(off + 4);
            if (type === 'UMem') { q[off + 8 + near] = 15; e.payload.quetzalB64 = q.toString('base64'); break; }
            off += 8 + len + (len % 2);
        }
        variants['parse-table-overflow'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        e.payload.readData.buffer.push(0);
        variants['capacity-mismatch'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        const forged = staticBase + 1;
        const q = Buffer.from(e.payload.quetzalB64, 'base64');
        let off = 12;
        while (off + 8 <= q.length) {
            const type = q.toString('ascii', off, off + 4);
            const len = q.readUInt32BE(off + 4);
            if (type === 'UMem') { q[off + 8 + 0x0E] = forged >> 8; q[off + 8 + 0x0F] = forged & 0xFF; e.payload.quetzalB64 = q.toString('base64'); break; }
            off += 8 + len + (len % 2);
        }
        variants['static-base-forge'] = honest(e);
    }
    {
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        const q = Buffer.from(e.payload.quetzalB64, 'base64');
        let off = 12;
        while (off + 8 <= q.length) {
            const type = q.toString('ascii', off, off + 4);
            const len = q.readUInt32BE(off + 4);
            if (type === 'UMem') { q[off + 8] = 7; e.payload.quetzalB64 = q.toString('base64'); break; }
            off += 8 + len + (len % 2);
        }
        variants['version-forge'] = honest(e);
    }
    {
        // Review F2: parseaddr inside the text continuation write span --
        // the response inflates the parse capacity byte before tokenise
        // reads it, so the validated span is not the effective one.
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        e.payload.readData.parseaddr = e.payload.readData.bufaddr + 2;
        variants['parse-in-text-span'] = honest(e);
    }
    {
        // Review F1: a second UMem chunk -- the vendored parser keeps the
        // last CMem/UMem chunk, so the validated image must equal the
        // applied one; multiple memory chunks are refused outright.
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        const { staticBase } = layout(e);
        const q = Buffer.from(e.payload.quetzalB64, 'base64');
        const chunk = Buffer.alloc(8 + staticBase + (staticBase % 2));
        chunk.write('UMem', 0, 'ascii');
        chunk.writeUInt32BE(staticBase, 4);
        chunk.fill(0, 8);
        const combined = Buffer.concat([q, chunk]);
        combined.writeUInt32BE(combined.length - 8, 4);
        e.payload.quetzalB64 = combined.toString('base64');
        variants['double-umem'] = honest(e);
    }
    {
        // Review F8: a straddling chunk header -- validation must refuse
        // (never skip) a header the vendored parser would read across the
        // declared FORM area end.
        const e = JSON.parse(JSON.stringify(baseline.envelope));
        const q = Buffer.from(e.payload.quetzalB64, 'base64');
        const filler = Buffer.alloc(8);
        filler.write('ZZZZ', 0, 'ascii');
        const combined = Buffer.concat([q, filler, Buffer.alloc(1)]);
        combined.writeUInt32BE(combined.length - 8, 4);
        e.payload.quetzalB64 = combined.toString('base64');
        variants['straddler-header'] = honest(e);
    }

    const expectedCodes = {
        'bufaddr-ffffff': 'E_BOUNDARY',
        'parseaddr-ffffff': 'E_BOUNDARY',
        'bufaddr-near-end': 'E_BOUNDARY',
        'parse-table-overflow': 'E_BOUNDARY',
        'parse-in-text-span': 'E_BOUNDARY',
        'capacity-mismatch': 'E_STRUCTURE',
        'static-base-forge': 'E_STRUCTURE',
        'version-forge': 'E_STRUCTURE',
        'double-umem': 'E_STRUCTURE',
        'straddler-header': 'E_STRUCTURE',
    };

    const childProcesses = [];
    try {
        for (const [name, env] of Object.entries(variants)) {
            const p = writeEnvelope(env, 'cont-' + name + '.json');
            const child = spawnRestore(p);
            childProcesses.push(child);
            const boot = await child.nextMessage(30000);
            assert.strictEqual(boot.ready, false, name + ': child must refuse to restore (ready:false, no ready:true)');
            assert.strictEqual(boot.code, expectedCodes[name],
                name + ': expected code ' + expectedCodes[name] + ', got ' + boot.code + ' (' + boot.error + ')');
            const code = await awaitExit(child, 30000);
            assert.strictEqual(code, 2, name + ': rejected child exits 2, got ' + code);
            assertBaselineUnchanged(baseline, name + ' rejection');
        }
    } finally {
        // A leaked child would keep the test process's pipes open; every
        // spawned child is killed no matter what happened.
        for (const child of childProcesses) {
            child.child.kill();
            await awaitExit(child, 10000).catch(() => {});
        }
    }
});

test('the unmutated baseline still restores and continues in the child (green control)', { timeout: 120000 }, async () => {
    const baseline = makeBaseline();
    const envPath = writeEnvelope(baseline.envelope, 'cont-baseline.json');
    const child = spawnRestore(envPath);
    try {
        await child.run([line('look')]);
        assert.ok(child.ready, 'child restored: ' + (child.readyError || ''));
        assert.strictEqual(child.readyError, null);
        const reference = runReference(PREFIX, [line('look')]);
        const diffs = fingerprintDiff(reference.fingerprint, child.fingerprint);
        assert.deepStrictEqual(diffs, [], 'restored continuation must match the uninterrupted reference');
        await child.finish();
        assert.strictEqual(child.exitCode, 0, 'green control child exits 0');
    } finally {
        child.child.kill();
        await awaitExit(child, 10000).catch(() => {});
    }
});
