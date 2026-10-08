from __future__ import annotations

from pathlib import Path
from typing import Any

from .. import forge
from ..common import ToolError, clip

KINDS = ("style", "lora", "wildcard")


def _matches(query: str, *values: Any) -> bool:
    terms = [term.casefold() for term in str(query or "").split() if term]
    haystack = "\n".join(str(value or "") for value in values).casefold()
    return all(term in haystack for term in terms)


def _wildcard_names(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    names = [path.relative_to(root).with_suffix("").as_posix() for path in root.rglob("*.txt")]
    return sorted(names, key=str.casefold)


def _lora_card(item: dict[str, Any]) -> dict[str, Any]:
    card = forge.sidecar(item["filename"])["card"]
    metadata = item.get("metadata") or {}
    return {
        "name": item["name"],
        "alias": item["alias"],
        "base_model": str(card.get("sd version") or metadata.get("ss_base_model_version") or ""),
        "activation_text": clip(card.get("activation text"), 2000),
        "negative_text": clip(card.get("negative text"), 2000),
        "preferred_weight": card.get("preferred weight") or None,
        "notes": clip(card.get("notes") or card.get("description"), 2000),
    }


def search_resources(kind: str, query: str = "", limit: int = 20) -> dict[str, Any]:
    if kind not in KINDS:
        raise ToolError("INVALID_ARGS", "kind 只能是 style、lora、wildcard")
    limit = max(1, min(int(limit or 20), 50))
    if kind == "style":
        items = [
            {"name": s["name"], "summary": clip(s["prompt"], 200)}
            for s in forge.styles() if _matches(query, s["name"], s["prompt"], s["negative_prompt"])
        ]
    elif kind == "lora":
        items = [
            {"name": l["name"], "summary": l["alias"] if l["alias"] != l["name"] else ""}
            for l in forge.loras() if _matches(query, l["name"], l["alias"])
        ]
    else:
        items = [{"name": n, "summary": f"__{n}__"} for n in _wildcard_names(forge.wildcard_root()) if _matches(query, n)]
    return {"ok": True, "kind": kind, "total": len(items), "items": items[:limit]}


def inspect_resource(kind: str, name: str) -> dict[str, Any]:
    wanted = str(name or "").strip()
    if kind == "style":
        for style in forge.styles():
            if style["name"].casefold() == wanted.casefold():
                return {"ok": True, "kind": kind, **style}
        raise ToolError("NOT_FOUND", f"没有这个 style：{wanted}")
    if kind == "lora":
        for item in forge.loras():
            if wanted.casefold() in (item["name"].casefold(), item["alias"].casefold()):
                return {"ok": True, "kind": kind, **_lora_card(item)}
        raise ToolError("NOT_FOUND", f"没有这个 LoRA：{wanted}")
    if kind == "wildcard":
        root = forge.wildcard_root()
        token = wanted[2:-2] if wanted.startswith("__") and wanted.endswith("__") else wanted
        names = {n.casefold(): n for n in _wildcard_names(root)}
        resolved = names.get(token.replace("\\", "/").casefold())
        if resolved is None:
            raise ToolError("NOT_FOUND", f"没有这个 wildcard：{wanted}")
        lines = (root / f"{resolved}.txt").read_text(encoding="utf-8-sig", errors="replace").splitlines()
        values = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
        return {"ok": True, "kind": kind, "name": resolved, "token": f"__{resolved}__", "total": len(values), "values": values[:100]}
    raise ToolError("INVALID_ARGS", "kind 只能是 style、lora、wildcard")
