from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

EXTENSION_ROOT = Path(__file__).resolve().parents[1]
FORGE_ROOT = EXTENSION_ROOT.parents[1]


def data_dir() -> Path:
    configured = os.environ.get("SD_FORGE_NEO_PROMPT_AGENT_DATA")
    root = Path(configured).expanduser().resolve() if configured else EXTENSION_ROOT / "data" / "prompt-agent"
    root.mkdir(parents=True, exist_ok=True)
    return root


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        return default


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


class ToolError(Exception):
    """A tool or API failure that is safe to show to the model and the user."""

    def __init__(self, code: str, message: str, status: int = 400, **extra: Any):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra

    def payload(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.extra}


def clip(text: Any, limit: int) -> str:
    value = str(text or "")
    return value if len(value) <= limit else value[: limit - 1] + "…"
