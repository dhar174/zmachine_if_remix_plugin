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
//   waiting_for_character_input  -- protocol correlation: a character-input
//                                   menu marker was seen and no key delivered
//   halted                       -- process exited cleanly
//   error                        -- nonzero exit, stderr output, or watchdog
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

function probeBocfelAvailable() {
    // A cheap launch test: --version must exit 0 and mention Bocfel.
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

    // Read stdout until one of: a fresh ">" prompt appears after `mark`,
    // the process exits, or the watchdog fires.  Resolves with whether the
    // turn reached a terminal condition (prompt/exit) rather than timing out.
    function waitForTurnEnd(mark, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || DEFAULT_STEP_TIMEOUT_MS);
        return new Promise((resolve) => {
            const poll = setInterval(() => {
                if (exited) { clearInterval(poll); return resolve(true); }
                // A new prompt: the '>' the library prints before reading a
                // line.  Require buffer growth past `mark` so the prompt of
                // the PREVIOUS turn is not mistaken for the next one, and
                // require it to be the (escape-stripped) buffer tail.
                if (stdoutBuf.length > mark && endsWithPrompt(stdoutBuf)) {
                    clearInterval(poll);
                    return resolve(true);
                }
                if (Date.now() > deadline) { clearInterval(poll); return resolve(false); }
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
            await waitForTurnEnd(0, DEFAULT_STEP_TIMEOUT_MS);
            if (!exited && !stdoutBuf.endsWith(PROMPT)) {
                // The first prompt may not have flushed a trailing '>' yet
                errorText = errorText || 'startup did not reach a line prompt';
            }
            return settle();
        },

        // Same input model as the ifvms adapter.  On the wire both kinds are
        // one newline-terminated line; the kind is recorded for the evidence
        // trail and the boundary classification comes from protocol
        // correlation with the fixture's markers.
        async send(input) {
            if (exited) return settle();
            const mark = stdoutBuf.length;
            if (input.kind === 'char') {
                menuPending = false;
                child.stdin.write(String(input.key) + '\n');
            } else if (input.kind === 'line') {
                child.stdin.write(String(input.text) + '\n');
                // Protocol correlation: if the output produced by this input
                // opens the fixture's character menu, the NEXT boundary is a
                // character prompt even though the wire format is identical.
                menuPending = /\[F07:menu-open\]/.test(stdoutBuf.slice(mark));
            } else {
                errorText = 'unsupported input kind: ' + input.kind;
                return settle();
            }
            await waitForTurnEnd(mark, DEFAULT_STEP_TIMEOUT_MS);
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
