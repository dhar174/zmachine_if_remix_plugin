'use strict';
// Format-validation tests (A34 evidence layer): corrupt, truncated,
// incompatible, and hostile checkpoints must be REJECTED with a specific
// code before any interpreter is constructed, and a wrong-story quetzal must
// be caught by the VM's own IFhd verification.  Rejections are exercised both
// through validateEnvelope directly and through restoreCheckpoint (which must
// reject before adapter construction), never against a live baseline.

const { test } = require('node:test');
const assert = require('node:assert');
const {
    createInstance, capture, STORY, STORY_SHA256, LOOPSTORY_SHA256, REVISION,
} = require('./helpers.js');
const { restoreCheckpoint } = require('../lib/checkpoint-core.js');
const { validateEnvelope, canonicalEnvelopeString, sha256Hex, CheckpointError } = require('../lib/checkpoint-format.js');

const PREFIX = ['look', 'seed 42', 'take brass key'];
const EXPECTED = { storySha256: STORY_SHA256, storySize: STORY.length, runtimeRevision: REVISION };

function capturedEnvelope() {
    const src = createInstance();
    src.start();
    for (const t of PREFIX) src.send({ kind: 'line', text: t });
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

test('a well-formed captured envelope passes validation', () => {
    const env = capturedEnvelope();
    assert.strictEqual(validateEnvelope(env, EXPECTED), true);
});

test('unknown format magic and wrong schema version are rejected', () => {
    const env = capturedEnvelope();
    expectCode(() => validateEnvelope({ ...env, format: 'something-else' }, EXPECTED), 'E_FORMAT');
    expectCode(() => validateEnvelope({ ...env, version: 99 }, EXPECTED), 'E_VERSION');
    expectCode(() => validateEnvelope({ ...env, identity: { ...env.identity, schema: 99 } }, EXPECTED), 'E_VERSION');
});

test('wrong story digest, size, and runtime revision are rejected (A34)', () => {
    const env = capturedEnvelope();
    expectCode(() => validateEnvelope(env, { ...EXPECTED, storySha256: LOOPSTORY_SHA256 }), 'E_STORY');
    expectCode(() => validateEnvelope(env, { ...EXPECTED, storySize: STORY.length + 1 }), 'E_STORY');
    expectCode(() => validateEnvelope(env, { ...EXPECTED, runtimeRevision: 'deadbeef' }), 'E_RUNTIME');
});

test('unsupported boundary kinds are rejected', () => {
    const env = capturedEnvelope();
    expectCode(() => validateEnvelope({ ...env, boundary: { kind: 'timed-input' } }, EXPECTED), 'E_BOUNDARY');
    expectCode(() => validateEnvelope({ ...env, boundary: {} }, EXPECTED), 'E_BOUNDARY');
    expectCode(() => validateEnvelope({ ...env, boundary: { kind: 'line' } }, EXPECTED), 'E_BOUNDARY');
});

test('payload tampering is caught by the integrity digest', () => {
    const env = capturedEnvelope();
    const tampered = JSON.parse(JSON.stringify(env));
    tampered.payload.publishedOutput.output += 'TAMPERED\n'; // digest now lies
    expectCode(() => validateEnvelope(tampered, EXPECTED), 'E_DIGEST');
    const tampered2 = JSON.parse(JSON.stringify(env));
    tampered2.payload.quetzalB64 = tampered2.payload.quetzalB64.slice(0, -4) + 'AAAA';
    expectCode(() => validateEnvelope(tampered2, EXPECTED), 'E_DIGEST');
});

test('unseeded checkpoints are rejected, not silently accepted (E_RNG)', () => {
    // A fully honest envelope whose game is in unseeded mode: the digest is
    // recomputed, so only the policy check can refuse it.  Host Math.random
    // state can be neither captured nor reconstructed (bridge section 8), and
    // Issue #12 requires unsupported modes to fail explicitly.
    const env = capturedEnvelope();
    const unseeded = JSON.parse(JSON.stringify(env));
    unseeded.payload.rng = { seed: 0, mode: 'unseeded' };
    unseeded.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(unseeded));
    expectCode(() => validateEnvelope(unseeded, EXPECTED), 'E_RNG');
    // An envelope claiming seeded mode with seed 0 is equally unsupported.
    const zeroSeed = JSON.parse(JSON.stringify(env));
    zeroSeed.payload.rng = { seed: 0, mode: 'seeded' };
    zeroSeed.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(zeroSeed));
    expectCode(() => validateEnvelope(zeroSeed, EXPECTED), 'E_RNG');
});

