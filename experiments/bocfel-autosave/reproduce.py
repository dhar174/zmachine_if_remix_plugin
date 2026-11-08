#!/usr/bin/env python3
"""Build and qualify one pinned Bocfel reference; explicit artifacts, no install."""
import argparse
import ctypes.util
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tarfile
import tempfile
import time

from matrix import CASES, CANONICAL_SHA, run_trial
from fixture import character_story
from reference import (Child, Failure, LIVE_CHILDREN, CHAR_ERROR, check_diagnostics,
                       environment, inspect_save, marker_list, read_bounded, require,
                       sha, suffix_from_events, write_json)

ARCHIVE_BYTES = 201707
ARCHIVE_SHA256 = "8541a1c59271f7977e81680e29d9be60d633311870f05bb579f317a6fb37c7b8"
ARCHIVE_SHA1 = "319770fc5c50c4824d1b6edea1e9ce2ba0d196da"
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def prerequisites():
    if os.name != "posix":
        return "native reference requires POSIX; run inside Linux/WSL"
    missing = [name for name in ("python3", "g++", "make") if shutil.which(name, path=os.defpath) is None]
    if not any(Path(name).is_file() for name in ("/usr/include/curses.h", "/usr/include/ncurses.h")):
        missing.append("curses development header (Ubuntu/WSL layout)")
    if ctypes.util.find_library("ncurses") is None:
        missing.append("ncurses link library")
    return "missing prerequisites: " + ", ".join(missing) if missing else None


def command(argv, cwd, env, artifacts, seconds=30):
    with Child(argv, cwd, env, artifacts, time.monotonic() + seconds) as child:
        child.until(lambda: child.process.poll() is not None, seconds)
        child.finish()
        return bytes(child.data["stdout"]).decode("utf-8", "strict")


def build(archive, work, output):
    data = read_bounded(archive)
    require(len(data) == ARCHIVE_BYTES and sha(data) == ARCHIVE_SHA256
            and hashlib.sha1(data).hexdigest() == ARCHIVE_SHA1, "source archive identity mismatch")
    sources = {}
    # Extract exactly the bytes that passed the pin, without reopening the path.
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as bundle:
        for member in bundle.getmembers():
            dest = (work / member.name).resolve()
            require(dest.is_relative_to(work.resolve()) and not member.issym() and not member.islnk(), "unsafe archive member")
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            require(member.isfile() and member.size <= 32 * 1024 * 1024, "unsupported archive member")
            blob = bundle.extractfile(member).read()
            require(len(blob) == member.size, "short archive member")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(blob)
            require(dest.read_bytes() == blob, "source extraction readback")
            sources[member.name] = sha(blob)
    source = work / "bocfel-2.6"
    require(not (source / "local.mk").exists(), "unexpected local.mk")
    env = environment(work / "build-home")
    compiler = command(["g++", "--version"], work, env, output / "compiler")
    make = command(["make", "--version"], work, env, output / "make-version")
    argv = ["make", "-j2", "CXX=g++", "PLATFORM=unix", "GLK=", "OPT=-O2", "CXXFLAGS=-g"]
    command(argv, source, env, output / "build", seconds=600)
    binary = source / "bocfel"
    version = command([str(binary), "-v"], source, env, output / "bocfel-version")
    require(version.startswith("Bocfel 2.6\n") and "Runtime assertions enabled" in version, "wrong runtime/version/safety build")
    for name, expected in sources.items():
        require(sha((work / name).read_bytes()) == expected, "upstream source bytes modified: " + name)
    identity = {"archive_sha256": ARCHIVE_SHA256, "archive_sha1": ARCHIVE_SHA1,
                "archive_bytes": ARCHIVE_BYTES, "upstream_source_hashes": sources,
                "build_argv": argv, "compiler": compiler, "make": make, "bocfel_version": version,
                "binary_sha256": sha(binary.read_bytes()), "system": platform.platform(),
                "machine": platform.machine(), "python": sys.version, "build_environment": env}
    write_json(output / "build-identity.json", identity)
    return binary, identity


def verify_inventory(root):
    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    expected = manifest["inventory"]
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.name != "manifest.json"}
    require(actual == set(expected), "artifact inventory differs")
    for name, identity in expected.items():
        file = (root / name).resolve()
        require(file.is_relative_to(root.resolve()) and not file.is_symlink(), "artifact path outside bundle")
        data = read_bounded(file)
        require(len(data) == identity["bytes"] and sha(data) == identity["sha256"], "artifact digest: " + name)
    return manifest


def frozen_expectations():
    return json.loads((HERE / "expectations.json").read_text(encoding="utf-8"))


def cleanup_scratch(scratch):
    scratch = Path(scratch)
    require(scratch.resolve() == scratch and scratch.parent == Path(tempfile.gettempdir()).resolve()
            and scratch.name.startswith("zirp-bocfel-reference-"), "unsafe scratch cleanup")
    require(not LIVE_CHILDREN, "owned child not observed reaped; scratch retained")
    shutil.rmtree(scratch)
    require(not scratch.exists(), "scratch cleanup failed")


