'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Clean CI checkouts only. Export to a new directory: checkout-index can
// otherwise retain existing CRLF files that its index considers up to date.
function normalizeCheckout(cwd) {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    const workspace = fs.realpathSync(cwd);
    const entries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map((row) => {
        const [metadata, name] = row.split('\t');
        if (!/^100(644|755) [a-f0-9]+ 0$/.test(metadata)) throw new Error('unsupported index entry: ' + metadata);
        const target = path.resolve(workspace, name);
        const relative = path.relative(workspace, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path outside checkout');
        return { name, target };
    });
    const root = fs.realpathSync(os.tmpdir());
    const temp = fs.mkdtempSync(path.join(root, 'zirp-lf-export-'));
    try {
        git('config', '--local', 'core.autocrlf', 'false');
        git('config', '--local', 'core.eol', 'lf');
        git('checkout-index', '--all', '--force', '--prefix=' + temp.replace(/\\/g, '/') + '/');
        for (const { name, target } of entries) {
            const source = path.join(temp, name);
            // The checkout must contain ordinary tracked files, not symlinks.
            if (!fs.lstatSync(source).isFile() || !fs.lstatSync(target).isFile()) throw new Error('non-file checkout entry');
            fs.copyFileSync(source, target);
        }
    } finally {
        if (path.dirname(path.resolve(temp)) !== root || !path.basename(temp).startsWith('zirp-lf-export-')
            || fs.realpathSync(temp) !== temp) throw new Error('unsafe scratch cleanup');
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
if (require.main === module) normalizeCheckout(process.cwd());
module.exports = { normalizeCheckout };
