'use strict';
// ==============================================================================
// fingerprint.js -- machine-state fingerprints for checkpoint round trips
// (G1-B probe, Issue #12).  A fingerprint is the "meaningful machine state"
// half of the comparison rule: continuation comparisons use full output/event
// equality AND fingerprint equality, not fixture markers alone.
// ------------------------------------------------------------------------------
// Hashed regions:
//   ram      -- dynamic memory [0, staticmem) at the boundary
//   stack    -- the IN-USE call-stack region [0, frameptr + 8 + locals*2 + sp*2)
//   globals  -- the Z-machine globals table (240 words = 480 bytes)
// Nothing derived is compared from cached/serialized bytes: every field is
// read live from the restored interpreter.
// ==============================================================================

const { sha256Hex, cloneJson } = require('./checkpoint-format.js');

function machineFingerprint(adapter) {
    const { state, vm } = adapter.__g1bInternals();
    const m = vm.m;
    return {
        pc: vm.pc,
        frameptr: vm.frameptr,
        frameCount: vm.frames.length,
        sp: vm.sp,
        rngSeed: vm.xorshift_seed | 0,
        quit: !!vm.quit,
        halted: !!state.halted,
        undoDepth: vm.undo.length,
        ramSha256: sha256Hex(Buffer.from(m.getUint8Array(0, vm.staticmem))),
        stackSha256: stackFingerprint(vm),
        globalsSha256: sha256Hex(Buffer.from(m.getUint8Array(vm.globals, 480))),
        output: state.output,
        gridOutput: state.gridOutput,
        requestLog: cloneJson(state.requestLog),
        errors: state.errors.slice(),
    };
}

// Hash the live call-chain: every frame's header + locals + eval stack, up to
// the next frame (frames are contiguous) or, for the current frame, sp words.
// NOTE: MemoryView.getUint8Array(start, LENGTH) takes a LENGTH, not an end
// offset (vendored utils.js) -- every window below passes an explicit length.
//
// The CURRENT frame's in-buffer sp slot (bytes frameptr+6..+8) is EXCLUDED:
// the authoritative sp lives in vm.sp and ifvms only syncs that slot on
// save/call, so a live interpreter carries a stale value there where a
// checkpoint carries the synced one (observed: one stale byte at halt).  The
// slot is dead storage, not state.  Caller frames' slots are KEPT in the
// hash: restore_file's frame walk reads them to find each region's end, so
// they are meaningful checkpoint-relevant state.
function stackFingerprint(vm) {
    const chain = [...vm.frames, vm.frameptr];
    const parts = [];
    for (let idx = 0; idx < chain.length; idx++) {
        const f = chain[idx];
        const isCurrent = idx === chain.length - 1;
        const localsLen = (vm.stack.getUint8(f + 3) & 0x0F) * 2;
        if (isCurrent) {
            const spEnd = f + 8 + localsLen + vm.sp * 2;
            // Header without the stale sp slot, then locals + eval stack.
            parts.push(Buffer.from(vm.stack.getUint8Array(f, 6)));
            parts.push(Buffer.from(vm.stack.getUint8Array(f + 8, spEnd - (f + 8))));
        } else {
            // Full header + locals + eval stack up to the next frame.
            parts.push(Buffer.from(vm.stack.getUint8Array(f, chain[idx + 1] - f)));
        }
    }
    return sha256Hex(Buffer.concat(parts));
}

// Fields that may legitimately differ between a reference run and a restored
// run.  Everything else must match exactly.
//   undoDepth      -- undo history is a DECLARED-unsupported checkpoint family
//                     (dropped on restore, upstream autosave semantics), so the
//                     depth legitimately differs after restore and stays
//                     offset by the dropped entries; @restore_undo behavior
//                     after restore is asserted separately in the tests.
// (rngSeed no longer appears: unseeded checkpoints are rejected outright, so
// every compared pair of runs is seeded and the seed must match exactly.)
//
// DOCUMENTATION-ONLY MAP: fingerprintDiff() below enforces the undoDepth rule
// directly, and the round-trip tests enforce the rest via exact equality.  This
// map records the intended contract for readers; if it drifts from the
// enforcement sites, the enforcement sites win.
const CONDITIONAL_FIELDS = {
    undoDepth: 'declared-unsupported',
};

function fingerprintDiff(a, b) {
    const diffs = [];
    for (const key of Object.keys(a)) {
        const av = a[key];
        const bv = b[key];
        if (key === 'requestLog' || key === 'errors') {
            if (JSON.stringify(av) !== JSON.stringify(bv)) diffs.push(key);
        } else if (key === 'undoDepth') {
            // Only depth differs (restored has strictly fewer entries);
            // if the restored side somehow has MORE undo entries, that is a
            // real leak and must be reported.
            if (bv > av) diffs.push(key);
        } else if (av !== bv) {
            diffs.push(key);
        }
    }
    return diffs;
}

// RNG-draw markers are normalized when comparing unseeded continuations:
// per-process Math.random draws must NOT match across processes (they are
// host entropy), while everything around them must.
function normalizeRngDraws(text) {
    return text.replace(/\[F08:roll=\d+\]/g, '[F08:roll=*]');
}

module.exports = { machineFingerprint, fingerprintDiff, CONDITIONAL_FIELDS, normalizeRngDraws };
