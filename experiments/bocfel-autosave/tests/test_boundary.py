import base64
from pathlib import Path
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fixture import character_story
from reference import Child, Failure, LIVE_CHILDREN, boundary, environment, sha
from test_reference import image


@unittest.skipUnless(os.name == "posix", "POSIX boundary supervisor; execute inside Linux/WSL")
class BoundaryTests(unittest.TestCase):
    def test_output_and_existing_or_truncated_file_do_not_prove_new_boundary(self):
        for stale in (True, False):
            with self.subTest(stale=stale), tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
                root = Path(root); saves = root / "saves"; saves.mkdir()
                data = image(); (saves / "save").write_bytes(data if stale else data[:-1])
                with self.assertRaisesRegex(Failure, "deadline"):
                    with Child([sys.executable, "-u", "-c", "import time;print('ready');time.sleep(30)"],
                               root, environment(root / "home"), root / "child") as child:
                        child.until(lambda: b"ready" in child.data["stdout"])
                        child.deadline = time.monotonic() + 0.1
                        boundary(child, saves, character_story(), lambda out: b"ready" in out,
                                 previous=sha(data), opcode=1)
                self.assertFalse(LIVE_CHILDREN)

    def test_complete_changed_image_and_output_acknowledge_live_boundary(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            root = Path(root); saves = root / "saves"; saves.mkdir()
            old, new = image(args=b"\x01"), image()
            (saves / "save").write_bytes(old)
            script = "import pathlib,base64,time;pathlib.Path('saves/save').write_bytes(base64.b64decode('" + base64.b64encode(new).decode() + "'));print('ready',flush=True);time.sleep(30)"
            with Child([sys.executable, "-c", script], root, environment(root / "home"), root / "child") as child:
                saved = boundary(child, saves, character_story(), lambda out: b"ready" in out, sha(old), opcode=1)
                self.assertEqual(saved[1], new)
                self.assertIsNone(child.process.poll())
                child.reap(kill=True)
                self.assertEqual(child.process.returncode, -9)
            self.assertFalse(LIVE_CHILDREN)