test('malformed nested recovery state is rejected before any interpreter exists (A34)', () => {
    const env = capturedEnvelope();

    // io: {} passes a shallow object check but faults the continuation only
    // when the next input arrives (streams[2] access).
    const ioEmpty = JSON.parse(JSON.stringify(env));
    ioEmpty.payload.io = {};
    ioEmpty.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(ioEmpty));
    expectCode(() => validateEnvelope(ioEmpty, EXPECTED), 'E_STRUCTURE');

    // A stream table of the wrong shape.
    const ioStreams = JSON.parse(JSON.stringify(env));
    ioStreams.payload.io.streams = [0, 1, [], [], {}];
    ioStreams.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(ioStreams));
    expectCode(() => validateEnvelope(ioStreams, EXPECTED), 'E_STRUCTURE');

    // Pending memory-output-stream stack entries: slot 3 holds [address,
    // text] write-back entries that _print appends to (streams[3][0][1] +=
    // text); a malformed entry must not pass only to crash the continuation
    // after readiness (PR #37 re-review: streams[3] = [null] restored
    // ready:true and then threw "Cannot read properties of null (reading
    // '1')" on the next input).
    const memStreamNull = JSON.parse(JSON.stringify(env));
    memStreamNull.payload.io.streams[3] = [null];
    memStreamNull.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(memStreamNull));
    expectCode(() => validateEnvelope(memStreamNull, EXPECTED), 'E_STRUCTURE');

    // Even a WELL-FORMED entry is rejected: slot 3 is the memory-output-
    // stream stack (output_stream 3), not a command log, and its write-back
    // path has no round-trip evidence -- nonempty stacks fail explicitly
    // instead of being accepted unverified.
    const memStreamEntry = JSON.parse(JSON.stringify(env));
    memStreamEntry.payload.io.streams[3] = [[0x3000, 'pending memory-stream text']];
    memStreamEntry.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(memStreamEntry));
    expectCode(() => validateEnvelope(memStreamEntry, EXPECTED), 'E_STRUCTURE');

    // File-backed transcript state: an open Glk stream reference (or mode 2,
    // which is exactly that reference in use) cannot cross the data-only
    // envelope.  Slot 2 = transcript, slot 4 = command recording.
    const transcriptRef = JSON.parse(JSON.stringify(env));
    transcriptRef.payload.io.streams[2] = { mode: 2, str: null };
    transcriptRef.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(transcriptRef));
    expectCode(() => validateEnvelope(transcriptRef, EXPECTED), 'E_STRUCTURE');
    const commandFileMode = JSON.parse(JSON.stringify(env));
    commandFileMode.payload.io.streams[4] = { mode: 2 };
    commandFileMode.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(commandFileMode));
    expectCode(() => validateEnvelope(commandFileMode, EXPECTED), 'E_STRUCTURE');
    const badCache = JSON.parse(JSON.stringify(env));
    badCache.payload.io.streams[2] = { mode: 1, cache: 5 };
    badCache.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(badCache));
    expectCode(() => validateEnvelope(badCache, EXPECTED), 'E_STRUCTURE');

    // Redirected input: slot 0 holds 0 (keyboard) or a live Glk stream
    // reference -- only the former is representable.
    const redirectedInput = JSON.parse(JSON.stringify(env));
    redirectedInput.payload.io.streams[0] = 1;
    redirectedInput.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(redirectedInput));
    expectCode(() => validateEnvelope(redirectedInput, EXPECTED), 'E_STRUCTURE');

    // windows.main: null loses the captured transcript prefix silently.
    const noMain = JSON.parse(JSON.stringify(env));
    noMain.payload.windows.main = null;
    noMain.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(noMain));
    expectCode(() => validateEnvelope(noMain, EXPECTED), 'E_STRUCTURE');

    // A malformed window entry (missing text).
    const badWindow = JSON.parse(JSON.stringify(env));
    delete badWindow.payload.windows.upper.text;
    badWindow.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(badWindow));
    expectCode(() => validateEnvelope(badWindow, EXPECTED), 'E_STRUCTURE');

    // Transcript/window disagreement: sections describe different states.
    const inconsistent = JSON.parse(JSON.stringify(env));
    inconsistent.payload.publishedOutput.output += 'EXTRA';
    inconsistent.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(inconsistent));
    expectCode(() => validateEnvelope(inconsistent, EXPECTED), 'E_STRUCTURE');

    // Character readData without the store variable.
    const charEmpty = JSON.parse(JSON.stringify(env));
    charEmpty.boundary = { kind: 'char' };
    charEmpty.payload.readData = {};
    charEmpty.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(charEmpty));
    expectCode(() => validateEnvelope(charEmpty, EXPECTED), 'E_STRUCTURE');

    // Line readData with an out-of-range store variable.
    const badStorer = JSON.parse(JSON.stringify(env));
    badStorer.payload.readData.storer = 999;
    badStorer.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(badStorer));
    expectCode(() => validateEnvelope(badStorer, EXPECTED), 'E_STRUCTURE');

    // Boundary maxlen out of range.
    const badMaxlen = JSON.parse(JSON.stringify(env));
    badMaxlen.boundary.maxlen = 999;
    badMaxlen.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(badMaxlen));
    expectCode(() => validateEnvelope(badMaxlen, EXPECTED), 'E_BOUNDARY');
});

