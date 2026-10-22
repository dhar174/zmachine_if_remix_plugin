'use strict';
// ==============================================================================
// glksim.js -- minimal headless Glk implementation for ifvms.js ZVM under Node
// ------------------------------------------------------------------------------
// Part of the G1-A experimental probe harness (experiments/vm-io/).  This is
// throwaway probe code, NOT a production adapter, and implements ONLY the Glk
// surface the vendored ZVM actually calls (verified against
// vendor/ifvms at revision 6ac63e6b61144d4353a168df16c4ad5c22526f88).
//
// Design:
//   - Output is captured synchronously into per-window buffers, preserving
//     execution order exactly (no re-wrapping, no trimming).
//   - The main window (type 3, buffer) is the canonical transcript; the upper
//     window (type 4, grid) captures status-line/upper-window text separately.
//   - Input is supplied by the adapter through a preloaded queue.  When ZVM
//     pauses on read/read_char it calls glk_request_line_event_uni or
//     glk_request_char_event_uni; the NEXT glk_select() (called synchronously
//     inside vm.init()/vm.resume()) answers from the queue.  Every request /
//     answer pair is logged with whether the supplied input KIND matched the
//     requested boundary -- ifvms distinguishes line vs char at the API level,
//     so mismatches are first-class evidence here.
// ==============================================================================

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

class RefBox {
    constructor(v) { this.value = v === undefined ? 0 : v; }
    set_value(v) { this.value = v; }
    get_value() { return this.value; }
}

class RefStruct {
    constructor(...fields) { this.fields = fields; }
    push_field(v) { this.fields.push(v); }
    get_field(i) { return this.fields[i]; }
    set_field(i, v) { this.fields[i] = v; }
    len() { return this.fields.length; }
}

