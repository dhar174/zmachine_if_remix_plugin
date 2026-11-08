"""Bounded POSIX reference experiment, not a production VM adapter/store."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import struct
import subprocess
import time

STDOUT_CAP = 32 * 1024 * 1024
STDERR_CAP = 64 * 1024
SAVE_CAP = 32 * 1024 * 1024
BOUNDARY_SECONDS = 30
TERMINATION_SECONDS = 10
TRIAL_SECONDS = 120
MARKERS = re.compile(rb"\[(?:F\d\d|DIAG|MARKERS|LOC|CTRL):[^\]]*\]")
CHAR_ERROR = b"[Save file error: invalid Args size for 1: 0]"
CONTINUING = b"Continuing last session from autosave"
LIVE_CHILDREN = set()


class Failure(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Failure(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_bytes(file, data):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
    require(file.is_file() and file.read_bytes() == data, "artifact readback: " + str(file))


def write_json(file, value):
    write_bytes(file, (json.dumps(value, indent=2, sort_keys=True) + "\n").encode())


def read_bounded(file, cap=SAVE_CAP):
    with Path(file).open("rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode), "not a regular file")
        require(info.st_size <= cap, "file size limit")
        data = stream.read(cap + 1)
        require(len(data) <= cap, "growing file size limit")
        return data


def chunks(data):
    require(len(data) <= SAVE_CAP, "save size limit")
    require(len(data) >= 12 and data[:4] == b"FORM" and data[8:12] == b"BFZS", "not FORM BFZS")
    require(int.from_bytes(data[4:8], "big") + 8 == len(data), "FORM length mismatch")
    result, at = {}, 12
    while at < len(data):
        require(at + 8 <= len(data), "truncated chunk header")
        tag, size = data[at:at + 4], int.from_bytes(data[at + 4:at + 8], "big")
        end = at + 8 + size
        require(end + (size & 1) <= len(data), "chunk exceeds FORM")
        require(tag not in result, "duplicate chunk")
        result[tag] = data[at + 8:end]
        at = end + (size & 1)
    require(b"IFhd" in result and len(result[b"IFhd"]) == 13, "missing/invalid IFhd")
    require(b"Args" in result and len(result[b"Args"]) >= 1, "missing/invalid Args")
    require((len(result[b"Args"]) - 1) % 2 == 0, "odd Args operand bytes")
    require(b"Stks" in result, "missing Stks")
    stack, frame = result[b"Stks"], 0
    require(len(stack) >= 8, "missing Stks dummy frame")
    while frame < len(stack):
        require(frame + 8 <= len(stack), "truncated Stks frame")
        flags = stack[frame + 3]
        require(flags & 0xE0 == 0, "reserved Stks frame flags")
        words = (flags & 15) + int.from_bytes(stack[frame + 6:frame + 8], "big")
        frame += 8 + 2 * words
        require(frame <= len(stack), "Stks frame exceeds chunk")
    require((b"CMem" in result) != (b"UMem" in result), "one memory chunk required")
    return result


def inspect_save(data, story):
    values = chunks(data)
    header = values[b"IFhd"]
    require(header[:2] == story[2:4] and header[2:8] == story[0x12:0x18]
            and header[8:10] == story[28:30], "wrong story IFhd")
    static_base = int.from_bytes(story[14:16], "big")
    require(0x40 <= static_base <= len(story), "story dynamic-memory bounds")
    if b"UMem" in values:
        memory = values[b"UMem"]
        require(len(memory) == static_base, "UMem length")
    else:
        encoded, xor, at = values[b"CMem"], bytearray(), 0
        while at < len(encoded):
            byte = encoded[at]; at += 1
            if byte:
                xor.append(byte)
            else:
                require(at < len(encoded), "truncated CMem run")
                xor.extend(bytes(encoded[at] + 1)); at += 1
            require(len(xor) <= static_base, "CMem expansion exceeds dynamic memory")
        xor.extend(bytes(static_base - len(xor)))
        memory = bytes(a ^ b for a, b in zip(story[:static_base], xor))
    args = values[b"Args"]
    rand = values.get(b"Rand")
    if rand is not None:
        require(len(rand) == 6 and rand[:2] == b"\0\0" and int.from_bytes(rand[2:], "big") != 0,
                "invalid predictable Rand")
    return {"sha256": sha(data), "bytes": len(data), "pc": int.from_bytes(header[10:13], "big"),
            "args_hex": args.hex(), "save_opcode": args[0],
            "operands": [int.from_bytes(args[i:i + 2], "big") for i in range(1, len(args), 2)],
            "rand_hex": rand.hex() if rand is not None else None,
            "memory_sha256": sha(memory),
            "chunks": {tag.hex(): {"bytes": len(value), "sha256": sha(value)} for tag, value in values.items()}}


def marker_list(data):
    return [match.decode("ascii") for match in MARKERS.findall(data)]


def suffix_from_events(data, events, halted=False):
    cuts = [event["stdout_offset"] for event in events if event["event"] == "suffix-cut"]
    ends = [event["stdout_offset"] for event in events if event["event"] == "suffix-end"]
    require(len(cuts) == 1 and len(ends) == (0 if halted else 1), "suffix event inventory")
    end = len(data) if halted else ends[0]
    require(0 <= cuts[0] < end <= len(data), "suffix event bounds")
    return data[cuts[0]:end]


def check_diagnostics(data, allowed=None):
    # No cleanup/normalization of raw output. Match the native diagnostic
    # framing; ordinary story words such as 'error' are not diagnostics.
    remaining = data
    if allowed is not None:
        require(data.count(allowed) == 1, "expected native diagnostic exactly once")
        remaining = data.replace(allowed, b"", 1)
    require(not re.search(rb"\[(?:Save file error|Fatal error)|(?:^|\n)(?:warning:|error:|Traceback)",
                          remaining, re.I), "unexpected diagnostic")


def environment(home, autosave=None):
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    env = {"PATH": os.defpath, "HOME": str(home), "XDG_DATA_HOME": str(home / "data"),
           "XDG_CONFIG_HOME": str(home / "config"), "TERM": "dumb", "LANG": "C.UTF-8",
           "LC_ALL": "C.UTF-8", "TZ": "UTC"}
    if autosave is not None:
        Path(autosave).mkdir(parents=True, exist_ok=True)
        env.update(BOCFEL_AUTOSAVE="1", BOCFEL_AUTOSAVE_DIRECTORY=str(autosave),
                   BOCFEL_SKIP_AUTORESTORE="0", BOCFEL_AUTOSAVE_LIBRARYSTATE="0",
                   BOCFEL_PERSISTENT_TRANSCRIPT="0")
    return env


class Child:
    """One owned POSIX process/session; exit and stdout/stderr EOF are separate."""
    def __init__(self, argv, cwd, env, artifacts, deadline=None,
                 stdout_cap=STDOUT_CAP, stderr_cap=STDERR_CAP):
        require(os.name == "posix", "native reference requires POSIX; use Linux/WSL")
        self.argv, self.cwd, self.env = argv, str(cwd), env
        self.artifacts = Path(artifacts)
        self.deadline = deadline or time.monotonic() + TRIAL_SECONDS
        self.caps = {"stdout": stdout_cap, "stderr": stderr_cap}
        self.data = {"stdout": bytearray(), "stderr": bytearray()}
        self.counts = {"stdout": 0, "stderr": 0}
        self.eof, self.events = set(), []
        self.exit_observed, self.closed, self.killed = False, False, False
        self.started = time.monotonic()
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, cwd=cwd, env=env, start_new_session=True)
        LIVE_CHILDREN.add(self)
        self.selector = selectors.DefaultSelector()
        for name in self.data:
            stream = getattr(self.process, name)
            os.set_blocking(stream.fileno(), False)
            self.selector.register(stream, selectors.EVENT_READ, name)
        self.event("spawn", pid=self.process.pid, argv=argv)

    def event(self, name, **values):
        self.events.append({"event": name, "seconds": time.monotonic() - self.started,
                            "stdout_offset": len(self.data["stdout"]),
                            "stderr_offset": len(self.data["stderr"]), **values})

    def pump(self, timeout=0.05, discard=False):
        for key, _ in self.selector.select(timeout):
            block = os.read(key.fileobj.fileno(), 65536)
            name = key.data
            if not block:
                self.selector.unregister(key.fileobj)
                self.eof.add(name)
                self.event("pipe-eof", pipe=name)
            else:
                self.counts[name] += len(block)
                room = max(0, self.caps[name] - len(self.data[name]))
                self.data[name].extend(block[:room])
                if not discard:
                    require(self.counts[name] <= self.caps[name], name + " output limit")
        if self.process.poll() is not None and not self.exit_observed:
            self.exit_observed = True
            self.event("exit", returncode=self.process.returncode)

    def until(self, predicate, seconds=BOUNDARY_SECONDS):
        end = min(self.deadline, time.monotonic() + seconds)
        while True:
            self.pump()
            if predicate():
                return
            require(self.process.returncode is None, "premature exit before boundary: " + str(self.process.returncode))
            require(time.monotonic() < end, "boundary deadline")

    def send(self, data):
        require(len(data) <= 256 and self.process.poll() is None, "input delivery state/size")
        self.event("input", hex=data.hex())
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def reap(self, kill=False, discard=False):
        if kill and self.process.poll() is None:
            self.killed = True
            self.event("kill-request", signal="SIGKILL")
            os.killpg(self.process.pid, signal.SIGKILL)
        self.process.stdin.close()
        end = time.monotonic() + TERMINATION_SECONDS
        while not (self.exit_observed and self.eof == {"stdout", "stderr"}):
            self.pump(discard=discard)
            require(time.monotonic() < end, "termination/pipe-close deadline")
        self.process.wait(timeout=0)
        self.event("reaped", returncode=self.process.returncode, pipes=sorted(self.eof))
        self.closed = True
        LIVE_CHILDREN.discard(self)

    def finish(self):
        self.reap()
        require(self.process.returncode == 0, "nonzero native exit: " + str(self.process.returncode))

    def __enter__(self):
        return self

    def __exit__(self, kind, error, traceback):
        try:
            if not self.closed:
                self.reap(kill=True, discard=error is not None)
        finally:
            if self.closed:
                self.selector.close()
                self.process.stdout.close(); self.process.stderr.close()
            write_bytes(self.artifacts.with_suffix(".stdout"), bytes(self.data["stdout"]))
            write_bytes(self.artifacts.with_suffix(".stderr"), bytes(self.data["stderr"]))
            write_json(self.artifacts.with_suffix(".events.json"), {
                "argv": self.argv, "cwd": self.cwd, "environment": self.env,
                "pid": self.process.pid, "returncode": self.process.returncode,
                "killed_by_harness": self.killed, "exit_observed": self.exit_observed,
                "pipes_closed": sorted(self.eof), "counts": self.counts, "events": self.events})


def current_save(directory, story):
    candidates = [p for p in Path(directory).rglob("*") if p.is_file() and not p.name.endswith(".bak")]
    require(len(candidates) == 1, "expected exactly one active autosave")
    data = read_bounded(candidates[0])
    return candidates[0], data, inspect_save(data, story)


def boundary(child, directory, story, expected, previous=None, opcode=0, old_generation=None):
    result = []
    start = child.events[-1]["stdout_offset"] if child.events[-1]["event"] == "input" else 0
    def ready():
        if child.process.returncode is not None:
            return False
        output = bytes(child.data["stdout"])[start:]
        if not expected(output):
            return False
        try:
            saved = current_save(directory, story)
        except (Failure, OSError):
            return False  # writer may still be filling FORM; deadline is not readiness
        if saved[2]["save_opcode"] != opcode or saved[2]["sha256"] == previous:
            return False
        info = saved[0].stat()
        if old_generation == (info.st_ino, info.st_mtime_ns, info.st_size):
            return False
        result[:] = saved
        return True
    child.until(ready)
    child.event("boundary", save_sha256=result[2]["sha256"], opcode=opcode)
    return tuple(result)


def canonical_quit(child):
    offset = len(child.data["stdout"])
    child.send(b"quit\n")
    child.until(lambda: b"Are you sure" in bytes(child.data["stdout"])[offset:])
    child.send(b"y\n")
    child.finish()


def core_equal(left, right):
    for key in ("pc", "args_hex", "rand_hex", "memory_sha256"):
        require(left[key] == right[key], "prefix control mismatch: " + key)
