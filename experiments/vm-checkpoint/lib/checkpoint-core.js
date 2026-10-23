'use strict';
// ==============================================================================
// checkpoint-core.js -- capture and restore of a live vendored-ifvms ZVM at an
// input boundary (G1-B probe, Issue #12).  Experimental probe code, NOT a
// production adapter or a product checkpoint format.
// ------------------------------------------------------------------------------
// Mechanism (pinned to vendored ifvms revision in identity.runtimeRevision):
//
//   capture: vm.save_file(vm.pc, 1) produces the upstream Quetzal chunks
//   (IFhd identity + UMem raw dynamic memory + Stks in-use call stack) -- the
//   same primitives upstream's Dialog autosave uses.  Everything Quetzal does
//   not cover is serialized explicitly beside it: xorshift RNG seed and mode,
//   the plain-data `io` object, the pending read_data + its buffer, window
//   text/cursor state, the published output transcript, and the request log.
//
//   restore: a FRESH ZVM is constructed from the pinned story bytes and runs
//   its normal start() (so windows/origram/stack exist), then the checkpoint
//   replaces the fresh state: restore_file() rebuilds memory/stacks/pc and
//   re-verifies story identity (returns 0 -> E_STORY_QUETZAL), io/read_data/
//   seed are re-applied AFTER restore_file because its update_header() call
//   zeroes the RNG seed (upstream do_autorestore does the same), the pending
//   Glk request is re-issued against the restored read_data buffer, and the
//   shim's published transcript is overwritten with the serialized one so
//   restore neither republishes the opening text nor loses prior output.
//   Transient fresh-run state (opening output, startup request log, undo
//   entries) is discarded, matching upstream autosave semantics for undo.
//
//   What is deliberately NOT preserved (declared, tested, not silent):
//   in-memory undo history (upstream autosave drops it too), timed input,
//   sound, graphics, Glk file streams, and the JIT cache (rebuilt on demand).
// ==============================================================================

const { createIfvmsAdapter, REVISION } = require('../../vm-io/adapters/ifvms-adapter.js');
const {
    FORMAT, SCHEMA_VERSION, RUNTIME_NAME, CheckpointError,
    sha256Hex, cloneJson, canonicalPayloadString, validateEnvelope,
} = require('./checkpoint-format.js');

// Serialize the live interpreter state at an input boundary into an envelope.
// The adapter must currently be settled at a boundary (line/char request
// pending) or halted.  `context` = { storySha256, storySize }.
function captureCheckpoint(adapter, context) {
    const { state, vm } = adapter.__g1bInternals();

    const halted = !!(state.halted || vm.quit);
    const tail = state.requestLog.length ? state.requestLog[state.requestLog.length - 1] : null;
    let kind;
    if (halted) {
        kind = 'halted';
    } else if (!tail || tail.answeredWith !== null) {
        throw new CheckpointError('E_NOT_AT_BOUNDARY', 'VM is not waiting at a line/char input boundary and is not halted');
    } else {
        kind = tail.request === 'char' ? 'char' : 'line';
    }

    // Upstream primitive: full Quetzal (IFhd + UMem + Stks) at the current pc.
    const quetzal = Buffer.from(vm.save_file(vm.pc, 1));

    // Interpreter-owned header fields (flags 1/2, screen dimensions and font
    // units, spec revision) live in dynamic memory but are RECOMPUTED by
    // update_header() on every restart/restore -- and the recomputation is
    // window-set-dependent (screen height = sum of window heights), so a
    // restored instance recomputes different bytes than the source last
    // published (observed: 0x20/0x24 = 24 at capture vs 48 after restore
    // because the source computed them before the game opened the upper
    // window).  The source's header block is therefore checkpointed and
    // written back verbatim after restore_file.
    const headerBlock = Buffer.from(vm.m.getUint8Array(0, 0x40));

    const payload = {
        quetzalB64: quetzal.toString('base64'),
        headerBlockB64: headerBlock.toString('base64'),
        rng: {
            seed: vm.xorshift_seed | 0,
            mode: vm.xorshift_seed === 0 ? 'unseeded' : 'seeded',
        },
        io: cloneJson(vm.io),
        readData: kind === 'halted' ? null : cloneJson(vm.read_data),
        windows: windowsPayload(vm),
        publishedOutput: {
            output: state.output,
            gridOutput: state.gridOutput,
        },
        // The trailing entry at a boundary is the pending request itself; the
        // restore path re-issues it, so it is omitted here and regenerated.
        requestLog: cloneJson(kind === 'halted' ? state.requestLog : state.requestLog.slice(0, -1)),
        vmFlags: {
            quit: !!vm.quit,
        },
        undo: {
            preserved: false,
            reason: 'in-memory undo history is dropped on restore, matching upstream ifvms autosave semantics',
        },
    };

    return {
        format: FORMAT,
        version: SCHEMA_VERSION,
        identity: {
            storySha256: context.storySha256,
            storySize: context.storySize,
            runtime: RUNTIME_NAME,
            runtimeRevision: REVISION,
            adapter: 'ifvms-adapter',
            schema: SCHEMA_VERSION,
        },
        boundary: kind === 'line'
            ? { kind, maxlen: tail.maxlen }
            : { kind },
        payload,
        integrity: {
            payloadSha256: sha256Hex(canonicalPayloadString(payload)),
            quetzalBytes: quetzal.length,
        },
        capabilities: capabilityStatement(),
    };
}

