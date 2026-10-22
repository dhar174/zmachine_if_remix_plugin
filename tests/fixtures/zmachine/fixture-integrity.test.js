'use strict';
// Fixture integrity tests: verify the committed story file and vendored
// library match the digest manifest, and (when the pinned compiler is
// available locally) that recompilation reproduces the committed bytes.
//
// Run: node --test tests/fixtures/zmachine/

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const DIR = __dirname;

function readManifest() {
    return fs.readFileSync(path.join(DIR, 'fixture.sha256'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => {
            const m = l.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
            if (!m) throw new Error('bad manifest line: ' + l);
            // Manifest values name repo-relative files; refuse anything that
            // would resolve outside this directory.
            const resolved = path.resolve(DIR, m[2]);
            const rel = path.relative(path.resolve(DIR), resolved);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
                throw new Error('manifest path escapes fixture directory: ' + m[2]);
            }
            return { sha256: m[1], file: m[2], resolved };
        });
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

test('fixture digest manifest matches on-disk files', () => {
    const entries = readManifest();
    assert.ok(entries.length >= 2, 'manifest lists the story and library files');
    for (const e of entries) {
        assert.ok(fs.existsSync(e.resolved), 'missing manifest file: ' + e.file);
        assert.strictEqual(sha256(fs.readFileSync(e.resolved)), e.sha256, 'digest mismatch: ' + e.file);
    }
});

test('story file is a Z-machine v5 story with the expected header', () => {
    const story = fs.readFileSync(path.join(DIR, 'fixture.z5'));
    assert.ok(story.length > 64, 'story has a full header');
    assert.strictEqual(story[0], 5, 'Z-machine version byte is 5');
    // Serial number at 0x12..0x17 is the six ASCII digits set in the source.
    assert.strictEqual(story.subarray(0x12, 0x18).toString('ascii'), '261022');
});

test('recompilation reproduces the committed fixture bytes', { skip: !fs.existsSync(path.join(DIR, 'tools', 'inform6-6.44', process.platform === 'win32' ? 'inform6.exe' : 'inform6')) ? 'pinned Inform 6 compiler not present locally (story digest is pinned in fixture.sha256 instead)' : false }, () => {
    const exe = path.join(DIR, 'tools', 'inform6-6.44', process.platform === 'win32' ? 'inform6.exe' : 'inform6');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g1a-build-')), 'fixture.z5');
    execFileSync(exe, ['-v5', '+include_path=lib', path.join(DIR, 'fixture.inf'), out], { cwd: DIR });
    const rebuilt = fs.readFileSync(out);
    const committed = fs.readFileSync(path.join(DIR, 'fixture.z5'));
    assert.ok(rebuilt.equals(committed), 'recompiled story is byte-identical to the committed fixture.z5');
});
