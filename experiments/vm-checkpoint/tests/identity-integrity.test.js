'use strict';

// Issue #43: the v2 checkpoint must bind recovery metadata and compare
// identity/capabilities against this implementation, not the import's claims.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('../test-support/bounded-sync.cjs');
const {
    createInstance, line, drive, capture, writeEnvelope, spawnRestore, awaitExit,
    STORY, STORY_SHA256, REVISION, FIXTURE, machineFingerprint, fingerprintDiff,
} = require('./helpers.js');
const { captureCheckpoint, restoreCheckpoint } = require('../lib/checkpoint-core.js');
const { implementationIdentity, capabilityStatement } = require('../lib/checkpoint-contract.js');
const { CheckpointError, validateEnvelope, canonicalEnvelopeString, sha256Hex } = require('../lib/checkpoint-format.js');

const EXPECTED = { storySha256: STORY_SHA256, storySize: STORY.length, runtimeRevision: REVISION, storyBytes: STORY };

function makeBaseline() {
    const adapter = createInstance();
    adapter.start();
    drive(adapter, [line('seed 42')]);
    const envelope = capture(adapter);
    return { adapter, envelope, json: JSON.stringify(envelope), fingerprint: machineFingerprint(adapter) };
}

function assertUnchanged(baseline, label) {
    assert.equal(JSON.stringify(capture(baseline.adapter)), baseline.json, label + ': checkpoint changed');
    assert.deepEqual(fingerprintDiff(baseline.fingerprint, machineFingerprint(baseline.adapter)), [], label + ': fingerprint changed');
}

function mutate(envelope, change, resign = true) {
    const copy = JSON.parse(JSON.stringify(envelope));
    change(copy);
    if (resign) copy.integrity.envelopeSha256 = sha256Hex(canonicalEnvelopeString(copy));
    return copy;
}

function expectCode(fn, code) {
    let error;
    try { fn(); } catch (caught) { error = caught; }
    assert.ok(error instanceof CheckpointError, 'expected CheckpointError');
    assert.equal(error.code, code);
    return error;
}

test('capture binds the registered adapter and original story bytes', () => {
    const base = makeBaseline();
    const impl = implementationIdentity();
    assert.equal(base.envelope.version, 2);
    assert.deepEqual(base.envelope.identity, { storySha256: STORY_SHA256, storySize: STORY.length, ...impl, schema: 2 });
    assert.deepEqual(base.envelope.capabilities, capabilityStatement());
    const context = { storySha256: STORY_SHA256, storySize: STORY.length };
    expectCode(() => captureCheckpoint({ __g1bInternals: () => base.adapter.__g1bInternals() }, context), 'E_RUNTIME');
    expectCode(() => captureCheckpoint(base.adapter, { ...context, storySha256: '0'.repeat(64) }), 'E_STORY');
    expectCode(() => captureCheckpoint(base.adapter, { ...context, storySize: STORY.length + 1 }), 'E_STORY');
    expectCode(() => validateEnvelope(base.envelope, { ...EXPECTED, storySha256: null }), 'E_STORY');
    const wrongStory = Buffer.from(STORY);
    wrongStory[wrongStory.length - 1] ^= 1;
    expectCode(() => restoreCheckpoint(base.envelope, wrongStory, EXPECTED), 'E_STORY');
    assertUnchanged(base, 'capture identity refusals');
});

test('v2 canonical bytes bind metadata, preserve arrays and ignore object insertion order', () => {
    const base = makeBaseline();
    const mini = { z: [3, { b: true, a: null }], a: 'x', integrity: { ignored: true } };
    assert.equal(canonicalEnvelopeString(mini), 'zirp-g1b-envelope-v2\n{"a":"x","z":[3,{"a":null,"b":true}]}');
    const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]))
            : value;
    const reordered = reverseKeys(base.envelope);
    assert.equal(canonicalEnvelopeString(reordered), canonicalEnvelopeString(base.envelope));
    assert.equal(validateEnvelope(reordered, EXPECTED), true);
    const changedIdentity = mutate(base.envelope, (e) => { e.identity.runtime = 'Bocfel'; }, false);
    assert.notEqual(sha256Hex(canonicalEnvelopeString(changedIdentity)), base.envelope.integrity.envelopeSha256);
    expectCode(() => canonicalEnvelopeString({ a: undefined }), 'E_STRUCTURE');
    expectCode(() => canonicalEnvelopeString({ a: Infinity }), 'E_STRUCTURE');
});

