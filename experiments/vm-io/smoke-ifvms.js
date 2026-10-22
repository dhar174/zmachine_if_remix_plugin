'use strict';
// Smoke driver for the ifvms adapter: exercises the fixture through a few
// steps and prints the transcript.  Throwaway diagnostic script; the real
// evidence runs go through probe.js.

const fs = require('fs');
const path = require('path');
const { createIfvmsAdapter } = require('./adapters/ifvms-adapter.js');

const storyPath = process.argv[2]
    || path.join(__dirname, '..', '..', 'tests', 'fixtures', 'zmachine', 'fixture.z5');
const story = fs.readFileSync(storyPath);

const adapter = createIfvmsAdapter(story);
console.error('runtime:', JSON.stringify(adapter.describe()));

const start = adapter.start();
console.error('START status:', start.status);
process.stdout.write(start.delta);

const commands = ['markers', 'look', 'inventory', 'take panel', 'north', 'roll', 'menu'];
let charPending = false;
for (const cmd of commands) {
    const r = adapter.send({ kind: 'line', text: cmd });
    process.stdout.write('\n> ' + cmd + '   [status=' + r.status + ']\n');
    process.stdout.write(r.delta);
    if (r.status === 'waiting_for_character_input') {
        charPending = true;
        break; // menu is open; feed a key next
    }
}
if (charPending) {
    const r = adapter.send({ kind: 'char', key: 'b' });
    process.stdout.write('\n> [key: b]   [status=' + r.status + ']\n');
    process.stdout.write(r.delta);
}
console.error('done');
