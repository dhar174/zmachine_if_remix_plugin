'use strict';

// Original, library-free Z5 fixture for Issue #46. No canonical story patching.
// Layout: header 0x00..0x3f; empty dictionary 0x80; 63 property defaults
// 0xc0..0x13d; 240 globals 0x180..0x35f; abbreviation table 0x380..0x3ff;
// static/high memory and initial PC 0x400. No objects or packed strings used.
// Z-machine Standards 1.1 sections 2.4, 4, 11 and 15 (random/read_char).
function rngStory() {
    const story = Buffer.alloc(2048);
    story[0] = 5;
    const word = (at, value) => story.writeUInt16BE(value, at);
    word(2, 1); word(4, 0x400); word(6, 0x400);
    word(8, 0x80); word(10, 0xc0); word(12, 0x180);
    word(14, 0x400); word(24, 0x380); word(26, story.length / 4);
    story.write('261108', 0x12, 'ascii');
    story[0x81] = 6; // dictionary: zero separators, six-byte entries, zero entries
    const seed = [0xe7, 0x3f, 0xff, 0xd6, 0x10]; // random -42 -> global 16
    const read = [0xf6, 0x7f, 1, 0x11]; // read_char 1 -> global 17 (untimed)
    const draw = [0xe7, 0x7f, 6, 0x12]; // random 6 -> global 18
    const print = [0xe6, 0xbf, 0x12, 0xbb]; // print_num global 18; new_line
    Buffer.from([
        ...seed, ...read,                         // capturable seeded boundary
        0xe7, 0x7f, 0, 0x10,                     // random 0: switch to host RNG
        ...draw, ...print, ...seed, ...read,       // entropy -> output -> reseed
        ...draw, ...print, 0xba,                  // seeded suffix, quit
    ]).copy(story, 0x400);
    let checksum = 0;
    for (const byte of story.subarray(0x40)) checksum = (checksum + byte) & 0xffff;
    word(28, checksum);
    return story;
}

module.exports = { rngStory };