function windowsPayload(vm) {
    const win = (w) => (w ? { text: w.text, cursorX: w.cursorX, cursorY: w.cursorY, rock: w.rock } : null);
    return {
        main: win(vm.mainwin),
        upper: win(vm.upperwin),
        status: win(vm.statuswin),
    };
}

// The coverage declaration travels with the data: a restored instance cannot
// claim more than the format actually carries.  Keep this in lockstep with
// the inventory table in docs/evidence/g1-vm-recovery.md.
function capabilityStatement() {
    return {
        coverage: {
            dynamicMemory: 'serialized (Quetzal UMem)',
            pc: 'serialized (Quetzal IFhd/Stks)',
            callFramesAndStacks: 'serialized (Quetzal Stks, in-use region)',
            storyIdentity: 'serialized (Quetzal IFhd release/serial/checksum) + envelope story digest',
            interpreterHeaderFields: 'serialized (header block [0x00..0x40) written back verbatim after restore_file; update_header() recomputation is window-set-dependent and must not stand in for the source values)',
            rng: 'serialized (xorshift seed; mode derived: seed 0 = unseeded Math.random path)',
            ioStreamsAndFlags: 'serialized (plain-data clone)',
            pendingInput: 'serialized (read_data + re-issued Glk request)',
            windowTextAndCursor: 'serialized (main/upper/status window objects)',
            publishedTranscript: 'serialized (buffer + grid window text)',
            jittedCodeCache: 'reconstructed (rebuilt lazily per pc; never serialized)',
            stackViews: 'reconstructed (make_stacks rebuilds s/l from the stack buffer)',
            interpreterNumberVersionHeader: 'unsupported (vendored ZVM never writes them)',
            undoHistory: 'unsupported (dropped on restore, upstream autosave semantics)',
            timedInput: 'unsupported (read_data.time stored by upstream but never used; Flags1 timed-input bit clear)',
            sound: 'unsupported (upstream no-op opcodes)',
            graphics: 'unsupported (no picture opcode support in vendored ZVM)',
            glkFileStreams: 'unsupported (glksim records them as unexpected)',
        },
        unsupported: ['timed-input', 'sound', 'graphics', 'glk-file-streams', 'undo-history', 'interpreter-number-version'],
        schemaVersion: SCHEMA_VERSION,
    };
}

