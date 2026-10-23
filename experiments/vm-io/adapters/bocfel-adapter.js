'use strict';
// ==============================================================================
// bocfel-adapter.js -- drives the Bocfel non-Glk interpreter as a child
// process over stdin/stdout, behind the same minimal experimental adapter
// interface as ifvms-adapter.js.
// ------------------------------------------------------------------------------
// Probe code, not a production adapter.
//
// Bocfel's scripted-I/O surface is the NON-GLK build (plain stdio, no Glk):
//   - output goes to stdout, flushed before every input read, so a strict
//     request/response protocol is safe;
//   - LINE input and CHARACTER input are NOT distinguishable on the wire:
//     both consume one newline-terminated stdin line per VM input request
//     (for read_char only the first character of the line is used).  The
//     boundary is therefore established by FIXTURE-DRIVEN PROTOCOL
//     CORRELATION (the [F07:menu-open] marker), not by the byte stream.
//     This is itself a recorded comparison finding vs ifvms.js, which
//     distinguishes the boundaries at the API level.
//   - input is never echoed back to stdout under a pipe.
//
// Conceptual probe states mapped to tested signals:
//   waiting_for_line_input       -- stdout ends with the library's ">" prompt
//                                   (a prompt-text heuristic after ANSI
//                                   stripping: output that coincidentally
//                                   ended in ">" would misclassify; not
//                                   observed with this fixture)
//   waiting_for_character_input  -- protocol correlation: the fixture's
//                                   character-input menu marker was seen and
//                                   no key delivered
//   halted                       -- process exited cleanly (exit code 0)
//   error                        -- spawn failure, nonzero exit, or watchdog
//                                   timeout: a timed-out turn is classified as
//                                   an error and the child process is
//                                   terminated (see terminateChild), so the
//                                   stale pre-turn prompt can never be
//                                   mistaken for a fresh input boundary
//   running                      -- not observable between steps; each send()
//                                   runs to the next prompt or exit
//
// Platform: Bocfel 2.6 has no official prebuilt Windows binary.  Default
// launch assumes the non-Glk binary was built once in WSL2 (Ubuntu) and
// installed at ~/.local/bin/bocfel (see experiments/vm-io/README.md).
// Evidence produced through WSL2 is labeled WSL2-only.  A native Windows
// build (MSYS2 MinGW, `make PLATFORM=win32`) placed at
// experiments/vm-io/tools/bocfel/bocfel.exe is preferred automatically when
// present.  Override everything with BOCFEL_COMMAND (argv, space-separated,
// containing @STORY@ where the story path belongs).
// ==============================================================================

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVISION = '2.6 (tarball sha1 319770fc5c50c4824d1b6edea1e9ce2ba0d196da)';

