"""Original, library-free Z5 character control; no canonical story patching.

Header/dynamic layout follows Z-machine 1.1 sections 4, 11, 13 and 15.
No object operations, abbreviation references, timers or external files.
The explicit device operand distinguishes this story from the canonical menu.
"""
import hashlib
import struct


def character_story():
    story = bytearray(2048)
    story[0] = 5
    def word(at, value):
        struct.pack_into(">H", story, at, value)
    for at, value in [(2, 51), (4, 0x400), (6, 0x400), (8, 0x500),
                      (10, 0xC0), (12, 0x180), (14, 0x400),
                      (24, 0x600), (26, len(story) // 4)]:
        word(at, value)
    story[0x12:0x18] = b"261108"
    story[0x501] = 6  # empty v5 dictionary, six-byte entries
    for i in range(96):
        word(0x600 + 2 * i, 0x360)
    word(0x6C0, 0x94A5)  # empty terminated Z-text
    code = bytearray()
    def text(value):
        for char in value:
            code.extend([0xBB] if char == "\n" else [0xE5, 0x7F, ord(char)])
    code.extend([0xE7, 0x3F, 0xFF, 0xD6, 0x10])  # random -42 -> global 16
    text("[CTRL:char-open]\n")
    code.extend([0xF6, 0x7F, 1, 0x11])  # read_char device 1 -> global 17
    text("[CTRL:key=")
    code.extend([0xE6, 0xBF, 0x11])  # print_num global 17
    text("]\n")
    code.extend([0xE7, 0x7F, 6, 0x12])  # random 6 -> global 18
    text("[CTRL:roll=")
    code.extend([0xE6, 0xBF, 0x12])
    text("]\n")
    code.append(0xBA)  # quit
    assert len(code) < 0x100
    story[0x400:0x400 + len(code)] = code
    word(28, sum(story[0x40:]) & 0xFFFF)
    return bytes(story)


def digest(data):
    return hashlib.sha256(data).hexdigest()
