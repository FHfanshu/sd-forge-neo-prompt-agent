import base64
import contextlib
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI

from backend.prompt_agent.profile_contracts import normalize_profile
from prompt_agent import image_payloads
from quality.acceptance import acceptance


class SecurityBoundaryTests(unittest.TestCase):
    def test_extension_backend_namespace_does_not_shadow_forge_backend(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            forge_root = Path(directory)
            forge_backend = forge_root / "backend"
            forge_backend.mkdir()
            (forge_backend / "args.py").write_text("import argparse\nparser = argparse.ArgumentParser(prog='forge')\n", encoding="utf-8")
            self.assertFalse((root / "backend" / "__init__.py").exists())
            script = """
import sys
sys.path = [sys.argv[1], sys.argv[2]] + sys.path
from backend.args import parser
from backend.prompt_agent import API_PREFIX
print(parser.prog, API_PREFIX)
"""
            completed = subprocess.run(
                [sys.executable, "-c", script, str(root), str(forge_root)],
                text=True,
                capture_output=True,
            )
            self.assertEqual(0, completed.returncode, completed.stderr)
            self.assertIn("forge /prompt-agent/api", completed.stdout)

    def test_forge_script_registers_prompt_agent_api(self):
        script = Path(__file__).resolve().parents[1] / "scripts" / "prompt_agent.py"
        source = script.read_text(encoding="utf-8")
        self.assertIn("register_prompt_agent_api(app)", source)
        self.assertIn("script_callbacks.on_app_started", source)

    def test_forge_script_import_and_registration_do_not_create_dot_loom(self):
        root = Path(__file__).resolve().parents[1]
        marker = root / ".loom"
        callbacks = []
        gradio = types.ModuleType("gradio")
        gradio.Blocks = object
        modules = types.ModuleType("modules")
        modules.call_queue = types.SimpleNamespace(queue_lock=contextlib.nullcontext())
        modules.script_callbacks = types.SimpleNamespace(
            on_app_started=lambda callback, name=None: callbacks.append((callback, name))
        )
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ",
            {"SD_FORGE_NEO_PROMPT_AGENT_DATA": directory},
            clear=False,
        ), patch.dict(sys.modules, {"gradio": gradio, "modules": modules}):
            self.assertFalse(marker.exists())
            runpy.run_path(str(root / "scripts" / "prompt_agent.py"), run_name="prompt_agent_startup_test")
            self.assertEqual(1, len(callbacks))
            self.assertEqual("prompt-agent-api", callbacks[0][1])
            callbacks[0][0](None, FastAPI())
            self.assertFalse(marker.exists())

    @acceptance("SECURITY-PRIVACY-001@1", "path-rejection")
    def test_profile_fields_reject_local_paths_before_any_validation(self):
        base = {
            "id": "remote",
            "model_id": "model",
            "protocol": "openai-chat-completions",
            "runtime": "remote-http",
            "endpoint": "https://provider.invalid/v1",
        }
        for field in ("id", "model_id", "display_name"):
            with self.assertRaisesRegex(ValueError, "local path"):
                normalize_profile({**base, field: "C:/private/model.gguf"})

    def test_inline_image_rejects_decoded_payload_over_limit(self):
        raw = base64.b64encode(b"123456789").decode("ascii")
        with patch.object(image_payloads, "MAX_IMAGE_BYTES", 8):
            with self.assertRaisesRegex(RuntimeError, "too large"):
                image_payloads._data_url_inline_data("data:image/png;base64," + raw)

    def test_image_dimensions_are_checked_before_conversion(self):
        fake = MagicMock()
        fake.size = (5000, 5000)
        with patch.object(image_payloads.Image, "open", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "dimensions"):
                image_payloads._image_from_data_url("data:image/png;base64," + base64.b64encode(b"png").decode("ascii"))
        fake.convert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