function windowsToWslPath(p) {
    const resolved = path.resolve(p);
    const m = resolved.match(/^([A-Za-z]):[\\/](.*)$/);
    if (!m) return resolved;
    return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

function resolveBocfelLaunch(storyPath) {
    const override = process.env.BOCFEL_COMMAND;
    if (override) {
        const parts = override.split(' ').filter(Boolean);
        return { command: parts.map((a) => a.replace('@STORY@', windowsToWslPath(storyPath))), platform: 'BOCFEL_COMMAND override' };
    }
    const nativeExe = path.join(__dirname, '..', 'tools', 'bocfel', 'bocfel.exe');
    if (fs.existsSync(nativeExe)) {
        return { command: [nativeExe, '-C', '-m', path.resolve(storyPath)], platform: 'Windows native (MSYS2 MinGW build)' };
    }
    // WSL2 default: binary installed at ~/.local/bin/bocfel inside the default
    // distro; the story path is translated to /mnt/<drive>/... form.  TERM is
    // pinned INSIDE the WSL environment (Windows env vars do not cross the
    // wsl.exe boundary) so the terminfo layer emits no escape sequences.
    const wslStory = windowsToWslPath(storyPath);
    const script = 'exec env TERM=dumb "$HOME/.local/bin/bocfel" -C -m "$1"';
    return {
        command: ['wsl.exe', '-e', 'sh', '-c', script, 'sh', wslStory],
        platform: 'WSL2 default distro via wsl.exe, TERM=dumb (story at ' + wslStory + ')',
    };
}

// Availability is aligned with the launch configuration that would actually
// be selected, instead of only ever testing wsl.exe:
//   - BOCFEL_COMMAND set: the operator explicitly configured the interpreter
//     (a local configuration knob with the same trust model as EDITOR; it is
//     never fed story content, network input, or argv data), so it is treated
//     as present.  Deliberately NOT executed here; the real launch surfaces
//     any misconfiguration as a recorded adapter error state.
//   - native Windows build present at the documented tools path: treated as
//     present, for the same reason.
//   - default: the WSL2 invocation must exit 0 and mention Bocfel.
function probeBocfelAvailable() {
    if (process.env.BOCFEL_COMMAND) return true;
    if (fs.existsSync(path.join(__dirname, '..', 'tools', 'bocfel', 'bocfel.exe'))) return true;
    try {
        const r = spawnSync('wsl.exe', ['-e', 'sh', '-c', 'exec "$HOME/.local/bin/bocfel" -v'], { encoding: 'utf8', timeout: 30000 });
        return r.status === 0 && /Bocfel/.test(r.stdout || '');
    } catch {
        return false;
    }
}

const PROMPT = '>';
const DEFAULT_STEP_TIMEOUT_MS = 10000;
// ANSI escape sequences (CSI, charset selection, OSC) that terminfo-based
// output may interleave into stdout; stripped only for prompt detection,
// never from the recorded evidence.  A fresh RegExp per call avoids the
// stateful lastIndex behavior of global regexes.
function stripAnsi(buf) {
    return buf.replace(/\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[()][0-9A-B]|[=>])/g, '');
}

function endsWithPrompt(buf) {
    return stripAnsi(buf).endsWith(PROMPT);
}

