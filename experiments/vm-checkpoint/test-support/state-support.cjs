'use strict';

// Original Z5 micro-stories, not patches to the canonical fixture. No compiler.
// Dynamic: header extension 0x40; object defaults 0x80..0xfd; abbreviations
// 0x100..0x1bf; globals 0x200..0x3df; tokenise buffers 0x400/0x440;
// alphabet 0x520..0x56d; Unicode table 0x580; custom dictionary 0x600;
// diagnostic dynamic routine 0x700. Static/high memory starts at 0x800:
// code, standard empty dictionary 0xc00, text 0xd00..0xd41, routine 0xe00.
// The dynamic-code case is interpreter stress evidence, not a claim that
// arbitrary below-high-memory/self-modifying routines are portable stories.
const { createHash } = require('node:crypto');
const wordBytes = value => [value >> 8 & 255, value & 255];
const SEED = [0xe7, 0x3f, 0xff, 0xd6, 0x10]; // random -42 -> global 16
const READ = [0xf6, 0x7f, 1, 0x11]; // keyboard device 1; no time/routine
const printChar = char => [0xe5, 0x7f, char];
const printAddr = addr => [0x87, ...wordBytes(addr)];
const printNumber = [0xe6, 0xbf, 0x12, 0xbb]; // global 18; newline
const call = addr => [0x88, ...wordBytes(addr / 4), 0x12];
const storeByte = (addr, value) => [0xe2, 0x17, ...wordBytes(addr), 0, value];
const storeWord = (addr, value) => [0xe1, 0x13, ...wordBytes(addr), 0, ...wordBytes(value)];
const split = height => [0xea, 0x7f, height];
const window = index => [0xeb, 0x7f, index];
const upper = [...split(2), ...window(1), ...printChar(85), ...window(0)];
const tokenise = [0xfb, 0x03, 4, 0, 4, 0x40, 6, 0,
    0xcf, 0x1f, 4, 0x40, 1, 0x12, ...printNumber]; // tokenise; loadw parse[1]

function makeStory(kind) {
    const story = Buffer.alloc(4096);
    const word = (addr, value) => story.writeUInt16BE(value, addr);
    story[0] = 5;
    word(2, 1); word(4, 0x800); word(6, 0x800); word(8, 0xc00);
    word(10, 0x80); word(12, 0x200); word(14, 0x800);
    story.write('261108', 0x12, 'ascii');
    word(24, 0x100); word(26, story.length / 4);
    story[0xc01] = 6;
    for (let i = 0; i < 96; i++) word(0x100 + i * 2, 0xd00 / 2);
    word(0xd00, 0x94a5); // empty, terminated Z-text
    word(0xd20, 0x98a5); word(0xd22, 0x9ca5); // 'a', 'b'
    word(0xd40, 0x8405); // abbreviation zero + padding
    story[0xe00] = 0; story[0xe01] = 0xb0; // zero locals; rtrue
    story[0x700] = 0; story[0x701] = 0xb0;
    story[0x400] = 20; story[0x401] = 3; story.write('cat', 0x402, 'ascii');
    story[0x440] = 4;
    story[0x601] = 6; word(0x602, 1);
    word(0x604, 0x20d9); word(0x606, 0x14a5); word(0x608, 0x94a5); // 'cat'
    const alphabet = Buffer.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ \r0123456789.,!?_#\'"/\\-:()', 'ascii');
    if (alphabet.length !== 78) throw new Error('bad original alphabet');
    alphabet.copy(story, 0x520);
    let opening = [...printChar(80), 0xbb], turn, suffix;
    switch (kind) {
    case 'immutable':
        turn = suffix = [...printAddr(0xd20), ...call(0xe00), ...printNumber]; break;
    case 'dictionary':
        turn = [...tokenise, ...storeWord(0x604, 0x268c)]; // replace encoded 'cat' by 'dog'
        suffix = tokenise; break;
    case 'abbreviation':
        word(0x100, 0xd20 / 2); opening.push(...printAddr(0xd40));
        turn = storeWord(0x100, 0xd22 / 2); suffix = printAddr(0xd40); break;
    case 'alphabet':
        word(0x34, 0x520); opening.push(...printAddr(0xd20));
        turn = storeByte(0x520, 98); suffix = printAddr(0xd20); break;
    case 'unicode':
        word(0x36, 0x40); word(0x40, 3); word(0x46, 0x580);
        story[0x580] = 1; word(0x581, 65);
        opening.push(...printChar(155));
        turn = storeWord(0x581, 66); suffix = printChar(155); break;
    case 'dynamic-code':
        turn = [...call(0x700), ...printNumber, ...storeByte(0x701, 0xb1)]; // change rtrue to rfalse
        suffix = [...call(0x700), ...printNumber]; break;
    case 'late-upper':
        turn = upper; suffix = printChar(76); break;
    case 'removed-upper':
        opening.push(...upper); turn = [0xed, 0x7f, 1, ...split(0)]; suffix = printChar(76); break; // erase upper first
    case 'selected-upper':
        opening.push(...upper, ...window(1));
        turn = [...printChar(88), 0xef, 0x5f, 2, 3, ...window(0), ...printChar(76)];
        suffix = printChar(90); break;
    case 'resize-reopen':
        opening.push(...upper);
        turn = split(1); // shrink: avoids the shim's missing glk_window_get_stream expansion path
        suffix = [...split(0), ...READ, ...split(3), ...window(1), ...printChar(82), ...window(0)]; break;
    case 'resize-grow':
        opening.push(...upper); turn = split(4); suffix = printChar(76); break;
    default: throw new Error('unknown original story ' + kind);
    }
    const code = Buffer.from([...SEED, ...opening, ...READ, ...turn, ...READ, ...suffix, 0xba]);
    if (0x800 + code.length > 0xc00) throw new Error('code/table overlap');
    code.copy(story, 0x800);
    let checksum = 0;
    for (const byte of story.subarray(0x40)) checksum = (checksum + byte) & 0xffff;
    word(28, checksum);
    return story;
}

function observe(adapter) {
    const { vm } = adapter.__g1bInternals();
    const win = w => w ? { type: w.type, rock: w.rock,
        parentIsMain: w.parent === vm.mainwin, text: w.text,
        cursorX: w.cursorX, cursorY: w.cursorY } : null;
    return {
        jit: Object.keys(vm.jit).sort((a, b) => Number(a) - Number(b)).map(addr => [Number(addr), typeof vm.jit[addr]]),
        dictionaries: Object.keys(vm.dictionaries).map(Number).sort((a, b) => a - b),
        alphabet0: vm.alphabets[0][0], unicode155: vm.unicode_table[155],
        alphabetRam: vm.m.getUint8(0x520), unicodeRam: vm.m.getUint16(0x581),
        abbreviation0: vm.m.getUint16(0x100), dictionaryWord: vm.m.getUint16(0x604),
        dynamicOpcode: vm.m.getUint8(0x701),
        windows: { main: win(vm.mainwin), upper: win(vm.upperwin), status: win(vm.statuswin) },
        io: JSON.parse(JSON.stringify(vm.io)),
        stackViewsShareBuffer: vm.s.buffer === vm.stack.buffer && vm.l.buffer === vm.stack.buffer,
    };
}
const digest = story => createHash('sha256').update(story).digest('hex');
module.exports = { makeStory, observe, digest };
