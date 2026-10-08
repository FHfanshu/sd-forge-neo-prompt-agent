import json
import unittest

from helpers import TempData, fake_unprotect

from prompt_agent.common import ToolError


class ProfileStoreTest(unittest.TestCase):
    def setUp(self):
        self.data = TempData()

    def tearDown(self):
        self.data.cleanup()

    def test_upsert_hides_key_and_round_trips_secret(self):
        store = self.data.profiles()
        profile = store.upsert(None, {"name": "DS", "base_url": "https://api.example.com/v1/", "models": ["m1"], "api_key": "sk-secret"})
        self.assertEqual(profile["base_url"], "https://api.example.com/v1")
        listing = store.list()
        self.assertTrue(listing["profiles"][0]["has_api_key"])
        self.assertNotIn("sk-secret", json.dumps(listing))
        self.assertNotIn("sk-secret", (self.data.root / "secrets-v2.dpapi.json").read_text())
        self.assertEqual(store.api_key(profile["id"]), "sk-secret")
        self.assertEqual(listing["default_id"], profile["id"])

    def test_api_key_omitted_keeps_and_empty_clears(self):
        store = self.data.profiles()
        profile = store.upsert(None, {"name": "A", "base_url": "http://x", "models": ["m"], "api_key": "k"})
        store.upsert(profile["id"], {"name": "A2", "base_url": "http://x", "models": ["m"]})
        self.assertEqual(store.api_key(profile["id"]), "k")
        store.upsert(profile["id"], {"name": "A2", "base_url": "http://x", "models": ["m"], "api_key": ""})
        self.assertEqual(store.api_key(profile["id"]), "")

    def test_validation(self):
        store = self.data.profiles()
        for bad in (
            {"name": "", "base_url": "http://x", "models": ["m"]},
            {"name": "a", "base_url": "file:///etc", "models": ["m"]},
            {"name": "a", "base_url": "http://x", "models": ["m"], "reasoning_effort": "max"},
            {"name": "a", "base_url": "http://x", "models": ["m"], "temperature": 5},
        ):
            with self.assertRaises(ToolError):
                store.upsert(None, bad)

    def test_chat_completions_suffix_is_stripped(self):
        store = self.data.profiles()
        profile = store.upsert(None, {"name": "a", "base_url": "https://h/v1/chat/completions", "models": ["m"]})
        self.assertEqual(profile["base_url"], "https://h/v1")

    def test_delete_moves_default_and_removes_secret(self):
        store = self.data.profiles()
        a = store.upsert(None, {"name": "a", "base_url": "http://x", "models": ["m"], "api_key": "k"})
        b = store.upsert(None, {"name": "b", "base_url": "http://x", "models": ["m"]})
        store.delete(a["id"])
        self.assertEqual(store.list()["default_id"], b["id"])
        self.assertEqual(store.api_key(a["id"]), "")

    def test_legacy_import_copies_cipher_and_skips_other_protocols(self):
        legacy = {
            "version": 1,
            "active_profile_id": "p2",
            "profiles": [
                {"profile_id": "p1", "display_name": "Gem", "model_id": "g", "protocol": "gemini-native", "endpoint": "https://g", "parameters": {}, "capabilities": {}},
                {"profile_id": "p2", "display_name": "DS", "model_id": "ds", "protocol": "openai-chat-completions",
                 "endpoint": "https://api.deepseek.com", "parameters": {"reasoning_effort": "high", "temperature": 0.3, "max_tokens": 8192},
                 "capabilities": {"vision": True}},
                {"profile_id": "p3", "display_name": "Local", "model_id": "x", "protocol": "openai-chat-completions",
                 "endpoint": "http://127.0.0.1:8080/v1", "parameters": {"reasoning_effort": "none"}, "capabilities": {}},
            ],
        }
        (self.data.root / "profiles.json").write_text(json.dumps(legacy))
        (self.data.root / "secrets.dpapi.json").write_text(json.dumps({"p2": "enc:yek"}))
        store = self.data.profiles()
        listing = store.list()
        self.assertEqual([p["id"] for p in listing["profiles"]], ["p2", "p3"])
        self.assertEqual(listing["default_id"], "p2")
        self.assertEqual(listing["import_report"], {"imported": 2, "skipped": 1})
        self.assertEqual(listing["profiles"][0]["reasoning_effort"], "high")
        self.assertEqual(listing["profiles"][0]["models"], [{"id": "ds", "vision": True}])
        self.assertEqual(listing["profiles"][1]["reasoning_effort"], "")
        self.assertEqual(listing["profiles"][0]["base_url"], "https://api.deepseek.com")
        self.assertEqual(listing["profiles"][1]["base_url"], "http://127.0.0.1:8080/v1")
        self.assertEqual(store.api_key("p2"), fake_unprotect("enc:yek"))
        # legacy files are untouched and import runs once
        self.assertEqual(json.loads((self.data.root / "profiles.json").read_text()), legacy)
        self.assertIsNone(self.data.profiles().import_report)

    def test_models_validation_and_early_shape(self):
        store = self.data.profiles()
        with self.assertRaises(ToolError):
            store.upsert(None, {"name": "a", "base_url": "http://x", "models": []})
        with self.assertRaises(ToolError):
            store.upsert(None, {"name": "a", "base_url": "http://x", "models": ["m", "m"]})
        p = store.upsert(None, {"name": "a", "base_url": "http://x", "models": [{"id": "v", "vision": True}, "t"]})
        self.assertEqual(store.resolve(p["id"], "v")["vision"], True)
        with self.assertRaises(ToolError):
            store.resolve(p["id"], "other")
        (self.data.root / "profiles-v2.json").write_text(json.dumps({"profiles": [{"id": "old", "name": "o", "base_url": "http://x", "model": "mm", "vision": True}]}))
        self.assertEqual(store.get("old")["models"], [{"id": "mm", "vision": True}])

    def test_legacy_base_url_keeps_v1_meaning(self):
        from prompt_agent.profiles import legacy_base_url

        self.assertEqual(legacy_base_url("https://opencode.ai/zen/go"), "https://opencode.ai/zen/go/v1")
        self.assertEqual(legacy_base_url("https://x.test/v1beta/"), "https://x.test/v1beta")
        self.assertEqual(legacy_base_url("https://x.test/v1/chat/completions"), "https://x.test/v1")
        self.assertEqual(legacy_base_url("https://api.deepseek.com"), "https://api.deepseek.com")

    def test_settings_and_civitai_key(self):
        store = self.data.profiles()
        self.assertEqual(store.settings(), {"civitai_enabled": True, "has_civitai_key": False})
        result = store.update_settings({"civitai_enabled": False, "civitai_api_key": "ck"})
        self.assertEqual(result, {"civitai_enabled": False, "has_civitai_key": True})
        self.assertEqual(store.api_key("civitai"), "ck")


if __name__ == "__main__":
    unittest.main()
