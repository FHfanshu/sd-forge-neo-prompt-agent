from __future__ import annotations

import logging
import sys
from pathlib import Path

from modules import script_callbacks

LOGGER = logging.getLogger("prompt_agent")
EXTENSION_ROOT = str(Path(__file__).resolve().parents[1])
if EXTENSION_ROOT not in sys.path:
    sys.path.append(EXTENSION_ROOT)

from prompt_agent.api import mount  # noqa: E402


def _on_app_started(_demo, app) -> None:
    try:
        mount(app)
        LOGGER.info("[prompt-agent] v2 API mounted at /prompt-agent/v2")
    except Exception:  # noqa: BLE001 - never break Forge startup
        LOGGER.exception("[prompt-agent] failed to mount API")


script_callbacks.on_app_started(_on_app_started, name="prompt-agent-v2")