// Restore into a FRESH interpreter built from the pinned story bytes.  The
// envelope is fully validated first; any rejection happens before a ZVM is
// constructed, so an invalid checkpoint cannot disturb an active baseline.
// Returns the restored adapter (same interface as createIfvmsAdapter).
function restoreCheckpoint(envelope, storyBytes, expected) {
    validateEnvelope(envelope, expected);

    // The vendored ZVM mutates the story buffer in place: ZVM.prepare wraps
    // the given bytes in the live MemoryView (this.m) and every dynamic-memory
    // write lands in that buffer.  Each interpreter therefore gets its OWN
    // copy -- passing a shared Buffer would leak one instance's game state
    // into the next (observed: a second in-process start saw the first run's
    // taken key and turn counter).  Copies are cheap at fixture size.
    const storyCopy = Buffer.from(storyBytes);
    const adapter = createIfvmsAdapter(storyCopy);
    const { state, vm, Glk, settle } = adapter.__g1bInternals();

    // Normal startup: identify, restart, run to the FIRST input boundary.  The
    // fresh run's transcript/request state is transient and fully replaced
    // below; it also guarantees restore_file finds windows, origram and a
    // pristine stack, exactly like upstream's autorestore path.
    adapter.start();

    // Core VM state: memory, stacks, frames, pc.  A Quetzal IFhd mismatch
    // (wrong story bytes) returns 0 -> explicit rejection.
    const quetzalBuf = Buffer.from(envelope.payload.quetzalB64, 'base64');
    const ab = quetzalBuf.buffer.slice(quetzalBuf.byteOffset, quetzalBuf.byteOffset + quetzalBuf.byteLength);
    const rc = vm.restore_file(ab, 1);
    if (rc === 0) {
        throw new CheckpointError('E_STORY_QUETZAL', 'quetzal IFhd does not match the loaded story (wrong story bytes)');
    }

    // Interpreter-owned header fields: restore the source's block verbatim
    // (see captureCheckpoint for why update_header()'s recomputation is not
    // accepted).  restore_file has already applied the UMem image, so this
    // only repairs the fields its update_header() call rewrote.
    const headerBlock = Buffer.from(envelope.payload.headerBlockB64, 'base64');
    if (headerBlock.length !== 0x40) {
        throw new CheckpointError('E_STRUCTURE', 'header block must be exactly 0x40 bytes');
    }
    vm.ram.setUint8Array(0, headerBlock);

    // Transient fresh-run leftovers that must not leak into the restored game.
    vm.undo = [];
    vm.undo_len = 0;

    // I/O state (plain data: selectors, streams, transcript, upper-window
    // bookkeeping).  Applied after restore_file so its header update cannot
    // overwrite restored flags.
    vm.io = cloneJson(envelope.payload.io);

    // RNG: re-applied AFTER restore_file because update_header() zeroes the
    // seed (upstream do_autorestore re-applies the seed for the same reason).
    vm.xorshift_seed = envelope.payload.rng.seed | 0;

    // Halt state: the fresh instance sits at its own first prompt; a restored
    // halted checkpoint must refuse further input through the SAME shared
    // halt predicate the adapter uses for send() (state.halted || vm.quit).
    if (envelope.boundary.kind === 'halted') {
        vm.quit = true;
        state.halted = true;
        state.requestLog = cloneJson(envelope.payload.requestLog);
    } else {
        // Request log first (without the pending entry), then re-issue the
        // pending request so the shim records it again -- the final log is
        // byte-identical to the source's.
        state.requestLog = cloneJson(envelope.payload.requestLog);
        const rd = cloneJson(envelope.payload.readData);
        vm.read_data = rd;
        const win = vm.io.currentwin ? vm.upperwin : vm.mainwin;
        if (envelope.boundary.kind === 'line') {
            Glk.glk_request_line_event_uni(win, rd.buffer, envelope.boundary.maxlen);
        } else {
            Glk.glk_request_char_event_uni(win);
        }
    }

    // Window text/cursor + published transcript: overwrite whatever the fresh
    // startup printed so nothing is republished and nothing is lost.  The
    // shim's per-window buffers are the same objects the VM holds
    // (vm.mainwin/upperwin/statuswin), so writing here repairs both views.
    applyWindows(vm, envelope.payload.windows);
    state.output = envelope.payload.publishedOutput.output;
    state.gridOutput = envelope.payload.publishedOutput.gridOutput;
    // Sync the adapter's output-delta watermark to the restored transcript so
    // the first post-restore delta contains only NEW output (never a replay of
    // the published prefix).
    settle();

    return adapter;
}

function applyWindows(vm, windows) {
    const apply = (w, saved) => {
        if (!w || !saved) return;
        w.text = saved.text;
        w.cursorX = saved.cursorX;
        w.cursorY = saved.cursorY;
    };
    apply(vm.mainwin, windows.main);
    apply(vm.upperwin, windows.upper);
    apply(vm.statuswin, windows.status);
}

module.exports = { captureCheckpoint, restoreCheckpoint, capabilityStatement };
