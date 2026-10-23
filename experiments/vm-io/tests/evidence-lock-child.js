'use strict';
// Child helper for evidence-lock.test.js: lock exclusion must hold across
// processes, so the second contender runs in a fresh process.  argv[2] is a
// static mode string chosen by the parent test; no environment value ever
// reaches argv or a file path here.
//
// Exit 0 = lock acquired (and released).  Exit 1 = acquisition timed out.

const { withLocks } = require('./evidence-lock.js');

const mode = process.argv[2];

(async () => {
    try {
        await withLocks([mode], 1500, async () => {
            process.stdout.write('acquired\n');
        });
        process.exit(0);
    } catch (e) {
        process.stdout.write('not-acquired: ' + e.message + '\n');
        process.exit(1);
    }
})();
