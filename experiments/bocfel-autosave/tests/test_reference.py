"""Portable tests; no interpreter download/build or canonical writes."""
import contextlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fixture import character_story
from matrix import CHARACTER_SHA
from reference import (Failure, check_diagnostics, chunks, environment, inspect_save,
                       marker_list, read_bounded, sha, suffix_from_events, write_json)
import reproduce


def image(story=None, args=b"\x01\x00\x01", rand=b"\0\0\0\0\0*", memory=None):
    story = story or character_story()
    header = story[2:4] + story[0x12:0x18] + story[28:30] + b"\0\x04\x10"
    entries = [(b"IFhd", header), memory or (b"UMem", story[:0x400]), (b"Stks", b"\0" * 8), (b"Args", args)]
    if rand is not None:
        entries.append((b"Rand", rand))
    payload = b"BFZS" + b"".join(tag + struct.pack(">I", len(data)) + data + bytes(len(data) & 1)
                                 for tag, data in entries)
    return b"FORM" + struct.pack(">I", len(payload)) + payload


class FormatTests(unittest.TestCase):
    def test_original_control_digest_header_and_explicit_device(self):
        story = character_story()
        self.assertEqual(sha(story), CHARACTER_SHA)
        self.assertEqual(story[0], 5)
        self.assertEqual(int.from_bytes(story[26:28], "big") * 4, len(story))
        self.assertEqual(sum(story[0x40:]) & 0xFFFF, int.from_bytes(story[28:30], "big"))
        self.assertEqual(story.count(bytes.fromhex("f67f0111")), 1)
        self.assertNotIn(bytes.fromhex("f6ff"), story[0x400:0x500])

    def test_real_field_shapes_and_zero_operand_character_distinction(self):
        valid = inspect_save(image(), character_story())
        invalid_operand = inspect_save(image(args=b"\x01", rand=None), character_story())
        self.assertEqual(valid["operands"], [1])
        self.assertEqual(valid["rand_hex"], "00000000002a")
        self.assertEqual(invalid_operand["operands"], [])
        self.assertIsNone(invalid_operand["rand_hex"])

    def test_truncation_and_trailing_data_are_rejected(self):
        data = image()
        for candidate in (data[:4], data[:-1], data + b"\0", data[:8] + b"IFZS" + data[12:]):
            with self.subTest(size=len(candidate)), self.assertRaises(Failure):
                chunks(candidate)

    def test_chunk_overrun_and_duplicate_are_rejected(self):
        data = bytearray(image())
        data[16:20] = b"\xff" * 4
        with self.assertRaisesRegex(Failure, "exceeds"):
            chunks(bytes(data))
        data = image()
        extra = b"Args\0\0\0\x01\x01\0"
        duplicated = data[:4] + struct.pack(">I", len(data) - 8 + len(extra)) + data[8:] + extra
        with self.assertRaisesRegex(Failure, "duplicate"):
            chunks(duplicated)

    def test_fourcc_high_bit_is_not_folded(self):
        data = image().replace(b"Args", b"\xc1rgs")
        with self.assertRaisesRegex(Failure, "Args"):
            chunks(data)

    def test_wrong_story_rand_and_memory_rejected(self):
        story = bytearray(character_story()); story[2] ^= 1
        with self.assertRaisesRegex(Failure, "IFhd"):
            inspect_save(image(), bytes(story))
        for rand in (b"", b"\0" * 6, b"\0\x01\0\0\0\x01"):
            with self.assertRaisesRegex(Failure, "Rand"):
                inspect_save(image(rand=rand), character_story())
        data = image(memory=(b"CMem", b"\0"))
        with self.assertRaises(Failure):
            inspect_save(data, character_story())

    def test_bounded_regular_read_exact_limit_and_plus_one(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            file = Path(root) / "data"
            file.write_bytes(b"abcd")
            self.assertEqual(read_bounded(file, 4), b"abcd")
            with self.assertRaisesRegex(Failure, "size limit"):
                read_bounded(file, 3)

    def test_comparison_preserves_whitespace_and_marker_order(self):
        raw = b" >\n[F08:roll=5]\n[F08:roll=4]\n>"
        self.assertEqual(marker_list(raw), ["[F08:roll=5]", "[F08:roll=4]"])
        self.assertNotEqual(raw, raw.strip())
        self.assertNotEqual(raw, raw.replace(b"roll=5", b"roll=4"))
        data = b"history\n" + raw + b"quit\n"
        events = [{"event": "suffix-cut", "stdout_offset": 8},
                  {"event": "suffix-end", "stdout_offset": 8 + len(raw)}]
        self.assertEqual(suffix_from_events(data, events), raw)
        self.assertEqual(suffix_from_events(data[:-5], events[:1], halted=True), raw)
        for bad in ([], events * 2, [events[1], {"event": "suffix-cut", "stdout_offset": len(data)}]):
            with self.assertRaises(Failure):
                suffix_from_events(data, bad)

    def test_unexpected_and_repeated_native_diagnostics_fail(self):
        message = b"[Save file error: invalid Args size for 1: 0]"
        check_diagnostics(message, message)
        for data, allowed in [(message, None), (message * 2, message), (b"warning: unexpected", None)]:
            with self.assertRaises(Failure):
                check_diagnostics(data, allowed)
        for data, allowed in [(b"normal output", None), (message, message)]:
            with self.assertRaisesRegex(Failure, "unexpected native stderr"):
                check_diagnostics(data, allowed, stderr=b"unframed native diagnostic")

    def test_environment_does_not_inherit_bocfel_overrides_or_credentials(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            with patch.dict("os.environ", {"BOCFEL_SKIP_AUTORESTORE": "1", "PRIVATE_TEST_TOKEN": "synthetic"}):
                env = environment(Path(root) / "home", Path(root) / "saves")
            self.assertEqual(env["BOCFEL_SKIP_AUTORESTORE"], "0")
            self.assertEqual(env["BOCFEL_AUTOSAVE_LIBRARYSTATE"], "0")
            self.assertNotIn("PRIVATE_TEST_TOKEN", env)

    def test_skip_is_distinct_from_required_reference_failure(self):
        for required, code, status in [(False, 77, "skipped"), (True, 2, "failed")]:
            with patch.object(reproduce, "prerequisites", return_value="synthetic absent compiler"), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(reproduce.main(["--require-reference"] if required else []), code)
                self.assertEqual(json.loads(output.getvalue())["status"], status)

    def test_bundle_inventory_and_digest_tampering_rejected(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            root = Path(root); file = root / "raw.stdout"; file.write_bytes(b"exact\n")
            manifest = {"status": "qualified", "results": [{}] * 12,
                        "inventory": {"raw.stdout": {"bytes": 6, "sha256": sha(b"exact\n")}}}
            write_json(root / "manifest.json", manifest)
            self.assertEqual(reproduce.verify_inventory(root)["status"], "qualified")
            with self.assertRaises((Failure, KeyError)):
                reproduce.verify_bundle(root)  # a forged success label/12 empty rows is insufficient
            file.write_bytes(b"changed")
            with self.assertRaisesRegex(Failure, "digest"):
                reproduce.verify_inventory(root)
            (root / "extra").write_bytes(b"extra")
            with self.assertRaisesRegex(Failure, "inventory"):
                reproduce.verify_inventory(root)

    def test_source_pin_is_checked_before_archive_parsing(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            root = Path(root); archive = root / "wrong.tar.gz"; archive.write_bytes(b"not the source")
            with patch.object(reproduce.tarfile, "open") as open_archive:
                with self.assertRaisesRegex(Failure, "identity"):
                    reproduce.build(archive, root, root / "output")
                open_archive.assert_not_called()

    def test_truncated_stack_frames_rejected(self):
        raw = image()
        raw = raw.replace(b"Stks\0\0\0\x08" + bytes(8), b"Stks\0\0\0\x08" + bytes(6) + b"\0\x01")
        with self.assertRaisesRegex(Failure, "Stks frame"):
            chunks(raw)

    def test_cleanup_failures_and_live_children_never_report_removed(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-reference-") as root:
            path = Path(root).resolve()
            with patch.object(reproduce.shutil, "rmtree", side_effect=OSError("synthetic cleanup failure")):
                with self.assertRaisesRegex(OSError, "cleanup failure"):
                    reproduce.cleanup_scratch(path)
                self.assertTrue(path.exists())
            with patch.object(reproduce, "LIVE_CHILDREN", {object()}):
                with self.assertRaisesRegex(Failure, "not observed reaped"):
                    reproduce.cleanup_scratch(path)
                self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
