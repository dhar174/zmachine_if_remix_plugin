'use strict';
// Bocfel launch-resolution and availability tests: availability must recognize
// the launch configuration that would actually be selected (BOCFEL_COMMAND
// override > native Windows build > WSL2 default), not only wsl.exe, and the
// non-WSL paths must be testable without depending on this machine's platform.
//
// These are deterministic tests of the harness itself; no env-derived command
// is ever executed here (the adapter deliberately treats override/native
// availability as configuration presence; see bocfel-adapter.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBocfelLaunch, probeBocfelAvailable, windowsToWslPath } = require('../adapters/bocfel-adapter.js');

const TESTS_DIR = __dirname;
const NATIVE_EXE = path.join(TESTS_DIR, '..', 'tools', 'bocfel', 'bocfel.exe');

function withBocfelCommand(value, fn) {
    const prev = process.env.BOCFEL_COMMAND;
    if (value === undefined) delete process.env.BOCFEL_COMMAND;
    else process.env.BOCFEL_COMMAND = value;
    try {
        fn();
    } finally {
        if (prev === undefined) delete process.env.BOCFEL_COMMAND;
        else process.env.BOCFEL_COMMAND = prev;
    }
}

test('windowsToWslPath translates drive paths to /mnt form', { skip: process.platform !== 'win32' && 'drive-path translation is a Windows-path concern' }, () => {
    assert.strictEqual(windowsToWslPath('D:\\a\\b.z5'), '/mnt/d/a/b.z5');
    assert.strictEqual(windowsToWslPath('D:/a/b.z5'), '/mnt/d/a/b.z5');
});

test('resolveBocfelLaunch: BOCFEL_COMMAND overrides everything and substitutes @STORY@', { skip: process.platform !== 'win32' && 'drive-path translation is a Windows-path concern' }, () => {
    withBocfelCommand('mybocfel -C -m @STORY@', () => {
        const launch = resolveBocfelLaunch('D:\\x\\story.z5');
        assert.strictEqual(launch.platform, 'BOCFEL_COMMAND override');
        assert.deepStrictEqual(launch.command, ['mybocfel', '-C', '-m', '/mnt/d/x/story.z5']);
    });
});

test('resolveBocfelLaunch: native Windows build is preferred over the WSL default', () => {
    fs.mkdirSync(path.dirname(NATIVE_EXE), { recursive: true });
    fs.writeFileSync(NATIVE_EXE, 'placeholder (not a real interpreter)');
    withBocfelCommand(undefined, () => {
        try {
            const launch = resolveBocfelLaunch('D:\\x\\story.z5');
            assert.match(launch.platform, /Windows native/);
            assert.strictEqual(launch.command[0], NATIVE_EXE);
        } finally {
            fs.rmSync(NATIVE_EXE, { force: true });
        }
    });
});

test('resolveBocfelLaunch: WSL default when no override or native build exists', () => {
    withBocfelCommand(undefined, () => {
        assert.ok(!fs.existsSync(NATIVE_EXE), 'no native build may exist for this test');
        const launch = resolveBocfelLaunch('D:\\x\\story.z5');
        assert.match(launch.platform, /WSL2/);
        assert.strictEqual(launch.command[0], 'wsl.exe');
    });
});

test('probeBocfelAvailable: a configured BOCFEL_COMMAND is recognized without any probe execution', () => {
    withBocfelCommand('mybocfel -C -m @STORY@', () => {
        assert.strictEqual(probeBocfelAvailable(), true);
    });
});

test('probeBocfelAvailable: a native build at the documented tools path is recognized', () => {
    fs.mkdirSync(path.dirname(NATIVE_EXE), { recursive: true });
    fs.writeFileSync(NATIVE_EXE, 'placeholder (not a real interpreter)');
    withBocfelCommand(undefined, () => {
        try {
            assert.strictEqual(probeBocfelAvailable(), true);
        } finally {
            fs.rmSync(NATIVE_EXE, { force: true });
        }
    });
});

test('probeBocfelAvailable: with no override, no native build, and no WSL bocfel, unavailable', function () {
    // Mirrors the WSL availability check to decide skip: on machines where a
    // real WSL bocfel exists (e.g. the authoring machine) this case cannot be
    // arranged; on machines without one (CI runners) it must hold.
    let wslBocfelUsable = false;
    try {
        const { spawnSync } = require('node:child_process');
        const r = spawnSync('wsl.exe', ['-e', 'sh', '-c', 'exec "$HOME/.local/bin/bocfel" -v'], { encoding: 'utf8', timeout: 30000 });
        wslBocfelUsable = r.status === 0 && /Bocfel/.test(r.stdout || '');
    } catch {
        wslBocfelUsable = false;
    }
    if (wslBocfelUsable) return this.skip('a real WSL bocfel is installed on this machine');
    withBocfelCommand(undefined, () => {
        assert.ok(!fs.existsSync(NATIVE_EXE));
        assert.strictEqual(probeBocfelAvailable(), false);
    });
});
