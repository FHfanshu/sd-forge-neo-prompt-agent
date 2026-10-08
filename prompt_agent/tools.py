"""Server-side agent tools. Names are always resolved against server-side listings, never used as paths."""

from __future__ import annotations

from typing import Any, Callable

from .common import ToolError
from .knowledge import characters, danbooru, resources, skills
from .knowledge.model_info import ModelInfo
from .profiles import CIVITAI_SECRET, ProfileStore
from .sessions import SessionStore


def _text(args: dict[str, Any], key: str, max_len: int = 200, required: bool = True, default: str = "") -> str:
    value = args.get(key, default)
    if value is None:
        value = default
    if not isinstance(value, str):
        raise ToolError("INVALID_ARGS", f"{key} 必须是字符串")
    value = value.strip()
    if required and not value:
        raise ToolError("INVALID_ARGS", f"缺少 {key}")
    if len(value) > max_len:
        raise ToolError("INVALID_ARGS", f"{key} 太长")
    return value


def _choice(args: dict[str, Any], key: str, options: tuple[str, ...], default: str | None = None) -> str:
    value = args.get(key, default)
    if value not in options:
        raise ToolError("INVALID_ARGS", f"{key} 只能是 {'、'.join(options)}")
    return value


def _int(args: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise ToolError("INVALID_ARGS", f"{key} 必须是整数")
    if not low <= int(value) <= high:
        raise ToolError("INVALID_ARGS", f"{key} 范围是 {low}–{high}")
    return int(value)


class Tools:
    def __init__(self, profiles: ProfileStore, sessions: SessionStore, model_info: ModelInfo | None = None):
        self.profiles = profiles
        self.sessions = sessions
        self.model_info = model_info or ModelInfo()
        self.handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
            "read_attachment": self.read_attachment,
            "search_resources": lambda a: resources.search_resources(
                _choice(a, "kind", ("", *resources.KINDS), ""), _text(a, "query", 200, required=False),
                _text(a, "base_model", 60, required=False), _int(a, "limit", 20, 1, 50),
            ),
            "inspect_resource": lambda a: resources.inspect_resource(_choice(a, "kind", resources.KINDS), _text(a, "name", 300)),
            "model_info": self.lookup_model,
            "danbooru_search": lambda a: danbooru.search(
                _text(a, "query", 160), _choice(a, "type", ("tag", "wiki"), "tag"), _text(a, "category", 32, required=False), _int(a, "limit", 10, 1, 30)
            ),
            "danbooru_inspect": lambda a: danbooru.inspect(a.get("names"), _choice(a, "type", ("tag", "wiki"), "tag")),
            "danbooru_related": lambda a: danbooru.related(_text(a, "name", 160), _text(a, "category", 32, required=False), _int(a, "limit", 15, 1, 30)),
            "load_skill": lambda a: skills.load_skill(_text(a, "name", 100), _text(a, "reference", 100, required=False)),
            "list_characters": lambda a: {"ok": True, "characters": characters.list_characters()},
            "get_character": lambda a: characters.get_character(_text(a, "name", 100)),
        }

    def run(self, name: str, args: Any) -> dict[str, Any]:
        handler = self.handlers.get(name)
        if handler is None:
            raise ToolError("NOT_FOUND", f"未知工具：{name}", status=404)
        if not isinstance(args, dict):
            raise ToolError("INVALID_ARGS", "参数必须是对象")
        result = handler(args)
        return result if isinstance(result, dict) and "ok" in result else {"ok": True, **(result if isinstance(result, dict) else {"result": result})}

    def read_attachment(self, args: dict[str, Any]) -> dict[str, Any]:
        attachment_id = _text(args, "attachment_id", 64)
        record = self.sessions.get_attachment(attachment_id)
        return {
            "ok": True,
            "attachment_id": attachment_id,
            "width": record["width"],
            "height": record["height"],
            "pnginfo": record["pnginfo"],
            "include_image": bool(args.get("include_image")),
        }

    def lookup_model(self, args: dict[str, Any]) -> dict[str, Any]:
        settings = self.profiles.settings()
        return self.model_info.lookup(
            _choice(args, "kind", ("checkpoint", "lora")),
            _text(args, "name", 400),
            refresh=bool(args.get("refresh")),
            online=settings["civitai_enabled"],
            api_key=self.profiles.api_key(CIVITAI_SECRET) if settings["has_civitai_key"] else "",
        )

    def context(self) -> dict[str, Any]:
        """Skill and character listings for the system prompt."""
        return {"skills": skills.list_skills(), "characters": characters.list_characters()}
