'use strict';
// Harness boundary tests: input-boundary classification and wrong-boundary
// behavior of the ifvms adapter + Glk shim.  These are DETERMINISTIC tests of
// the harness itself (adapter layer), distinct from the interpreter
// integration evidence in the *-integration suites.
//
// Run: node --test (from experiments/vm-io)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIfvmsAdapter } = require('../adapters/ifvms-adapter.js');

const VM_IO_DIR = __dirname;
const REPO_ROOT = path.dirname(path.dirname(path.dirname(VM_IO_DIR)));
const FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'zmachine', 'fixture.z5');

function freshAdapter() {
    return createIfvmsAdapter(fs.readFileSync(FIXTURE));
}

test('startup reaches a line-input boundary without consuming scripted input', () => {
    const a = freshAdapter();
    const r = a.start();
    assert.strictEqual(r.status, 'waiting_for_line_input');
    const tail = r.lastRequest();
    assert.ok(tail, 'a pending input request exists');
    assert.strictEqual(tail.request, 'line');
    assert.strictEqual(tail.answeredWith, null, 'no input was consumed by startup');
});

test('menu command surfaces a character-input boundary, not a line boundary', () => {
    const a = freshAdapter();
    a.start();
    const menu = a.send({ kind: 'line', text: 'menu' });
    assert.strictEqual(menu.status, 'waiting_for_character_input');
    assert.ok(menu.delta.includes('[F07:menu-open]'));
    const tail = menu.lastRequest();
    assert.strictEqual(tail.request, 'char');
    assert.strictEqual(tail.answeredWith, null);
});

test('a natural-language line fed at the character boundary is recorded as a mismatch', () => {
    const a = freshAdapter();
    a.start();
    a.send({ kind: 'line', text: 'menu' });
    const wrong = a.send({ kind: 'line', text: 'hello' });
    const tail = wrong.lastAnsweredRequest();
    assert.strictEqual(tail.boundary, 'mismatch');
    assert.ok(tail.answeredWith.startsWith('line:'));
    // Bocfel-parity behavior: only the first character of the line is used.
    assert.ok(wrong.delta.includes('[F07:menu-key=104]'), 'first character h (ZSCII 104) reaches read_char');
    assert.ok(wrong.delta.includes('[F07:menu-choice=other]'));
    assert.strictEqual(wrong.status, 'waiting_for_line_input', 'menu closed; game continues');
});

test('a bare key fed at the line boundary is recorded as a mismatch and not parsed as a command', () => {
    const a = freshAdapter();
    a.start();
    const wrong = a.send({ kind: 'char', key: 'x' });
    const tail = wrong.lastAnsweredRequest();
    assert.strictEqual(tail.request, 'line');
    assert.strictEqual(tail.boundary, 'mismatch');
    assert.ok(tail.answeredWith.startsWith('char:'));
    // The shim delivers an empty line; the parser rejects it without
    // advancing the turn (no daemon marker in the delta).
    assert.ok(wrong.delta.includes('I beg your pardon'), 'parser rejected the empty line');
    assert.ok(!/\[F06:turn=\d+\]/.test(wrong.delta), 'no turn consumed by the rejected input');
    assert.strictEqual(wrong.status, 'waiting_for_line_input');
});

test('a matching key resolves the menu choice through the character boundary', () => {
    const a = freshAdapter();
    a.start();
    a.send({ kind: 'line', text: 'menu' });
    const pick = a.send({ kind: 'char', key: 'b' });
    const tail = pick.lastAnsweredRequest();
    assert.strictEqual(tail.boundary, 'match');
    assert.ok(pick.delta.includes('[F07:menu-key=98]'));
    assert.ok(pick.delta.includes('[F07:menu-choice=beta]'));
});

test('read-only internal inspection does not advance VM time', () => {
    const a = freshAdapter();
    const start = a.start();
    assert.strictEqual(start.status, 'waiting_for_line_input');
    const outLen0 = start.output.length;
    a.inspect();
    a.inspect();
    const state = a.inspect();
    assert.ok(typeof state.rngSeed === 'number', 'RNG seed observable');
    assert.strictEqual(state.quit, false);
    // No output was produced by inspection, and no game time has passed:
    // the next MARKERS still reports turns=0.
    const markers = a.send({ kind: 'line', text: 'markers' });
    assert.ok(markers.delta.includes('[F06:turns=0]'), 'no time passed during inspection');
    assert.strictEqual(
        start.output.length + markers.delta.length,
        markers.output.length,
        'inspection produced no output of its own'
    );
    assert.ok(!markers.delta.includes('[F06:turn='), 'meta MARKERS does not run the turn daemon');
});
