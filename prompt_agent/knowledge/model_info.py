from __future__ import annotations

import html
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from .. import forge
from ..common import ToolError, clip, data_dir, read_json, write_json

CIVITAI_API = "https://civitai.com/api/v1"
MISS_TTL_SECONDS = 7 * 24 * 3600
DESCRIPTION_LIMIT = 6000


def html_to_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>|</div>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "- ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _from_civitai(version: dict[str, Any], model: dict[str, Any] | None) -> dict[str, Any]:
    model = model or version.get("model") or {}
    model_id = version.get("modelId") or model.get("id")
    return {
        "model_name": str(model.get("name") or ""),
        "version_name": str(version.get("name") or ""),
        "type": str(model.get("type") or ""),
        "base_model": str(version.get("baseModel") or ""),
        "trigger_words": [str(word) for word in version.get("trainedWords") or [] if word],
        "tags": [str(tag.get("name") if isinstance(tag, dict) else tag) for tag in model.get("tags") or []][:30],
        "description": clip(html_to_text(model.get("description")), DESCRIPTION_LIMIT),
        "version_notes": clip(html_to_text(version.get("description")), 2000),
        "url": f"https://civitai.com/models/{model_id}?modelVersionId={version.get('id')}" if model_id else "",
    }


class ModelInfo:
    def __init__(
        self,
        cache_dir: Path | None = None,
        transport: httpx.BaseTransport | None = None,
        find: Callable[[str, str], dict[str, Any]] = forge.find_model,
        sha256: Callable[[str, dict[str, Any]], str] = forge.model_sha256,
        sidecar: Callable[[str], dict[str, Any]] = forge.sidecar,
    ):
        self.cache_dir = cache_dir or data_dir() / "model-info"
        self.transport = transport
        self._find, self._sha256, self._sidecar = find, sha256, sidecar

    def _cache_path(self, sha: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}", sha):
            raise ToolError("INTERNAL", "哈希格式不正确")
        return self.cache_dir / f"{sha}.json"

    def _fetch(self, sha: str, api_key: str) -> dict[str, Any] | None:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        with httpx.Client(timeout=15.0, transport=self.transport, headers=headers) as client:
            try:
                response = client.get(f"{CIVITAI_API}/model-versions/by-hash/{sha}")
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                version = response.json()
                model = None
                if version.get("modelId"):
                    model_response = client.get(f"{CIVITAI_API}/models/{version['modelId']}")
                    if model_response.status_code < 400:
                        model = model_response.json()
            except httpx.HTTPError as error:
                raise ToolError("NETWORK", f"Civitai 查询失败：{type(error).__name__}") from None
            except ValueError:
                raise ToolError("NETWORK", "Civitai 返回了无法解析的数据") from None
        return _from_civitai(version, model)

    def lookup(self, kind: str, name: str, refresh: bool = False, online: bool = True, api_key: str = "") -> dict[str, Any]:
        item = self._find(kind, name)
        side = self._sidecar(item["filename"])
        card = side["card"]
        local = {
            "activation_text": clip(card.get("activation text"), 2000),
            "preferred_weight": card.get("preferred weight") or None,
            "notes": clip(html_to_text(card.get("notes") or card.get("description")), 2000),
        }
        local = {key: value for key, value in local.items() if value}
        base = {"ok": True, "kind": kind, "name": item.get("title") or item["name"], "local_card": local}

        if side["civitai"] and not refresh:
            return {**base, "source": "sidecar", **_from_civitai(side["civitai"], None)}

        sha = self._sha256(kind, item).lower()
        if not sha:
            return {**base, "source": "none", "message": "无法计算模型哈希"}
        path = self._cache_path(sha)
        cached = read_json(path, None)
        if isinstance(cached, dict) and not refresh:
            if cached.get("found"):
                return {**base, "source": "cache", "sha256": sha, **cached["info"]}
            if time.time() - cached.get("fetched_at", 0) < MISS_TTL_SECONDS or not online:
                return {**base, "source": "none", "sha256": sha, "message": "Civitai 上没有找到这个模型（已缓存）"}
        if not online:
            return {**base, "source": "none", "sha256": sha, "message": "本地没有记录，且已关闭 Civitai 联网查询"}
        info = self._fetch(sha, api_key)
        write_json(path, {"found": info is not None, "fetched_at": time.time(), "info": info})
        if info is None:
            return {**base, "source": "none", "sha256": sha, "message": "Civitai 上没有找到这个模型"}
        return {**base, "source": "civitai", "sha256": sha, **info}
