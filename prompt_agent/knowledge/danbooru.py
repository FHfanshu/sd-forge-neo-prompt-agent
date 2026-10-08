"""Thin wrapper over the shared danbooru-tools client (single implementation, not copied)."""

from __future__ import annotations

import sys
import threading
import time
from typing import Any, Callable

from ..common import EXTENSION_ROOT, ToolError

_TTL = 3600
_cache: dict[tuple, tuple[float, Any]] = {}
_lock = threading.Lock()


def _client():
    root = str(EXTENSION_ROOT / "danbooru-tools")
    if root not in sys.path:
        sys.path.insert(0, root)
    import danbooru_tools

    return danbooru_tools


def _cached(key: tuple, call: Callable[[], Any]) -> Any:
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _TTL:
            return hit[1]
    try:
        value = call()
    except ValueError as error:
        raise ToolError("INVALID_ARGS", str(error)) from None
    except (OSError, RuntimeError) as error:
        raise ToolError("NETWORK", f"Danbooru 查询失败：{error}") from None
    with _lock:
        if len(_cache) > 500:
            _cache.clear()
        _cache[key] = (time.time(), value)
    return value


def _names(value: Any) -> list[str]:
    names = [str(item).strip() for item in (value if isinstance(value, list) else [value]) if str(item or "").strip()]
    if not 1 <= len(names) <= 12:
        raise ToolError("INVALID_ARGS", "names 需要 1–12 个")
    return names


def search(query: str, type: str = "tag", category: str = "", limit: int = 10) -> dict[str, Any]:
    client = _client()
    limit = max(1, min(int(limit or 10), 30))
    if type == "wiki":
        return _cached(("sw", query, limit), lambda: client.search_danbooru_wikis(query=query, limit=limit))
    return _cached(("st", query, category, limit), lambda: client.search_danbooru_tags(query=query, category=category, limit=limit))


def inspect(names: Any, type: str = "tag") -> dict[str, Any]:
    client = _client()
    values = _names(names)
    if type == "wiki":
        return _cached(("iw", tuple(values)), lambda: client.inspect_danbooru_wikis(values))
    return _cached(("it", tuple(values)), lambda: client.inspect_danbooru_tags(values, include_wiki=True))


def related(name: str, category: str = "", limit: int = 15) -> dict[str, Any]:
    client = _client()
    limit = max(1, min(int(limit or 15), 30))
    return _cached(("rt", name, category, limit), lambda: client.related_danbooru_tags(name, category=category, limit=limit))