def verify_bundle(root):
    root = Path(root)
    manifest = verify_inventory(root)
    require(manifest["status"] == "qualified" and manifest["failure"] is None and manifest["scratch_removed"],
            "not a complete qualified matrix")
    pairs = [(result["case"], result["repeat"]) for result in manifest["results"]]
    require(sorted(pairs) == sorted((kind, repeat) for kind in CASES for repeat in range(1, 4)), "matrix trial inventory")
    expected = frozen_expectations()
    identity = json.loads((root / "build-identity.json").read_text())
    require(identity["archive_sha256"] == ARCHIVE_SHA256 and identity["archive_bytes"] == ARCHIVE_BYTES,
            "bundle source identity")
    require(len(identity["binary_sha256"]) == 64 and identity["bocfel_version"].startswith("Bocfel 2.6\n"),
            "bundle executable identity")
    for result in manifest["results"]:
        kind, repeat = result["case"], result["repeat"]
        folder = root / (kind + "-" + str(repeat))
        require(json.loads((folder / "result.json").read_text()) == result, "result sidecar mismatch")
        require(result["observed"] == expected[kind], "bundle frozen observation mismatch")
        story = character_story() if kind == "valid-char" else read_bounded(REPO / "tests/fixtures/zmachine/fixture.z5")
        for name, key in [("control-prefix", "control_prefix"), ("candidate-prefix", "candidate_prefix"),
                          ("restored-boundary", "restored_boundary")]:
            require(inspect_save(read_bounded(folder / (name + ".bfzs")), story) == result[key],
                    "autosave summary mismatch")
        for name, code in [("control", 0), ("candidate", -9), ("restored", 0)]:
            events = json.loads((folder / (name + ".events.json")).read_text())
            require(events["returncode"] == code and events["exit_observed"] and events["pipes_closed"] == ["stderr", "stdout"],
                    "missing native exit/pipe-close evidence")
            for stream in ("stdout", "stderr"):
                require(events["counts"][stream] == (folder / (name + "." + stream)).stat().st_size,
                        "truncated retained native stream")
            raw = read_bounded(folder / (name + ".stdout"))
            check_diagnostics(raw, CHAR_ERROR if name == "restored" and kind == "canonical-zero-char" else None,
                              stderr=read_bounded(folder / (name + ".stderr")))
            if name != "candidate":
                suffix = suffix_from_events(raw, events["events"], halted=kind == "valid-char")
                require(suffix.hex() == result["observed"][name + "_suffix_hex"]
                        and marker_list(suffix) == result["observed"][name + "_markers"], "raw suffix mismatch")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--require-reference", action="store_true")
    parser.add_argument("--characterize", action="store_true", help="collect observations only, never a qualification pass")
    parser.add_argument("--verify-bundle", type=Path)
    args = parser.parse_args(argv)
    if args.verify_bundle:
        manifest = verify_bundle(args.verify_bundle)
        print(json.dumps({"status": "verified", "results": len(manifest["results"])}))
        return 0
    missing = prerequisites()
    if missing:
        print(json.dumps({"status": "failed" if args.require_reference else "skipped", "reason": missing}))
        return 2 if args.require_reference else 77
    require(args.archive is not None and args.out is not None, "--archive and --out required")
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "invocation.json", {"argv": sys.argv, "characterize": args.characterize,
                                            "source_hashes": {p.relative_to(HERE).as_posix(): sha(p.read_bytes())
                                                              for p in HERE.rglob("*")
                                                              if p.suffix in (".py", ".json")}})
    canonical_path = REPO / "tests/fixtures/zmachine/fixture.z5"
    canonical = read_bounded(canonical_path, 4 * 1024 * 1024)
    require(sha(canonical) == CANONICAL_SHA, "canonical fixture identity")
    expected = frozen_expectations()
    results, status, failure = [], "failed", None
    scratch = Path(tempfile.mkdtemp(prefix="zirp-bocfel-reference-"))
    try:
        binary, identity = build(args.archive.resolve(), scratch, output)
        for kind in CASES:
            for repeat in range(1, 4):
                label = kind + "-" + str(repeat)
                result = run_trial(kind, repeat, binary, canonical, scratch / label, output / label)
                results.append(result)
                if not args.characterize:
                    require(result["observed"] == expected[kind], "frozen expectation mismatch: " + label)
                print(json.dumps({"case": kind, "repeat": repeat, "observed": result["observed"]}), flush=True)
        require(canonical_path.read_bytes() == canonical, "canonical fixture changed")
        status = "characterized-not-qualified" if args.characterize else "qualified"
    except Exception as error:
        failure = type(error).__name__ + ": " + str(error)
    finally:
        # Every Child context must reap/close before this point; if not, its
        # exception prevents success. Root verification precedes recursive cleanup.
        removed = False
        try:
            cleanup_scratch(scratch)
            removed = True
        except (OSError, Failure) as error:
            status, failure = "failed", "scratch cleanup failed: " + str(error)
        inventory = {p.relative_to(output).as_posix(): {"bytes": p.stat().st_size, "sha256": sha(p.read_bytes())}
                     for p in output.rglob("*") if p.is_file()}
        write_json(output / "manifest.json", {"status": status, "failure": failure,
                   "results": results, "inventory": inventory, "scratch_removed": removed,
                   "retained_scratch": str(scratch) if not removed else None})
    print(json.dumps({"status": status, "failure": failure, "trials": len(results)}), flush=True)
    return 1 if failure else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Failure, OSError, ValueError) as error:
        print(json.dumps({"status": "failed", "reason": str(error)}), file=sys.stderr)
        sys.exit(1)