test('truncated and oversized payloads are rejected', () => {
    const env = capturedEnvelope();
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, quetzalB64: 'not base64!!' } }, EXPECTED), 'E_STRUCTURE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, quetzalB64: '' } }, EXPECTED), 'E_SIZE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, headerBlockB64: 'AAAA' } }, EXPECTED), 'E_STRUCTURE');
    const big = JSON.parse(JSON.stringify(env));
    big.payload.publishedOutput.output = 'x'.repeat(5 * 1024 * 1024);
    expectCode(() => validateEnvelope(big, EXPECTED), 'E_SIZE');
});

test('malformed readData and missing sections are rejected', () => {
    const env = capturedEnvelope();
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, readData: { buffer: 'nope' } } }, EXPECTED), 'E_STRUCTURE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, readData: { buffer: [-5, 70000] } } }, EXPECTED), 'E_STRUCTURE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, io: null } }, EXPECTED), 'E_STRUCTURE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, undo: { preserved: true } } }, EXPECTED), 'E_STRUCTURE');
    const charLike = JSON.parse(JSON.stringify(env));
    charLike.boundary = { kind: 'char' };
    expectCode(() => validateEnvelope(charLike, EXPECTED), 'E_STRUCTURE');
});

test('halted checkpoints must carry quit=true and no readData', () => {
    // Drive to the endgame and quit to obtain a genuine halted envelope.
    const src = createInstance();
    src.start();
    const path = ['look', 'seed 42', 'take brass key', 'north', 'unlock vault door with brass key', 'open vault door', 'north', 'put brass key on pedestal', 'quit'];
    let settled = null;
    for (const t of path) settled = src.send({ kind: 'line', text: t });
    assert.strictEqual(settled.status, 'halted', 'endgame quit must halt');
    const env = capture(src);
    assert.strictEqual(validateEnvelope(env, EXPECTED), true);
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, vmFlags: { quit: false, glkBlockingCall: null } } }, EXPECTED), 'E_STRUCTURE');
    expectCode(() => validateEnvelope({ ...env, payload: { ...env.payload, readData: { routine: 0, storer: 0, time: 0 } } }, EXPECTED), 'E_STRUCTURE');
});

test('a checkpoint whose quetzal IFhd claims a different story is rejected by the VM identity gate', () => {
    // Build an envelope that claims the loopstory digest and size with an
    // honestly recomputed payload digest: the envelope-level identity gate
    // must refuse it against the fixture bytes (E_STORY) before anything
    // else runs.  The payload quetzal is the fixture's own, so the payload
    // sections stay coherent.
    const fixtureEnv = capturedEnvelope();
    const hostile = JSON.parse(JSON.stringify(fixtureEnv));
    hostile.identity.storySha256 = LOOPSTORY_SHA256;
    const fs = require('node:fs');
    const path = require('node:path');
    const loopBytes = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'zmachine', 'negative', 'loopstory.z5'));
    hostile.identity.storySize = loopBytes.length;
    hostile.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(hostile));
    expectCode(
        () => restoreCheckpoint(hostile, require('./helpers.js').STORY, EXPECTED),
        'E_STORY',
    ); // envelope identity claims loopstory; active story is the fixture.

    // The second, VM-level identity gate behind the envelope: a checkpoint
    // whose PAYLOAD is fully fixture-consistent (checkpointed header matches
    // the trusted story header, so the #41 trusted-story cross-check passes)
    // but whose Quetzal IFhd chunk claims a different release must be
    // refused by restore_file's release/serial/checksum verification -- a
    // gate the envelope layer cannot substitute for.
    const ifhdForged = JSON.parse(JSON.stringify(fixtureEnv));
    const q = Buffer.from(ifhdForged.payload.quetzalB64, 'base64');
    const storyRelease = (STORY[0x02] << 8) | STORY[0x03];
    let off = 12;
    while (off + 8 <= q.length) {
        const type = q.toString('ascii', off, off + 4);
        const len = q.readUInt32BE(off + 4);
        if (type === 'IFhd') {
            q.writeUInt16BE((storyRelease + 1) & 0xFFFF, off + 8);
            ifhdForged.payload.quetzalB64 = q.toString('base64');
            break;
        }
        off += 8 + len + (len % 2);
    }
    ifhdForged.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(ifhdForged));
    expectCode(
        () => restoreCheckpoint(ifhdForged, STORY, EXPECTED),
        'E_STORY_QUETZAL',
    );
});