test('wrong runtime or adapter is rejected before adapter construction', () => {
    const base = makeBaseline();
    const adapterModule = require('../../vm-io/adapters/ifvms-adapter.js');
    const corePath = require.resolve('../lib/checkpoint-core.js');
    const originalFactory = adapterModule.createIfvmsAdapter;
    let constructions = 0;
    try {
        adapterModule.createIfvmsAdapter = () => { constructions++; throw new Error('unexpected adapter construction'); };
        delete require.cache[corePath];
        const instrumentedRestore = require(corePath).restoreCheckpoint;
        for (const [field, value] of [['runtime', 'Bocfel'], ['adapter', 'not-this-adapter']]) {
            const env = mutate(base.envelope, e => { e.identity[field] = value; });
            expectCode(() => instrumentedRestore(env, STORY, EXPECTED), 'E_RUNTIME');
        }
        assert.equal(constructions, 0);
    } finally {
        adapterModule.createIfvmsAdapter = originalFactory;
        delete require.cache[corePath];
    }
    assertUnchanged(base, 'pre-construction identity rejection');
});

test('an actual v1-shaped envelope is refused without migration', { timeout: 60000 }, async () => {
    const base = makeBaseline();
    const current = base.envelope;
    const oldCapabilities = JSON.parse(JSON.stringify(current.capabilities));
    oldCapabilities.schemaVersion = 1;
    oldCapabilities.coverage.memoryOutputStreams = 'unsupported (pending output_stream 3 stack writes rejected: the [address, text] write-back path has no round-trip evidence in v1)';
    const legacy = {
        format: current.format,
        version: 1,
        identity: {
            storySha256: current.identity.storySha256,
            storySize: current.identity.storySize,
            runtime: current.identity.runtime,
            runtimeRevision: current.identity.runtimeRevision,
            adapter: current.identity.adapter,
            schema: 1,
        },
        boundary: current.boundary,
        payload: current.payload,
        integrity: {
            payloadSha256: sha256Hex(JSON.stringify(current.payload)),
            quetzalBytes: Buffer.from(current.payload.quetzalB64, 'base64').length,
        },
        capabilities: oldCapabilities,
    };
    expectCode(() => validateEnvelope(legacy, EXPECTED), 'E_VERSION');
    const child = spawnRestore(writeEnvelope(legacy, 'issue43-legacy-v1.json'));
    try {
        const boot = await child.nextMessage(30000);
        assert.equal(boot.ready, false);
        assert.equal(boot.code, 'E_VERSION');
        assert.equal(await awaitExit(child, 30000), 2);
        assert.equal(child.ready, false);
        assert.equal(child.stderr, '');
    } finally {
        child.child.kill();
        await awaitExit(child, 10000).catch(() => {});
    }
    assertUnchanged(base, 'legacy refusal');
});

test('identity, boundary, capability and legacy mutations reject before child readiness', { timeout: 180000 }, async () => {
    const base = makeBaseline();
    assert.equal(base.envelope.boundary.kind, 'line');
    assert.equal(base.envelope.boundary.maxlen, 0);
    const cases = [
        ['runtime', e => { e.identity.runtime = 'Bocfel'; }, true, 'E_RUNTIME'],
        ['adapter', e => { e.identity.adapter = 'not-this-adapter'; }, true, 'E_RUNTIME'],
        ['revision', e => { e.identity.runtimeRevision = 'bad'; }, true, 'E_RUNTIME'],
        ['runtime-build', e => { e.identity.runtimeBuildSha256 = '0'.repeat(64); }, true, 'E_RUNTIME'],
        ['adapter-build', e => { e.identity.adapterBuildSha256 = '0'.repeat(64); }, true, 'E_RUNTIME'],
        ['node', e => { e.identity.nodeVersion = '0.0.0'; }, true, 'E_RUNTIME'],
        ['v8', e => { e.identity.v8Version = 'other'; }, true, 'E_RUNTIME'],
        ['platform', e => { e.identity.platform = 'other'; }, true, 'E_RUNTIME'],
        ['arch', e => { e.identity.arch = 'other'; }, true, 'E_RUNTIME'],
        ['unknown-identity', e => { e.identity.extra = true; }, true, 'E_STRUCTURE'],
        ['maxlen-stale', e => { e.boundary.maxlen = 1; }, false, 'E_DIGEST'],
        ['maxlen-rehashed', e => { e.boundary.maxlen = 1; }, true, 'E_BOUNDARY'],
        ['capability-stale', e => { e.capabilities.coverage.timedInput = 'supported'; }, false, 'E_DIGEST'],
        ['capability-rehashed', e => { e.capabilities.coverage.timedInput = 'supported'; }, true, 'E_CAPABILITY'],
        ['capability-extra', e => { e.capabilities.coverage.newAuthority = true; }, true, 'E_CAPABILITY'],
        ['capability-removed', e => { e.capabilities.unsupported = []; }, true, 'E_CAPABILITY'],
        ['unknown-boundary', e => { e.boundary.extra = 1; }, true, 'E_BOUNDARY'],
        ['extra-integrity', e => { e.integrity.extra = 1; }, true, 'E_STRUCTURE'],
        ['legacy-v1', e => { e.version = 1; e.identity.schema = 1; }, false, 'E_VERSION'],
    ];
    for (const [name, change, resign, code] of cases) {
        const env = mutate(base.envelope, change, resign);
        expectCode(() => validateEnvelope(env, EXPECTED), code);
        const file = writeEnvelope(env, 'issue43-' + name + '.json');
        assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(env));
        const child = spawnRestore(file);
        try {
            const boot = await child.nextMessage(30000);
            assert.equal(boot.ready, false, name + ': child must reject before ready');
            assert.equal(boot.code, code, name + ': wrong error');
            assert.equal(await awaitExit(child, 30000), 2);
            assert.equal(child.ready, false);
            assert.equal(child.stderr, '');
        } finally {
            child.child.kill();
            await awaitExit(child, 10000).catch(() => {});
        }
        assertUnchanged(base, name);
    }
});

