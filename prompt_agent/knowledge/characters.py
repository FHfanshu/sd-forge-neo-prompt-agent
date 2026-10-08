from __future__ import annotations

from pathlib import Path
from typing import Any

from ..common import EXTENSION_ROOT, ToolError, read_json

CHARACTERS_ROOT = EXTENSION_ROOT / "character-definitions"


def _definitions(root: Path) -> dict[str, dict[str, Any]]:
    result = {}
    for path in sorted(root.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = read_json(path, None)
        if isinstance(data, dict):
            result[str(data.get("name") or path.stem)] = {"data": data, "stem": path.stem}
    return result


def list_characters(root: Path = CHARACTERS_ROOT) -> list[dict[str, str]]:
    return [{"name": name, "short_description": str(item["data"].get("short_description") or "")} for name, item in _definitions(root).items()]


def get_character(name: str, root: Path = CHARACTERS_ROOT) -> dict[str, Any]:
    definitions = _definitions(root)
    wanted = str(name or "").strip().casefold()
    match = next((item for key, item in definitions.items() if key.casefold() == wanted), None)
    if match is None:
        raise ToolError("NOT_FOUND", f"没有这个角色：{name}", available=list(definitions))
    bindings = []
    for path in sorted((root / "bindings").glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = read_json(path, None)
        if isinstance(data, dict) and (path.stem.startswith(match["stem"] + "-") or path.stem == match["stem"] or str(data.get("character", "")).casefold() == wanted):
            bindings.append({"file": path.name, **data})
    return {"ok": True, **match["data"], "bindings": bindings}
