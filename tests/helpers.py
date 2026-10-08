from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from PIL import Image, PngImagePlugin  # noqa: E402

from prompt_agent.profiles import ProfileStore  # noqa: E402
from prompt_agent.sessions import SessionStore  # noqa: E402


def fake_protect(value: str) -> str:
    return "enc:" + value[::-1]


def fake_unprotect(value: str) -> str:
    assert value.startswith("enc:")
    return value[4:][::-1]


class TempData:
    def __init__(self):
        self._dir = tempfile.TemporaryDirectory()
        self.root = Path(self._dir.name)

    def profiles(self) -> ProfileStore:
        return ProfileStore(self.root, protect=fake_protect, unprotect=fake_unprotect)

    def sessions(self) -> SessionStore:
        return SessionStore(self.root)

    def cleanup(self):
        self._dir.cleanup()


def png_bytes(parameters: str | None = None, size=(64, 48)) -> bytes:
    image = Image.new("RGB", size, (200, 30, 30))
    info = PngImagePlugin.PngInfo()
    if parameters:
        info.add_text("parameters", parameters)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()