function createGlk(state) {
    // `state` (owned by the adapter) accumulates all probe evidence:
    //   output       -- main (buffer) window text, exact ordering
    //   gridOutput   -- upper (grid) window text (status line etc.)
    //   requestLog   -- every input request and how it was answered
    //   errors       -- fatal_error calls
    //   unexpected   -- Glk calls outside the probe's supported surface
    //   halted       -- set by glk_exit()
    state.output = '';
    state.gridOutput = '';
    state.requestLog = [];
    state.errors = [];
    state.unexpected = [];
    state.halted = false;
    state.pendingEvent = null;

    let currentWindow = null;
    let mainwin = null;
    let pending = null; // { type: 'line'|'char', win, buffer?, maxlen? }

    function unexpected(name, detail) {
        state.unexpected.push({ call: name, detail: detail === undefined ? null : detail });
        return 0;
    }

    const windows = [];

    const Glk = {
        RefBox,
        RefStruct,

        update() { /* flush hook; capture is synchronous */ },

        fatal_error(e) {
            state.errors.push(String(e && e.message ? e.message : e));
        },

        // ---- windows ----------------------------------------------------

        glk_window_open(split, method, size, wintype, rock) {
            const win = {
                type: wintype, // 3 = buffer (pairing/text), 4 = grid
                rock,
                parent: split || null,
                text: '',
                cursorX: 0,
                cursorY: 0,
            };
            windows.push(win);
            if (wintype === 3 && !split) mainwin = win;
            currentWindow = currentWindow || win;
            return win;
        },

        glk_window_close(win) {
            const i = windows.indexOf(win);
            if (i >= 0) windows.splice(i, 1);
            if (currentWindow === win) currentWindow = mainwin || null;
        },

        glk_window_get_parent(win) { return win.parent; },

        glk_window_get_size(win, widthBox, heightBox) {
            if (widthBox) widthBox.set_value(DEFAULT_WIDTH);
            if (heightBox) heightBox.set_value(DEFAULT_HEIGHT);
        },

        glk_window_set_arrangement(win, method, size, keywin) { /* no-op */ },
        glk_window_clear(win) {
            if (win) win.text = '';
            if (win === mainwin) state.output = '';
            if (win && win.type === 4) state.gridOutput = '';
        },

        glk_window_move_cursor(win, x, y) {
            if (win) {
                win.cursorX = x;
                win.cursorY = y;
                // Newline-separated rows keep grid capture readable.
                if (win.type === 4 && win.text.length && !win.text.endsWith('\n')) {
                    win.text += '\n';
                }
            }
        },

        glk_set_window(win) { currentWindow = win || mainwin; },

        // ---- output -----------------------------------------------------

        glk_put_jstring(str /*, system */) {
            if (currentWindow) {
                currentWindow.text += str;
                if (currentWindow.type === 4) state.gridOutput = currentWindow.text;
                else state.output = currentWindow.text;
            }
        },

        glk_set_style(style) { /* styles not part of transcript evidence */ },
        glk_stylehint_set(/* ... */) {},
        glk_stylehint_clear(/* ... */) {},
        glk_gestalt(sel, val) { return 0; }, // 0x1100 (Gargoyle colors) unsupported

        garglk_set_reversevideo() { return unexpected('garglk_set_reversevideo'); },
        garglk_set_reversevideo_stream() { return unexpected('garglk_set_reversevideo_stream'); },
        garglk_set_zcolors_stream() { return unexpected('garglk_set_zcolors_stream'); },

        // ---- input ------------------------------------------------------

        glk_request_line_event_uni(win, buffer, maxlen) {
            pending = { type: 'line', win, buffer, maxlen };
            state.requestLog.push({ request: 'line', maxlen, answeredWith: null, boundary: null });
            return 1;
        },

        glk_request_char_event_uni(win) {
            pending = { type: 'char', win };
            state.requestLog.push({ request: 'char', answeredWith: null, boundary: null });
            return 1;
        },

        // ZVM calls glk_select synchronously right after run() pauses on an
        // input request.  If the adapter has queued an answer, fill the event
        // from it; otherwise leave the event EMPTY and keep the request
        // pending -- the adapter then supplies input via _answerPending()
        // before calling vm.resume().  This keeps one adapter step equal to
        // one delivered input, and lets parser sub-prompts (disambiguation)
        // surface as their own input boundaries.
        glk_select(event) {
            if (!pending) {
                unexpected('glk_select_without_pending_input');
                return;
            }
            if (state.inputQueue && state.inputQueue.length) {
                Glk._answerPending(state.inputQueue.shift());
                return;
            }
            state.pendingEvent = event; // unanswered; adapter must _answerPending
        },

        // Fill the pending event from an adapter input.  Returns true when a
        // pending request was answered.  The input KIND is compared with the
        // requested boundary and logged -- ifvms distinguishes line vs char
        // at the API level, so mismatches are first-class evidence.
        _answerPending(input) {
            input = input || { kind: 'eof' };
            const event = state.pendingEvent;
            if (!event || !pending) return false;
            const log = state.requestLog[state.requestLog.length - 1];

            if (pending.type === 'line') {
                const buffer = pending.buffer;
                let len = 0;
                if (input.kind === 'line') {
                    const codes = [];
                    for (const ch of input.text) codes.push(ch.codePointAt(0));
                    len = Math.min(codes.length, buffer.length);
                    for (let i = 0; i < len; i++) buffer[i] = codes[i];
                    log.boundary = 'match';
                    log.answeredWith = 'line:' + JSON.stringify(input.text);
                } else if (input.kind === 'char') {
                    // Wrong-boundary evidence: a bare key supplied at a line
                    // prompt is delivered as an empty line (no synthetic text).
                    log.boundary = 'mismatch';
                    log.answeredWith = 'char:' + input.key;
                } else {
                    log.boundary = input.kind; // 'eof'
                    log.answeredWith = input.kind;
                }
                event.push_field(3);
                event.push_field(pending.win);
                event.push_field(len);
                event.push_field(13);
            } else {
                // char request
                let code;
                if (input.kind === 'char') {
                    code = input.key.codePointAt(0);
                    log.boundary = 'match';
                    log.answeredWith = 'char:' + input.key;
                } else if (input.kind === 'line') {
                    // Wrong-boundary evidence: model the bocfel non-Glk
                    // behavior (first character of the line is used, the rest
                    // discarded) so both adapters see the same stimulus.
                    log.boundary = 'mismatch';
                    const first = input.text && input.text.length ? input.text[0] : '\n';
                    code = first.codePointAt(0);
                    log.answeredWith = 'line:' + JSON.stringify(input.text);
                } else {
                    log.boundary = input.kind; // 'eof'
                    code = 13;
                    log.answeredWith = input.kind;
                }
                event.push_field(2);
                event.push_field(pending.win);
                event.push_field(code);
            }
            pending = null;
            state.pendingEvent = null;
            return true;
        },

        // ---- streams / files (not exercised by this fixture; recorded) ----

        glk_fileref_create_by_prompt(usage, mode, rock) {
            return unexpected('glk_fileref_create_by_prompt', { usage, mode, rock });
        },
        glk_fileref_destroy() { return unexpected('glk_fileref_destroy'); },
        glk_stream_open_file() { return unexpected('glk_stream_open_file'); },
        glk_stream_open_file_uni() { return unexpected('glk_stream_open_file_uni'); },
        glk_stream_close() { return unexpected('glk_stream_close'); },
        glk_put_jstring_stream(str, text) { return unexpected('glk_put_jstring_stream', String(text).slice(0, 80)); },
        glk_put_char_stream_uni(str, code) { return unexpected('glk_put_char_stream_uni', code); },
        glk_get_line_stream_uni() { return unexpected('glk_get_line_stream_uni'); },
        glk_get_char_stream_uni() { return unexpected('glk_get_char_stream_uni'); },

        glk_exit() { state.halted = true; },
    };

    return Glk;
}

module.exports = { createGlk, RefBox, RefStruct };
