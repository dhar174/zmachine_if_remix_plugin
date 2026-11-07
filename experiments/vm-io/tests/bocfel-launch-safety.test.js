'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('launch tests preserve an existing native executable in an isolated copy', { timeout: 90000 }, () => {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'zirp-bocfel-safety-'));
    try {
        for (const name of ['tests/bocfel-launch.test.js', 'adapters/bocfel-adapter.js']) {
            const file = path.join(dir, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const original = fs.readFileSync(path.join(__dirname, '..', name));
            fs.writeFileSync(file, original);
            assert.deepEqual(fs.readFileSync(file), original);
        }
        const exe = path.join(dir, 'tools', 'bocfel', 'bocfel.exe');
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        const sentinel = Buffer.from('existing native build sentinel\0\r\n');
        fs.writeFileSync(exe, sentinel);
        assert.deepEqual(fs.readFileSync(exe), sentinel);
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', path.join(dir, 'tests', 'bocfel-launch.test.js')],
            { encoding: 'utf8', timeout: 60000, env });
        // Check bytes even if the subprocess failed: the old tests overwrite
        // and delete this sentinel, and also fail their absence checks.
        assert.ok(fs.existsSync(exe), 'existing executable was deleted');
        assert.deepEqual(fs.readFileSync(exe), sentinel, 'existing executable was overwritten');
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.stderr, '');
        assert.match(result.stdout, /tests 7/, 'nested launch tests actually ran');
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), root);
        assert.ok(path.basename(dir).startsWith('zirp-bocfel-safety-'));
        assert.equal(fs.realpathSync(dir), dir);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