function createBocfelAdapter(storyPath, options) {
    options = options || {};
    let launch = options.launch;
    const stepTimeoutMs = options.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS;
    if (!launch) {
        if (!probeBocfelAvailable()) {
            throw new Error(
                'bocfel binary not resolvable: build the non-Glk interpreter once and install it at ~/.local/bin/bocfel in the default WSL distro (or set BOCFEL_COMMAND), see experiments/vm-io/README.md'
            );
        }
        launch = resolveBocfelLaunch(storyPath);
    }

    let child = null;
    let platform = launch.platform;
    let stdoutBuf = '';
    let stderrBuf = '';
    let exited = false;
    let exitCode = null;
    let errorText = null;
    let lastOutputLen = 0;
    let started = false;
    let menuPending = false; // protocol correlation state

    function startChild() {
        child = spawn(launch.command[0], launch.command.slice(1), {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, TERM: 'dumb' },
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => {
            stdoutBuf += d;
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (d) => {
            stderrBuf += d;
        });
        child.on('exit', (code) => {
            exited = true;
            exitCode = code;
        });
        child.on('error', (e) => {
            errorText = String(e.message || e);
            exited = true;
        });
    }

    // Terminate the interpreter child.  kill() is a plain process terminate
    // (no shell involved).  On the WSL2 path this terminates wsl.exe itself;
    // a Linux-side bocfel grandchild may linger until the WSL session is torn
    // down, which is recorded as a platform limitation rather than handled.
    function terminateChild() {
        if (!child || exited) return;
        try { child.kill(); } catch { /* already gone */ }
        const escalate = setTimeout(() => {
            if (!exited) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
        }, 2000);
        if (typeof escalate.unref === 'function') escalate.unref();
        child.once('exit', () => clearTimeout(escalate));
    }

    // Read stdout until one of: a fresh ">" prompt appears after `mark`, the
    // fixture's character-menu marker appears with no prompt after it (the
    // protocol-correlated character boundary), the process exits, or the
    // watchdog fires.  Resolves with whether the turn reached a terminal
    // condition (prompt/menu/exit) rather than timing out; on timeout the
    // run is classified as an error and the child is terminated, so the
    // caller can never mistake the stale pre-turn prompt for a fresh
    // boundary.
    function waitForTurnEnd(mark, timeoutMs) {
        const limit = timeoutMs || stepTimeoutMs;
        const deadline = Date.now() + limit;
        return new Promise((resolve) => {
            const poll = setInterval(() => {
                if (exited) { clearInterval(poll); return resolve(true); }
                const since = stdoutBuf.slice(mark);
                const menuIdx = since.indexOf('[F07:menu-open]');
                if (menuIdx >= 0 && !since.slice(menuIdx).includes('>')) {
                    menuPending = true;
                    clearInterval(poll);
                    return resolve(true);
                }
                // A new prompt: the '>' the library prints before reading a
                // line.  Require buffer growth past `mark` so the prompt of
                // the PREVIOUS turn is not mistaken for the next one, and
                // require it to be the (escape-stripped) buffer tail.
                if (stdoutBuf.length > mark && endsWithPrompt(stdoutBuf)) {
                    clearInterval(poll);
                    return resolve(true);
                }
                if (Date.now() > deadline) {
                    clearInterval(poll);
                    errorText = errorText || ('watchdog: no line-input boundary, character-input marker, or exit within ' + limit + 'ms; child terminated');
                    terminateChild();
                    return resolve(false);
                }
            }, 150);
        });
    }

    function classify() {
        if (errorText) return 'error';
        if (exited) return exitCode === 0 ? 'halted' : 'error';
        if (menuPending) return 'waiting_for_character_input';
        if (endsWithPrompt(stdoutBuf)) return 'waiting_for_line_input';
        return 'running';
    }

    function settle() {
        const output = stdoutBuf;
        const delta = output.slice(lastOutputLen);
        lastOutputLen = output.length;
        return {
            status: classify(),
            delta,
            output,
            exited,
            exitCode,
            stderr: stderrBuf,
            error: errorText,
        };
    }

    return {
        describe() {
            return {
                runtime: 'Bocfel (non-Glk build)',
                revision: REVISION,
                mode: 'child process over stdin/stdout (' + platform + ')',
                license: 'MIT (upstream LICENSE; binary not redistributed)',
            };
        },

        async start() {
            if (started) throw new Error('adapter already started');
            started = true;
            startChild();
            const ready = await waitForTurnEnd(0, stepTimeoutMs);
            if (!ready) {
                // Watchdog already classified the run as an error and
                // terminated the child; settle() reports it.
                return settle();
            }
            if (!exited && !endsWithPrompt(stdoutBuf)) {
                // The first prompt may not have flushed a trailing '>' yet
                errorText = errorText || 'startup did not reach a line prompt';
            }
            return settle();
        },

        // Same input model as the ifvms adapter.  On the wire both kinds are
        // one newline-terminated line; the kind is recorded for the evidence
        // trail and the boundary classification comes from protocol
        // correlation with the fixture's markers (see waitForTurnEnd).
        async send(input) {
            if (exited) return settle();
            const mark = stdoutBuf.length;
            if (input.kind === 'char') {
                menuPending = false;
                child.stdin.write(String(input.key) + '\n');
            } else if (input.kind === 'line') {
                child.stdin.write(String(input.text) + '\n');
            } else {
                errorText = 'unsupported input kind: ' + input.kind;
                return settle();
            }
            // A false return means the watchdog fired: waitForTurnEnd has
            // already recorded the error and terminated the child, so the
            // settle() below reports 'error' -- it can never mistake the
            // stale pre-turn prompt for a fresh boundary.
            await waitForTurnEnd(mark, stepTimeoutMs);
            return settle();
        },

        inspect() {
            // The child-process model exposes no VM internals; bocfel's
            // inspection surface (/debug meta commands) is disabled by -m.
            return { note: 'child-process adapter: no internal state inspection' };
        },

        async shutdown() {
            if (child && !exited) {
                try { child.stdin.end(); } catch { /* already closed */ }
                const deadline = Date.now() + 5000;
                while (!exited && Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 100));
                }
                if (!exited) child.kill();
            }
            return settle();
        },
    };
}

module.exports = { createBocfelAdapter, resolveBocfelLaunch, probeBocfelAvailable, REVISION, windowsToWslPath };
