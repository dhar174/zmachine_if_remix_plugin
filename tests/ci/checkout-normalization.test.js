'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeCheckout } = require('../../.github/scripts/normalize-checkout.js');

test('normalization repairs inherited CRLF checkout without changing binary bytes', () => {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'zirp-checkout-'));
    try {
        const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
        git('init', '-q');
        git('config', 'core.autocrlf', 'false');
        git('config', 'core.eol', 'crlf');
        fs.writeFileSync(path.join(dir, '.git', 'info', 'attributes'), '*.inf text\n*.z5 -text\n');
        const text = Buffer.from('fixture source\nsecond line\n');
        const binary = Buffer.from([5, 0, 13, 10, 255, 0, 10]);
        fs.writeFileSync(path.join(dir, 'fixture.inf'), text);
        fs.writeFileSync(path.join(dir, 'fixture.z5'), binary);
        git('add', '--', 'fixture.inf', 'fixture.z5');
        fs.unlinkSync(path.join(dir, 'fixture.inf'));
        git('checkout-index', '-f', '-a');
        // Reproduce the previous workflow under an inherited CRLF policy.
        git('config', 'core.autocrlf', 'false');
        git('checkout-index', '-f', '-a');
        assert.deepEqual(fs.readFileSync(path.join(dir, 'fixture.inf')),
            Buffer.from('fixture source\r\nsecond line\r\n'));
        normalizeCheckout(dir);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'fixture.inf')), text);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'fixture.z5')), binary);
        normalizeCheckout(dir);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'fixture.inf')), text);
        assert.equal(git('diff', '--exit-code').length, 0);
        assert.throws(() => normalizeCheckout(path.join(dir, 'missing')), /ENOENT|cannot find|missing/);
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), root);
        assert.ok(path.basename(dir).startsWith('zirp-checkout-'));
        assert.equal(fs.realpathSync(dir), dir);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
