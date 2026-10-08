from __future__ import annotations

from pathlib import Path
from typing import Any

from .. import forge
from ..common import ToolError, clip
from . import lora_meta
from .index import KINDS, ResourceIndex, search

INDEX = ResourceIndex()


def wildcard_names(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    names = [path.relative_to(root).with_suffix("").as_posix() for path in root.rglob("*.txt")]
    return sorted(names, key=str.casefold)


def search_resources(kind: str = "", query: str = "", base_model: str = "", limit: int = 20, index: ResourceIndex = INDEX) -> dict[str, Any]:
    if kind and kind not in KINDS:
        raise ToolError("INVALID_ARGS", f"kind 只能是 {'、'.join(KINDS)}，或留空搜索全部")
    return search(index.docs(), query, kind, base_model, max(1, min(int(limit or 20), 50)))


def _lora_detail(doc: dict[str, Any]) -> dict[str, Any]:
    items = {item["name"]: item for item in forge.loras()}
    item = items.get(doc["name"])
    if item is None:
        raise ToolError("NOT_FOUND", f"没有这个 LoRA：{doc['name']}")
    summary = lora_meta.summarize(item["name"], item.get("metadata"))
    card = forge.sidecar(item["filename"])["card"]
    local_card = {
        "activation_text": clip(card.get("activation text"), 2000),
        "negative_text": clip(card.get("negative text"), 2000),
        "preferred_weight": card.get("preferred weight") or None,
        "notes": clip(card.get("notes") or card.get("description"), 2000),
    }
    return {
        "ok": True,
        "kind": "lora",
        "name": item["name"],
        "family": doc["family"],
        "folder": doc["folder"],
        "usage": f"<lora:{item['name']}:1>",
        "base_model": summary["base_model"],
        "trigger_candidates": summary["trigger_candidates"],
        "local_card": {key: value for key, value in local_card.items() if value},
        "training": summary["training"],
        "concepts": lora_meta.public_concepts(summary["concepts"]),
        "description": summary["description"],
        "versions": doc["versions"],
        "note": "trigger_candidates 由训练元数据推断：概念文件夹名同时出现在训练标签里即视为触发词；identity_tags 是该概念几乎每张训练图都有的标签。这些就是本地能拿到的全部信息；只有从 Civitai 下载的模型才值得再用 model_info 查作者说明，本地训练的不用查。",
    }


def inspect_resource(kind: str, name: str, index: ResourceIndex = INDEX) -> dict[str, Any]:
    wanted = str(name or "").strip()
    if kind == "style":
        for style in forge.styles():
            if style["name"].strip().casefold() == wanted.casefold():
                return {"ok": True, "kind": kind, **style}
        raise ToolError("NOT_FOUND", f"没有这个 style：{wanted}")
    if kind == "lora":
        doc = index.find_lora(wanted)
        if doc is None:
            raise ToolError("NOT_FOUND", f"没有这个 LoRA：{wanted}。先用 search_resources 搜索")
        if wanted.casefold() != doc["family"].casefold():
            doc = {**doc, "name": next(v["name"] for v in doc["versions"] if v["name"].casefold() == wanted.casefold())}
        return _lora_detail(doc)
    if kind == "checkpoint":
        item = forge.find_model("checkpoint", wanted)
        metadata = item.get("metadata") or {}
        return {
            "ok": True,
            "kind": kind,
            "name": item["title"],
            "base_model": str(metadata.get("modelspec.architecture") or metadata.get("ss_base_model_version") or ""),
            "metadata_title": str(metadata.get("modelspec.title") or ""),
            "note": "底模、推荐参数和作者说明用 model_info 查询。",
        }
    if kind == "wildcard":
        root = forge.wildcard_root()
        token = wanted[2:-2] if wanted.startswith("__") and wanted.endswith("__") else wanted
        names = {n.casefold(): n for n in wildcard_names(root)}
        resolved = names.get(token.replace("\\", "/").casefold())
        if resolved is None:
            raise ToolError("NOT_FOUND", f"没有这个 wildcard：{wanted}")
        lines = (root / f"{resolved}.txt").read_text(encoding="utf-8-sig", errors="replace").splitlines()
        values = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
        return {"ok": True, "kind": kind, "name": resolved, "token": f"__{resolved}__", "total": len(values), "values": values[:100]}
    raise ToolError("INVALID_ARGS", f"kind 只能是 {'、'.join(KINDS)}")
