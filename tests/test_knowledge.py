import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx
from helpers import ROOT

from prompt_agent.common import ToolError
from prompt_agent.knowledge import characters, resources, skills
from prompt_agent.knowledge.model_info import ModelInfo, html_to_text

SHA = "a" * 64


class SkillsAndCharactersTest(unittest.TestCase):
    def test_skills_listing_and_reference(self):
        names = [s["name"] for s in skills.list_skills()]
        self.assertIn("danbooru-prompting", names)
        loaded = skills.load_skill("danbooru-prompting", "tagging-contract")
        self.assertTrue(loaded["content"])

    def test_skill_names_cannot_escape(self):
        for name, reference in (("../AGENTS", ""), ("danbooru-prompting", "../SKILL"), ("danbooru-prompting", "..\\..\\x")):
            with self.assertRaises(ToolError):
                skills.load_skill(name, reference)

    def test_characters_with_bindings(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "bindings").mkdir()
            (root / "aya.json").write_text(json.dumps({"name": "aya", "short_description": "d", "trigger_words": ["aya"]}))
            (root / "_template.json").write_text("{}")
            (root / "bindings" / "aya-anima.json").write_text(json.dumps({"character": "aya", "checkpoint": "c"}))
            self.assertEqual(characters.list_characters(root), [{"name": "aya", "short_description": "d"}])
            result = characters.get_character("AYA", root)
            self.assertEqual(result["bindings"][0]["checkpoint"], "c")
            with self.assertRaises(ToolError):
                characters.get_character("../aya", root)


class WildcardTest(unittest.TestCase):
    def test_wildcards_resolve_only_listed_names(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "hair").mkdir()
            (root / "hair" / "color.txt").write_text("# c\nred\n\nblue\n", encoding="utf-8")
            with mock.patch("prompt_agent.forge.wildcard_root", return_value=root):
                found = resources.search_resources("wildcard", "hair")
                self.assertEqual(found["items"][0]["summary"], "__hair/color__")
                inspected = resources.inspect_resource("wildcard", "__hair/color__")
                self.assertEqual(inspected["values"], ["red", "blue"])
                for bad in ("../secret", "/etc/passwd", "hair/../../x"):
                    with self.assertRaises(ToolError):
                        resources.inspect_resource("wildcard", bad)


class ModelInfoTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.cache = Path(self._dir.name)
        self.calls = []
        self.side = {"card": {"activation text": "trig"}, "civitai": {}}

    def tearDown(self):
        self._dir.cleanup()

    def info(self, responder):
        def handler(request):
            self.calls.append(str(request.url))
            return responder(request)

        return ModelInfo(
            cache_dir=self.cache,
            transport=httpx.MockTransport(handler),
            find=lambda kind, name: {"name": name, "title": name, "filename": "C:/models/x.safetensors"},
            sha256=lambda kind, item: SHA.upper(),
            sidecar=lambda filename: self.side,
        )

    @staticmethod
    def civitai(request):
        if "/by-hash/" in str(request.url):
            return httpx.Response(200, json={"id": 2, "modelId": 1, "name": "v1", "baseModel": "Illustrious", "trainedWords": ["aya"], "description": "<p>notes</p>"})
        return httpx.Response(200, json={"name": "Aya", "type": "LORA", "description": "<p>Use <b>CFG 5</b></p><ul><li>a</li></ul>", "tags": ["anime"]})

    def test_fetches_then_serves_from_cache(self):
        info = self.info(self.civitai)
        first = info.lookup("lora", "aya")
        self.assertEqual(first["source"], "civitai")
        self.assertEqual(first["base_model"], "Illustrious")
        self.assertEqual(first["trigger_words"], ["aya"])
        self.assertIn("CFG 5", first["description"])
        self.assertEqual(first["local_card"]["activation_text"], "trig")
        self.assertTrue(any(SHA in call for call in self.calls))
        self.assertTrue(all("models/x" not in call for call in self.calls))
        count = len(self.calls)
        second = info.lookup("lora", "aya")
        self.assertEqual((second["source"], len(self.calls)), ("cache", count))

    def test_miss_is_cached_and_offline_never_calls(self):
        info = self.info(lambda request: httpx.Response(404))
        self.assertEqual(info.lookup("checkpoint", "c")["source"], "none")
        count = len(self.calls)
        info.lookup("checkpoint", "c")
        self.assertEqual(len(self.calls), count)
        offline = self.info(self.civitai)
        offline.cache_dir = Path(self._dir.name) / "other"
        result = offline.lookup("checkpoint", "c", online=False)
        self.assertEqual(result["source"], "none")
        self.assertEqual(len(self.calls), count)

    def test_sidecar_civitai_info_wins(self):
        self.side = {"card": {}, "civitai": {"id": 9, "modelId": 3, "baseModel": "SDXL", "trainedWords": ["x"], "model": {"name": "M"}}}
        result = self.info(self.civitai).lookup("lora", "aya")
        self.assertEqual((result["source"], result["base_model"]), ("sidecar", "SDXL"))
        self.assertEqual(self.calls, [])

    def test_network_error(self):
        def fail(request):
            raise httpx.ConnectError("x")

        with self.assertRaises(ToolError):
            self.info(fail).lookup("lora", "aya")

    def test_html_to_text(self):
        self.assertEqual(html_to_text("<p>a &amp; b</p><ul><li>c</li></ul>"), "a & b\n- c")


class LayoutTest(unittest.TestCase):
    def test_source_files_stay_small(self):
        for path in [*ROOT.glob("prompt_agent/**/*.py"), *ROOT.glob("tests/*.py"), *ROOT.glob("frontend/src/**/*.*")]:
            with self.subTest(path=path.name):
                self.assertLessEqual(len(path.read_text(encoding="utf-8").splitlines()), 1000)


if __name__ == "__main__":
    unittest.main()
