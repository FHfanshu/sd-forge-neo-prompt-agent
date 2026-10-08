from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from .common import ToolError, data_dir, new_id, read_json, write_json

REASONING_EFFORTS = ("", "low", "medium", "high")
CIVITAI_SECRET = "civitai"


def _default_protect(value: str) -> str:
    from .secrets import protect_text

    return protect_text(value)


def _default_unprotect(value: str) -> str:
    from .secrets import unprotect_text

    return unprotect_text(value)


def normalize_base_url(value: Any) -> str:
    url = str(value or "").strip().rstrip("/")
    url = re.sub(r"/chat/completions$", "", url)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ToolError("INVALID_ARGS", "Base URL 必须是 http:// 或 https:// 开头的地址")
    return url


def _validated(raw: dict[str, Any], profile_id: str) -> dict[str, Any]:
    name = str(raw.get("name") or "").strip()
    model = str(raw.get("model") or "").strip()
    if not 1 <= len(name) <= 40:
        raise ToolError("INVALID_ARGS", "名称需要 1–40 个字符")
    if not 1 <= len(model) <= 200:
        raise ToolError("INVALID_ARGS", "模型名需要 1–200 个字符")
    effort = str(raw.get("reasoning_effort") or "")
    if effort not in REASONING_EFFORTS:
        raise ToolError("INVALID_ARGS", "推理强度只能是 low、medium、high 或留空")
    temperature = raw.get("temperature")
    if temperature not in (None, ""):
        try:
            temperature = float(temperature)
        except (TypeError, ValueError):
            raise ToolError("INVALID_ARGS", "温度必须是数字") from None
        if not 0 <= temperature <= 2:
            raise ToolError("INVALID_ARGS", "温度范围是 0–2")
    else:
        temperature = None
    max_tokens = raw.get("max_tokens")
    if max_tokens not in (None, ""):
        try:
            max_tokens = int(max_tokens)
        except (TypeError, ValueError):
            raise ToolError("INVALID_ARGS", "最大输出长度必须是整数") from None
        if not 256 <= max_tokens <= 200_000:
            raise ToolError("INVALID_ARGS", "最大输出长度范围是 256–200000")
    else:
        max_tokens = None
    return {
        "id": profile_id,
        "name": name,
        "base_url": normalize_base_url(raw.get("base_url")),
        "model": model,
        "reasoning_effort": effort,
        "vision": bool(raw.get("vision")),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


class ProfileStore:
    """Profiles, settings and DPAPI-protected secrets under the data directory."""

    def __init__(
        self,
        root: Path | None = None,
        protect: Callable[[str], str] = _default_protect,
        unprotect: Callable[[str], str] = _default_unprotect,
    ):
        self.root = root or data_dir()
        self.profiles_path = self.root / "profiles-v2.json"
        self.secrets_path = self.root / "secrets-v2.dpapi.json"
        self.settings_path = self.root / "settings-v2.json"
        self._protect = protect
        self._unprotect = unprotect
        self._lock = threading.Lock()
        self.import_report: dict[str, int] | None = None
        self._import_legacy()

    # -- state -------------------------------------------------------------
    def _state(self) -> dict[str, Any]:
        state = read_json(self.profiles_path, {})
        profiles = [p for p in state.get("profiles", []) if isinstance(p, dict) and p.get("id")]
        return {"profiles": profiles, "default_id": state.get("default_id") or ""}

    def _secrets(self) -> dict[str, str]:
        value = read_json(self.secrets_path, {})
        return {k: v for k, v in value.items() if isinstance(v, str)} if isinstance(value, dict) else {}

    def _import_legacy(self) -> None:
        legacy = self.root / "profiles.json"
        if self.profiles_path.exists() or not legacy.exists():
            return
        old = read_json(legacy, {})
        old_secrets = read_json(self.root / "secrets.dpapi.json", {})
        imported, skipped, secrets = [], 0, {}
        for item in old.get("profiles", []) if isinstance(old, dict) else []:
            if not isinstance(item, dict) or item.get("protocol") != "openai-chat-completions":
                skipped += 1
                continue
            params = item.get("parameters") or {}
            effort = str(params.get("reasoning_effort") or "")
            try:
                profile = _validated(
                    {
                        "name": str(item.get("display_name") or item.get("model_id") or "导入的配置")[:40],
                        "base_url": item.get("endpoint"),
                        "model": item.get("model_id"),
                        "reasoning_effort": effort if effort in REASONING_EFFORTS else "",
                        "vision": (item.get("capabilities") or {}).get("vision", False),
                        "temperature": params.get("temperature"),
                        "max_tokens": params.get("max_tokens"),
                    },
                    str(item.get("profile_id") or new_id("p-")),
                )
            except ToolError:
                skipped += 1
                continue
            imported.append(profile)
            cipher = old_secrets.get(item.get("profile_id")) if isinstance(old_secrets, dict) else None
            if isinstance(cipher, str):
                secrets[profile["id"]] = cipher
        active = old.get("active_profile_id") if isinstance(old, dict) else ""
        ids = [p["id"] for p in imported]
        write_json(self.secrets_path, secrets)
        write_json(self.profiles_path, {"profiles": imported, "default_id": active if active in ids else (ids[0] if ids else "")})
        self.import_report = {"imported": len(imported), "skipped": skipped}

    # -- profiles ----------------------------------------------------------
    def list(self) -> dict[str, Any]:
        state, secrets = self._state(), self._secrets()
        profiles = [{**p, "has_api_key": p["id"] in secrets} for p in state["profiles"]]
        ids = [p["id"] for p in profiles]
        default = state["default_id"] if state["default_id"] in ids else (ids[0] if ids else "")
        return {"profiles": profiles, "default_id": default, "import_report": self.import_report}

    def get(self, profile_id: str) -> dict[str, Any]:
        for profile in self._state()["profiles"]:
            if profile["id"] == profile_id:
                return profile
        raise ToolError("NOT_FOUND", "找不到这个模型配置", status=404)

    def upsert(self, profile_id: str | None, raw: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._state()
            profile_id = profile_id or new_id("p-")
            profile = _validated(raw, profile_id)
            others = [p for p in state["profiles"] if p["id"] != profile_id]
            existing = len(others) != len(state["profiles"])
            profiles = [profile if p["id"] == profile_id else p for p in state["profiles"]] if existing else [*others, profile]
            if "api_key" in raw and raw["api_key"] is not None:
                self._set_secret(profile_id, str(raw["api_key"]).strip())
            default = state["default_id"] or profile_id
            write_json(self.profiles_path, {"profiles": profiles, "default_id": default})
        return {**profile, "has_api_key": profile_id in self._secrets()}

    def delete(self, profile_id: str) -> None:
        with self._lock:
            state = self._state()
            profiles = [p for p in state["profiles"] if p["id"] != profile_id]
            default = state["default_id"] if state["default_id"] != profile_id else (profiles[0]["id"] if profiles else "")
            write_json(self.profiles_path, {"profiles": profiles, "default_id": default})
            self._set_secret(profile_id, "")

    def set_default(self, profile_id: str) -> None:
        with self._lock:
            state = self._state()
            if profile_id not in [p["id"] for p in state["profiles"]]:
                raise ToolError("NOT_FOUND", "找不到这个模型配置", status=404)
            write_json(self.profiles_path, {**state, "default_id": profile_id})

    # -- secrets -----------------------------------------------------------
    def _set_secret(self, key: str, value: str) -> None:
        secrets = self._secrets()
        if value:
            if os.name != "nt" and self._protect is _default_protect:
                raise ToolError("UNSUPPORTED", "仅支持 Windows 加密存储 API Key")
            secrets[key] = self._protect(value)
        else:
            secrets.pop(key, None)
        write_json(self.secrets_path, secrets)

    def api_key(self, key: str) -> str:
        cipher = self._secrets().get(key)
        if not cipher:
            return ""
        try:
            return self._unprotect(cipher)
        except Exception:  # noqa: BLE001 - never leak cipher details
            raise ToolError("SECRET", "无法解密已保存的 API Key，请重新填写", status=500) from None

    # -- settings ----------------------------------------------------------
    def settings(self) -> dict[str, Any]:
        value = read_json(self.settings_path, {})
        return {
            "civitai_enabled": bool(value.get("civitai_enabled", True)) if isinstance(value, dict) else True,
            "has_civitai_key": CIVITAI_SECRET in self._secrets(),
        }

    def update_settings(self, raw: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            current = read_json(self.settings_path, {})
            current = current if isinstance(current, dict) else {}
            if "civitai_enabled" in raw:
                current["civitai_enabled"] = bool(raw["civitai_enabled"])
            write_json(self.settings_path, current)
            if "civitai_api_key" in raw and raw["civitai_api_key"] is not None:
                self._set_secret(CIVITAI_SECRET, str(raw["civitai_api_key"]).strip())
        return self.settings()
