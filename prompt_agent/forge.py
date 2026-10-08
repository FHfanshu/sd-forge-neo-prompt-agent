"""Read-only access to Forge internals. All Forge imports are lazy so tests run without Forge."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .common import FORGE_ROOT, ToolError, read_json


def generation_options() -> dict[str, list[str]]:
    from modules import sd_samplers, sd_schedulers, shared, shared_items

    try:
        from modules_forge.presets import PresetArch

        presets = PresetArch.choices()
    except Exception:  # noqa: BLE001
        presets = []
    use_short = bool(getattr(shared.opts, "sd_checkpoint_dropdown_use_short", False))
    return {
        "sampler": [x.name for x in sd_samplers.visible_samplers()],
        "scheduler": [x.label for x in sd_schedulers.schedulers],
        "hr_upscaler": [*shared.latent_upscale_modes, *[x.name for x in shared.sd_upscalers]],
        "checkpoint": sorted(shared_items.list_checkpoint_tiles(use_short)),
        "preset": presets,
    }


def styles() -> list[dict[str, str]]:
    from modules import shared

    result = []
    for style in getattr(getattr(shared, "prompt_styles", None), "styles", {}).values():
        name = str(getattr(style, "name", "") or "")
        if name:
            result.append({"name": name, "prompt": str(style.prompt or ""), "negative_prompt": str(style.negative_prompt or "")})
    return sorted(result, key=lambda item: item["name"].casefold())


def loras() -> list[dict[str, Any]]:
    import networks

    result = []
    for name, entry in networks.available_networks.items():
        result.append({
            "name": str(name),
            "alias": str(getattr(entry, "alias", name) or name),
            "filename": str(entry.filename),
            "metadata": getattr(entry, "metadata", {}) or {},
        })
    return sorted(result, key=lambda item: item["name"].casefold())


def checkpoints() -> list[dict[str, Any]]:
    from modules import sd_models

    return [
        {"name": info.name, "title": info.title, "model_name": info.model_name, "filename": str(info.filename)}
        for info in sd_models.checkpoints_list.values()
    ]


def find_model(kind: str, name: str) -> dict[str, Any]:
    wanted = str(name or "").strip().casefold()
    items = checkpoints() if kind == "checkpoint" else loras() if kind == "lora" else None
    if items is None:
        raise ToolError("INVALID_ARGS", "kind 只能是 checkpoint 或 lora")
    keys = ("title", "name", "model_name") if kind == "checkpoint" else ("name", "alias")
    for item in items:
        if any(str(item.get(key, "")).casefold() == wanted for key in keys):
            return item
    raise ToolError("NOT_FOUND", f"Forge 中没有这个 {kind}：{name}")


def model_sha256(kind: str, item: dict[str, Any]) -> str:
    """Full-file SHA-256 through Forge's hash cache (computed once if missing)."""
    from modules import hashes

    title = f"checkpoint/{item['name']}" if kind == "checkpoint" else f"lora/{item['name']}"
    return str(hashes.sha256(item["filename"], title, use_addnet_hash=False) or "")


def sidecar(filename: str) -> dict[str, Any]:
    """Forge extra-network card JSON and Civitai Helper style .civitai.info next to a model file."""
    base = os.path.splitext(filename)[0]
    card = read_json(Path(base + ".json"), {})
    civitai = read_json(Path(base + ".civitai.info"), {})
    return {"card": card if isinstance(card, dict) else {}, "civitai": civitai if isinstance(civitai, dict) else {}}


def wildcard_root() -> Path:
    try:
        from modules import shared

        configured = getattr(shared.opts, "wildcard_dir", None)
    except Exception:  # noqa: BLE001
        configured = None
    return Path(configured) if configured else FORGE_ROOT / "extensions" / "sd-dynamic-prompts" / "wildcards"
