"""Synthetic process controls. POSIX pipe supervision is not a Windows claim."""
from pathlib import Path
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reference import Child, Failure, LIVE_CHILDREN, environment


@unittest.skipUnless(os.name == "posix", "POSIX process supervisor; execute inside Linux/WSL")
class ProcessTests(unittest.TestCase):
    def test_clean_exit_requires_both_pipe_eofs(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            with Child([sys.executable, "-c", "print('ready')"], root, environment(Path(root) / "home"), Path(root) / "child") as child:
                child.until(lambda: child.process.poll() is not None)
                child.finish()
                self.assertEqual(child.process.returncode, 0)
                self.assertEqual(child.eof, {"stdout", "stderr"})
                self.assertTrue(child.exit_observed)
                self.assertEqual(bytes(child.data["stdout"]), b"ready\n")
            self.assertFalse(LIVE_CHILDREN)

    def test_premature_exit_is_not_a_boundary(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            with self.assertRaisesRegex(Failure, "premature exit"):
                with Child([sys.executable, "-c", "pass"], root, environment(Path(root) / "home"), Path(root) / "child") as child:
                    child.until(lambda: False)
            self.assertFalse(LIVE_CHILDREN)

    def test_acknowledged_stall_deadline_is_reaped(self):
        with tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
            with self.assertRaisesRegex(Failure, "deadline"):
                with Child([sys.executable, "-u", "-c", "import time;print('ready');time.sleep(30)"], root,
                           environment(Path(root) / "home"), Path(root) / "child") as child:
                    child.until(lambda: b"ready" in child.data["stdout"])
                    child.until(lambda: False, seconds=0.1)
            self.assertEqual(child.process.returncode, -9)
            self.assertEqual(child.eof, {"stdout", "stderr"})
            self.assertFalse(LIVE_CHILDREN)

    def test_stdout_and_stderr_floods_fail_and_reap(self):
        for pipe in ("stdout", "stderr"):
            with self.subTest(pipe=pipe), tempfile.TemporaryDirectory(prefix="zirp-bocfel-unit-") as root:
                script = "import sys,time;sys." + pipe + ".write('x'*10000);sys." + pipe + ".flush();time.sleep(30)"
                with self.assertRaisesRegex(Failure, pipe + " output limit"):
                    with Child([sys.executable, "-c", script], root, environment(Path(root) / "home"),
                               Path(root) / "child", stdout_cap=128, stderr_cap=128) as child:
                        child.until(lambda: False)
                self.assertLessEqual(len(child.data[pipe]), 128)
                self.assertEqual(child.process.returncode, -9)
                self.assertEqual(child.eof, {"stdout", "stderr"})
                self.assertFalse(LIVE_CHILDREN)


if __name__ == "__main__":
    unittest.main()
