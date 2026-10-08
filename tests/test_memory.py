import tempfile
import unittest
from pathlib import Path

from helpers import ROOT  # noqa: F401  (puts the extension on sys.path)

from prompt_agent.common import ToolError
from prompt_agent.memory import MAX_CHARS, MemoryStore


class MemoryStoreTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.store = MemoryStore(Path(self._dir.name) / "MEMORY.md")

    def tearDown(self):
        self._dir.cleanup()

    def test_append_replace_delete_keep_plain_markdown(self):
        self.assertEqual(self.store.read(), "")
        self.store.edit("append", "# LoRA\n- 最新多合一：bigfurnace")
        self.store.edit("append", "- 默认推理强度 medium")
        self.store.edit("replace", "- 最新多合一：bigfurnace v2", find="- 最新多合一：bigfurnace")
        self.store.edit("delete", find="- 默认推理强度 medium")
        self.assertEqual(self.store.read(), "# LoRA\n- 最新多合一：bigfurnace v2\n")

    def test_find_must_match_exactly_once(self):
        self.store.write("- a\n- a\n")
        with self.assertRaises(ToolError) as ambiguous:
            self.store.edit("delete", find="- a")
        self.assertEqual(ambiguous.exception.code, "AMBIGUOUS")
        with self.assertRaises(ToolError) as stale:
            self.store.edit("replace", "x", find="- b")
        self.assertEqual((stale.exception.code, stale.exception.extra["memory"]), ("STALE", "- a\n- a\n"))

    def test_size_cap_and_user_edits_survive(self):
        with self.assertRaises(ToolError):
            self.store.write("x" * (MAX_CHARS + 1))
        self.store.write("# mine\r\n- hand written\r\n")
        with self.assertRaises(ToolError):
            self.store.edit("append", "y" * MAX_CHARS)
        self.assertEqual(self.store.read(), "# mine\n- hand written\n")


if __name__ == "__main__":
    unittest.main()
