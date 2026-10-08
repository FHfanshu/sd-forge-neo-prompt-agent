import unittest

from helpers import TempData, png_bytes

from prompt_agent import attachments
from prompt_agent.common import ToolError


class SessionStoreTest(unittest.TestCase):
    def setUp(self):
        self.data = TempData()
        self.store = self.data.sessions()
        self.session = self.store.create_session("t", "p1")

    def tearDown(self):
        self.data.cleanup()

    def test_put_assigns_seq_and_upsert_keeps_it(self):
        sid = self.session["id"]
        first = self.store.put_message(sid, "m1", {"role": "user", "content": "hi"})
        second = self.store.put_message(sid, "m2", {"role": "assistant", "status": "streaming", "content": "he"})
        again = self.store.put_message(sid, "m2", {"role": "assistant", "status": "complete", "content": "hello",
                                                   "tool_calls": [{"id": "c1"}], "usage": {"total_tokens": 3}})
        self.assertEqual((first["seq"], second["seq"], again["seq"]), (1, 2, 2))
        messages = self.store.list_messages(sid)["messages"]
        self.assertEqual([m["content"] for m in messages], ["hi", "hello"])
        self.assertEqual(messages[1]["tool_calls"], [{"id": "c1"}])
        self.assertEqual(messages[1]["status"], "complete")

    def test_paging_returns_latest_window_in_order(self):
        sid = self.session["id"]
        for index in range(7):
            self.store.put_message(sid, f"m{index}", {"role": "user", "content": str(index)})
        page = self.store.list_messages(sid, limit=3)
        self.assertEqual([m["content"] for m in page["messages"]], ["4", "5", "6"])
        self.assertTrue(page["has_more"])
        older = self.store.list_messages(sid, before_seq=page["messages"][0]["seq"], limit=10)
        self.assertEqual([m["content"] for m in older["messages"]], ["0", "1", "2", "3"])
        self.assertFalse(older["has_more"])

    def test_recover_marks_streaming_interrupted_only(self):
        sid = self.session["id"]
        self.store.put_message(sid, "a", {"role": "assistant", "status": "streaming", "content": "partial"})
        self.store.put_message(sid, "b", {"role": "assistant", "status": "complete"})
        self.assertEqual(self.store.recover(), 1)
        statuses = {m["id"]: m["status"] for m in self.store.list_messages(sid)["messages"]}
        self.assertEqual(statuses, {"a": "interrupted", "b": "complete"})
        self.assertEqual(self.store.list_messages(sid)["messages"][0]["content"], "partial")

    def test_session_model_column(self):
        session = self.store.create_session("t", "p1", model="m1")
        updated = self.store.update_session(session["id"], {"model": "m2"})
        self.assertEqual(updated["model"], "m2")
        self.assertEqual(self.store.get_session(session["id"])["model"], "m2")

    def test_delete_from_seq(self):
        sid = self.session["id"]
        for index in range(4):
            self.store.put_message(sid, f"m{index}", {"role": "user"})
        self.assertEqual(self.store.delete_messages_from(sid, 3), 2)
        self.assertEqual(len(self.store.list_messages(sid)["messages"]), 2)

    def test_invalid_role_and_foreign_message_id(self):
        sid = self.session["id"]
        with self.assertRaises(ToolError):
            self.store.put_message(sid, "x", {"role": "system"})
        other = self.store.create_session()
        self.store.put_message(sid, "shared", {"role": "user"})
        with self.assertRaises(ToolError):
            self.store.put_message(other["id"], "shared", {"role": "user"})
        with self.assertRaises(ToolError):
            self.store.put_message("missing", "y", {"role": "user"})

    def test_attachment_pnginfo_and_delete_cascade(self):
        sid = self.session["id"]
        binary = png_bytes("1girl, rain\nNegative prompt: blurry\nSteps: 30, Sampler: Euler a, CFG scale: 5, Seed: 42, Size: 64x48")
        saved = attachments.save_attachment(self.store, sid, binary)
        self.assertEqual(saved["pnginfo"]["status"], "ok")
        self.assertEqual(saved["pnginfo"]["positive"], "1girl, rain")
        self.assertEqual(saved["pnginfo"]["negative"], "blurry")
        self.assertEqual(saved["pnginfo"]["parameters"]["steps"], 30)
        path, mime = attachments.original_path(self.store, saved["id"])
        self.assertEqual((path.read_bytes(), mime), (binary, "image/png"))
        self.assertTrue(attachments.model_jpeg(self.store, saved["id"]).startswith(b"\xff\xd8"))
        self.store.delete_session(sid)
        self.assertFalse(path.exists())
        with self.assertRaises(ToolError):
            self.store.get_attachment(saved["id"])

    def test_attachment_rejects_bad_input(self):
        sid = self.session["id"]
        with self.assertRaises(ToolError):
            attachments.save_attachment(self.store, sid, b"not an image")
        with self.assertRaises(ToolError):
            attachments.save_attachment(self.store, sid, b"\0" * (attachments.MAX_BYTES + 1))
        plain = attachments.save_attachment(self.store, sid, png_bytes())
        self.assertEqual(plain["pnginfo"]["status"], "missing")


if __name__ == "__main__":
    unittest.main()
