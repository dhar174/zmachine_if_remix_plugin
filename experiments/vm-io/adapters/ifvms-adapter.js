'use strict';
// ==============================================================================
// ifvms-adapter.js -- runs the vendored ifvms.js ZVM in-process under Node
// behind the minimal experimental adapter interface used by probe.js.
// ------------------------------------------------------------------------------
// Probe code, not a production adapter.  The adapter interface (create/start/
// send/shutdown) is experimental and must not be frozen as a product contract.
//
// Conceptual probe states mapped to tested signals (see
// docs/evidence/g1-native-io.md for the full mapping and its limitations):
//   waiting_for_line_input       -- ZVM issued glk_request_line_event_uni
//   waiting_for_character_input  -- ZVM issued glk_request_char_event_uni
//   halted                       -- ZVM called glk_exit (quit opcode) or vm.quit
//   error                        -- ZVM reported a fatal error via the Glk shim
//   running                      -- not observable from outside: the in-process
//                                   VM runs synchronously inside init/resume
// ==============================================================================

const path = require('path');
const { createGlk } = require('../glksim.js');
const ZVM = require('../vendor/ifvms/src/index.js').ZVM;

// ifvms.js master revision vendored under vendor/ifvms (MIT).
const REVISION = '6ac63e6b61144d4353a168df16c4ad5c22526f88';

function createIfvmsAdapter(storyBytes /*, options */) {
    const state = { inputQueue: [] };
    const Glk = createGlk(state);
    const vm = new ZVM();
    vm.prepare(storyBytes, { Glk, vm: vm });

    let lastOutputLen = 0;
    let started = false;

    function classify() {
        if (state.errors.length) return 'error';
        // The halt flag is authoritative: once glk_exit or the @quit opcode
        // has been observed the VM is halted, and send() refuses input for
        // exactly this predicate, so a state reported as ready is always one
        // send() will accept.  (An earlier diagnostic revision ranked a fresh
        // pending request above a sticky halted flag; that combination is
        // unreachable now that the adapter refuses post-halt input before
        // the stale-event replay can restart the VM.)
        if (state.halted || vm.quit) return 'halted';
        const tail = state.requestLog.length ? state.requestLog[state.requestLog.length - 1] : null;
        if (!tail) return 'running';
        return tail.request === 'char' ? 'waiting_for_character_input' : 'waiting_for_line_input';
    }

    function lastRequest() {
        return state.requestLog.length ? state.requestLog[state.requestLog.length - 1] : null;
    }

    // The most recent request that has been answered (boundary evidence for
    // the input just delivered; the plain tail is the NEXT pending request).
    function lastAnsweredRequest() {
        for (let i = state.requestLog.length - 1; i >= 0; i--) {
            if (state.requestLog[i].answeredWith !== null) return state.requestLog[i];
        }
        return null;
    }

    function settle() {
        const output = state.output;
        const delta = output.slice(lastOutputLen);
        lastOutputLen = output.length;
        return {
            status: classify(),
            delta,
            output,
            gridOutput: state.gridOutput,
            lastRequest,
            lastAnsweredRequest,
            requestLog: state.requestLog.slice(),
            errors: state.errors.slice(),
            unexpectedGlk: state.unexpected.slice(),
        };
    }

    return {
        describe() {
            return {
                runtime: 'ifvms.js ZVM',
                revision: REVISION,
                mode: 'in-process Node.js, headless Glk shim (glksim.js)',
                license: 'MIT (vendored LICENSE)',
            };
        },

        start() {
            if (started) throw new Error('adapter already started');
            started = true;
            // new ZVM() auto-called init() once (lazy setup + rebind to start);
            // this explicit call therefore runs start(): identify, restart, run
            // until the first input boundary.
            vm.init();
            return settle();
        },

        // input: { kind: 'line', text: 'look' }  or  { kind: 'char', key: 'b' }
        // A kind that does not match the VM's requested boundary is answered
        // anyway and recorded as a mismatch in the boundary log.
        send(input) {
            if (state.halted || vm.quit) {
                // A halted VM must never be driven again: ZVM's resume()
                // re-processes the stale answered event and would resume past
                // the @quit opcode (observed artifact; see
                // docs/evidence/g1-native-io.md).  The refused input is
                // recorded and produces no output.
                state.unexpected.push({ call: 'send-after-halt', detail: input.kind });
                return settle();
            }
            Glk._answerPending(input);
            try {
                vm.resume();
            } catch (e) {
                state.errors.push('uncaught: ' + (e && e.message ? e.message : String(e)));
            }
            return settle();
        },

        // Read-only internal state inspection (ifvms internals are undocumented;
        // pinned to the vendored revision).  Used for A23-adjacent evidence:
        // inspection does not advance VM time.
        inspect() {
            return {
                pc: vm.pc,
                turns: undefined, // turns live in story globals, not VM fields
                globalsTable: vm.globals,
                rngSeed: vm.xorshift_seed,
                quit: !!vm.quit,
            };
        },

        // G1-B checkpoint probe hook (Issue #12): exposes the live handles the
        // checkpoint capture/restore code needs -- the shim evidence state, the
        // ZVM instance, the Glk shim object, and the internal settle() (used by
        // the restore path to re-sync the output-delta watermark after the
        // published transcript is replaced) -- without changing any behavior.
        // Exposing internals is experimental probe surface, not a production
        // adapter contract; duplicating send()/classify() in a separate wrapper
        // would risk drifting from the shared halt predicate that PR #36 review
        // settled.  Exercised end-to-end by the experiments/vm-checkpoint suite.
        __g1bInternals() {
            return { state, vm, Glk, settle };
        },

        // The in-process VM needs no teardown; report the final settled state.
        async shutdown() {
            return settle();
        },
    };
}

module.exports = { createIfvmsAdapter, REVISION };
