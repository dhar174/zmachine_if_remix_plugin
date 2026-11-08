"""Fixture-scoped comparisons. No imported ifvms code or checkpoint oracle."""
from pathlib import Path
import struct
import sys
import time

from fixture import character_story
from reference import (Child, CHAR_ERROR, CONTINUING, TRIAL_SECONDS, boundary,
                       canonical_quit, check_diagnostics, core_equal, environment,
                       marker_list, require, sha, write_bytes, write_json)

CANONICAL_SHA = "96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b"
CHARACTER_SHA = "d829351fe638fa7f6c18e54cda08a8bb766e05df3106ebfd7985c08115d7af91"
CASES = ("seeded-line", "canonical-zero-char", "valid-char", "random-mode")


def run_trial(kind, repeat, binary, canonical, work, artifacts):
    require(kind in CASES, "unknown case")
    deadline = time.monotonic() + TRIAL_SECONDS
    work, artifacts = Path(work), Path(artifacts)
    work.mkdir(); artifacts.mkdir(parents=True)
    story = character_story() if kind == "valid-char" else canonical
    require(sha(story) == (CHARACTER_SHA if kind == "valid-char" else CANONICAL_SHA), "fixture digest")
    if kind == "canonical-zero-char":
        require(story[0x124AC:0x124AF] == bytes.fromhex("f6ff01"), "canonical read_char opcode bytes")
    story_path = work / "fixture.z5"
    write_bytes(story_path, story)
    entropy = b"".join(struct.pack("=I", word) for word in range(1024))
    entropy_path = work / "entropy.bin"
    if kind == "random-mode":
        write_bytes(entropy_path, entropy)
        write_bytes(artifacts / "entropy.bin", entropy)

    def launch(name):
        root = work / name
        root.mkdir()
        saves = root / "autosaves"
        env = environment(root / "home", saves)
        argv = [str(binary), "-C", "-m"]
        if kind == "random-mode":
            argv += ["-Z", str(entropy_path)]
        argv.append(str(story_path))
        return root, saves, argv, env

    def prefix(child, saves):
        if kind == "valid-char":
            return boundary(child, saves, story, lambda out: b"[CTRL:char-open]" in out, opcode=1)
        saved = boundary(child, saves, story, lambda out: b"[F01:startup=7]" in out and out.endswith(b">"))
        commands = [(b"menu\n", b"[F07:menu-open]")] if kind == "canonical-zero-char" else [
            (b"look\n", b"[LOC:chamber]"), (b"north\n", b"[LOC:gallery]")]
        if kind == "seeded-line":
            commands += [(b"seed 42\n", b"[F08:seed=42]")]
        if kind in ("seeded-line", "random-mode"):
            commands += [(b"roll\n", b"[F08:roll=")]
        for data, marker in commands:
            previous = saved[2]["sha256"]
            child.send(data)
            char = data == b"menu\n"
            saved = boundary(child, saves, story,
                             lambda out, m=marker, c=char: m in out and (c or out.endswith(b">")),
                             previous, opcode=1 if char else 0)
        return saved

    def suffix(child, saves, saved, restored=False):
        cut = len(child.data["stdout"])
        child.event("suffix-cut", restored=restored)
        if kind == "valid-char":
            child.send(b"b\n"); child.finish()
            output = bytes(child.data["stdout"])[cut:]
            require(b"[CTRL:key=98]" in output and b"[CTRL:roll=1]" in output, "valid character continuation")
            return output
        if kind == "canonical-zero-char":
            child.send(b"b\n")
            marker = b"That's not a verb I recognise" if restored else b"[F07:menu-choice=beta]"
            boundary(child, saves, story, lambda out: marker in out and out.endswith(b">"), saved[2]["sha256"])
        else:
            for _ in range(2):
                child.send(b"roll\n")
                saved = boundary(child, saves, story, lambda out: b"[F08:roll=" in out and out.endswith(b">"),
                                 saved[2]["sha256"])
        output = bytes(child.data["stdout"])[cut:]
        child.event("suffix-end")
        canonical_quit(child)
        return output

    control_root, control_saves, argv, env = launch("control")
    with Child(argv, control_root, env, artifacts / "control", deadline) as child:
        control_save = prefix(child, control_saves)
        write_bytes(artifacts / "control-prefix.bfzs", control_save[1])
        control_suffix = suffix(child, control_saves, control_save)
        check_diagnostics(bytes(child.data["stdout"]), stderr=bytes(child.data["stderr"]))

    root, saves, argv, env = launch("candidate")
    with Child(argv, root, env, artifacts / "candidate", deadline) as child:
        original = prefix(child, saves)
        core_equal(control_save[2], original[2])
        write_bytes(artifacts / "candidate-prefix.bfzs", original[1])
        child.reap(kill=True)
        require(child.process.returncode == -9, "candidate did not terminate by SIGKILL")
        require(original[0].read_bytes() == original[1], "autosave changed after verified kill")
        check_diagnostics(bytes(child.data["stdout"]), stderr=bytes(child.data["stderr"]))

    # Reuse only the owned candidate autosave directory; preserve its original
    # bytes separately before native restoration can overwrite the active file.
    before = original[0].stat()
    generation = (before.st_ino, before.st_mtime_ns, before.st_size)
    restore_root = work / "restored"; restore_root.mkdir()
    restore_env = environment(restore_root / "home", saves)
    with Child(argv, restore_root, restore_env, artifacts / "restored", deadline) as child:
        is_bad_char = kind == "canonical-zero-char"
        ready = (lambda out: CHAR_ERROR in out and b"[F01:startup=7]" in out and out.endswith(b">")) if is_bad_char else (
            lambda out: CONTINUING in out and out.endswith(b"[Continuing last session from autosave]\n"))
        restored_save = boundary(child, saves, story, ready, opcode=0 if is_bad_char else original[2]["save_opcode"],
                                 old_generation=generation)
        write_bytes(artifacts / "restored-boundary.bfzs", restored_save[1])
        if not is_bad_char:
            core_equal(original[2], restored_save[2])
        startup = bytes(child.data["stdout"])
        require((CONTINUING in startup) != is_bad_char, "restore announcement/fallback mismatch")
        restored_suffix = suffix(child, saves, restored_save, restored=True)
        check_diagnostics(bytes(child.data["stdout"]), CHAR_ERROR if is_bad_char else None,
                          stderr=bytes(child.data["stderr"]))
        restored_code = child.process.returncode
    require(story_path.read_bytes() == story, "story bytes changed")
    if kind == "random-mode":
        require(entropy_path.read_bytes() == entropy, "entropy input changed")
    require((original[2]["rand_hex"] is not None) == (kind in ("seeded-line", "valid-char")), "Rand mode mismatch")
    if kind in ("seeded-line", "valid-char"):
        require(control_suffix == restored_suffix, "seeded suffix bytes differ")
    if kind == "random-mode":
        require(control_suffix != restored_suffix, "controlled random-mode divergence not demonstrated")
    observed = {"prefix_args_hex": original[2]["args_hex"], "prefix_rand_hex": original[2]["rand_hex"],
                "control_suffix_hex": control_suffix.hex(), "restored_suffix_hex": restored_suffix.hex(),
                "control_markers": marker_list(control_suffix), "restored_markers": marker_list(restored_suffix),
                "suffix_equal": control_suffix == restored_suffix,
                "native_restore_error": CHAR_ERROR.decode() if is_bad_char else None,
                "candidate_returncode": -9, "restored_returncode": restored_code}
    result = {"case": kind, "repeat": repeat, "observed": observed,
              "fixture_sha256": sha(story), "control_prefix": control_save[2], "candidate_prefix": original[2],
              "restored_boundary": restored_save[2], "entropy_byteorder": sys.byteorder if kind == "random-mode" else None,
              "entropy_sha256": sha(entropy) if kind == "random-mode" else None}
    write_json(artifacts / "result.json", result)
    return result