test('changed runtime, adapter, shim or checkpoint source is a different build', { timeout: 120000 }, () => {
    const base = makeBaseline();
    const checkpoint = writeEnvelope(base.envelope, 'issue43-build-baseline.json');
    const experiments = path.resolve(__dirname, '..', '..');
    const tempBase = fs.realpathSync(os.tmpdir());
    const tempRoot = fs.mkdtempSync(path.join(tempBase, 'zirp-issue43-build-'));
    const resolvedRoot = fs.realpathSync(tempRoot);
    const relative = path.relative(tempBase, resolvedRoot);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(resolvedRoot).startsWith('zirp-issue43-build-'));
    const destExperiments = path.join(resolvedRoot, 'experiments');

    function copyVerified(relativePath) {
        const src = path.join(experiments, relativePath);
        const dst = path.join(destExperiments, relativePath);
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            fs.mkdirSync(dst, { recursive: true });
            for (const name of fs.readdirSync(src)) copyVerified(path.join(relativePath, name));
        } else {
            const bytes = fs.readFileSync(src);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, bytes);
            assert.deepEqual(fs.readFileSync(dst), bytes, 'copy readback: ' + relativePath);
        }
    }

    try {
        copyVerified('vm-checkpoint/lib');
        copyVerified('vm-io/adapters/ifvms-adapter.js');
        copyVerified('vm-io/glksim.js');
        copyVerified('vm-io/vendor/ifvms/src');
        const runner = path.join(destExperiments, 'vm-checkpoint', 'lib', 'runner.js');
        const unchanged = spawnSync(process.execPath, [runner, '--story', FIXTURE, '--checkpoint', checkpoint], {
            encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, input: '{"op":"exit"}\n',
        });
        assert.equal(unchanged.error, undefined);
        assert.equal(unchanged.status, 0, 'byte-identical build at another path must restore');
        assert.equal(unchanged.stderr, '');
        assert.equal(JSON.parse(unchanged.stdout.trim().split('\n')[0]).ready, true);
        for (const [relativePath, field] of [
            ['vm-io/adapters/ifvms-adapter.js', 'adapterBuildSha256'],
            ['vm-io/glksim.js', 'adapterBuildSha256'],
            ['vm-checkpoint/lib/checkpoint-core.js', 'adapterBuildSha256'],
            ['vm-checkpoint/lib/fingerprint.js', 'adapterBuildSha256'],
            ['vm-checkpoint/lib/transport-limits.js', 'adapterBuildSha256'],
            ['vm-io/vendor/ifvms/src/zvm/io.js', 'runtimeBuildSha256'],
        ]) {
            const target = path.join(destExperiments, relativePath);
            const original = fs.readFileSync(target);
            try {
                const changed = Buffer.concat([original, Buffer.from('\n// issue43 build identity test\n')]);
                fs.writeFileSync(target, changed);
                assert.deepEqual(fs.readFileSync(target), changed);
                const result = spawnSync(process.execPath, [runner, '--story', FIXTURE, '--checkpoint', checkpoint], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
                assert.equal(result.error, undefined, relativePath + ': runner failed to start');
                assert.equal(result.status, 2, relativePath + ': wrong exit');
                assert.equal(result.stderr, '');
                const boot = JSON.parse(result.stdout.trim());
                assert.equal(boot.ready, false);
                assert.equal(boot.code, 'E_RUNTIME');
                assert.match(boot.error, new RegExp(field));
            } finally {
                fs.writeFileSync(target, original);
                assert.deepEqual(fs.readFileSync(target), original);
            }
            assertUnchanged(base, relativePath);
        }
    } finally {
        fs.rmSync(resolvedRoot, { recursive: true, force: true });
        assert.equal(fs.existsSync(resolvedRoot), false);
    }
});
