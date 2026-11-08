'use strict';
// Called only for the adapter whose outer lock the test holds.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { publishEvidence } = require('../evidence-writer.js');

function preserveEvidence(file, lease) {
    lease.assertOwned();
    const existed = fs.existsSync(file);
    const bytes = existed ? fs.readFileSync(file) : null;
    return async () => {
        lease.assertOwned();
        if (existed) {
            await publishEvidence(file, bytes);
            lease.assertOwned();
            assert.deepEqual(fs.readFileSync(file), bytes, 'exact original receipt restored');
        } else {
            fs.rmSync(file, { force: true });
            assert.equal(fs.existsSync(file), false);
        }
    };
}

module.exports = { preserveEvidence };
