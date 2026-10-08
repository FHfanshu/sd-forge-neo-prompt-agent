"""In-memory search index over local Forge resources: LoRA families, checkpoints, styles, wildcards.

Rebuilt only when the file listing (names, paths, mtimes) changes. Ranking is weighted keyword
matching; every hit reports which field matched so the agent can judge relevance.
"""

from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .. import forge
from . import lora_meta

KINDS = ("lora", "checkpoint", "style", "wildcard")
# field weights: names and triggers beat folders, folders beat training tags, tags beat prose
WEIGHTS = {"name": 6, "trigger": 6, "folder": 4, "concept": 3, "tag": 2, "text": 1}
PHRASE_SPLIT = re.compile(r"[,，、;；]+")


def _mtime(filename: str) -> float:
    try:
        return os.stat(filename).st_mtime
    except OSError:
        return 0.0


def _folder(filename: str, roots: list[Path]) -> str:
    path = Path(filename).resolve()
    for root in roots:
        try:
            return path.parent.relative_to(root.resolve()).as_posix().strip(".")
        except ValueError:
            continue
    return path.parent.name


def _date(filename: str) -> str:
    mtime = _mtime(filename)
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime)) if mtime else ""


def _lora_roots() -> list[Path]:
    try:
        from modules import shared

        return [Path(shared.cmd_opts.lora_dir)]
    except Exception:  # noqa: BLE001
        return [forge.FORGE_ROOT / "models" / "Lora"]


# parsed summaries keyed by (path, mtime): adding one LoRA does not re-parse the whole library
_SUMMARIES: dict[tuple[str, float], dict[str, Any]] = {}


def _summary(item: dict[str, Any]) -> dict[str, Any]:
    key = (item["filename"], _mtime(item["filename"]))
    if key not in _SUMMARIES:
        _SUMMARIES[key] = lora_meta.summarize(item["name"], item.get("metadata"))
    return _SUMMARIES[key]


def _lora_docs(loras: list[dict[str, Any]], roots: list[Path]) -> list[dict[str, Any]]:
    families: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in loras:
        summary = _summary(item)
        folder = _folder(item["filename"], roots)
        key = (folder, lora_meta.family_key(item["name"], summary["output_name"]))
        families.setdefault(key, []).append({**item, "summary": summary, "folder": folder})
    docs = []
    for (folder, _), members in families.items():
        members.sort(key=lambda m: (m["summary"]["training"].get("epoch") or 0, m["summary"]["training"].get("trained_at", ""), m["name"]))
        latest = members[-1]
        summary = latest["summary"]
        concept_tags = [tag for concept in summary["concepts"] for tag in concept["identity_tags"]]
        tags = [tag for concept in summary["concepts"] for tag in concept["_tags"][:40]]
        docs.append({
            "kind": "lora",
            "name": latest["name"],
            "family": summary["output_name"] or lora_meta.EPOCH_SUFFIX.sub("", latest["name"]),
            "folder": folder,
            "base_model": summary["base_model"],
            # file mtime stands in when the metadata has no training timestamp
            "trained_at": summary["training"].get("trained_at") or _date(latest["filename"]),
            "triggers": summary["trigger_candidates"],
            "versions": [{"name": m["name"], "epoch": m["summary"]["training"].get("epoch")} for m in members],
            "fields": {
                "name": [summary["output_name"], latest["alias"], *[m["name"] for m in members]],
                "trigger": summary["trigger_candidates"],
                "folder": [folder],
                "concept": [c["name"] for c in summary["concepts"]] + concept_tags,
                "tag": tags,
                "text": [summary["description"], summary["base_model"]],
            },
        })
    return docs


def build(loras: list[dict[str, Any]], checkpoints: list[dict[str, Any]], styles: list[dict[str, str]], wildcards: list[str],
          lora_roots: list[Path] | None = None) -> list[dict[str, Any]]:
    docs = _lora_docs(loras, lora_roots if lora_roots is not None else _lora_roots())
    for item in checkpoints:
        metadata = item.get("metadata") or {}
        base = str(metadata.get("modelspec.architecture") or metadata.get("ss_base_model_version") or "")
        docs.append({"kind": "checkpoint", "name": item["title"], "base_model": base,
                     "fields": {"name": [item["title"], item["model_name"]], "text": [base, str(metadata.get("modelspec.title") or "")]}})
    for style in styles:
        docs.append({"kind": "style", "name": style["name"], "preview": style["prompt"][:160],
                     "fields": {"name": [style["name"]], "tag": [t.strip() for t in style["prompt"].split(",")], "text": [style["negative_prompt"]]}})
    for name in wildcards:
        docs.append({"kind": "wildcard", "name": name, "token": f"__{name}__", "fields": {"name": [name], "folder": [name.rpartition("/")[0]]}})
    return docs


def _best(doc: dict[str, Any], term: str) -> tuple[str, str] | None:
    """Highest-weight field containing the term, with the matching value."""
    best = None
    for field, values in doc["fields"].items():
        value = next((v for v in values if v and term in str(v).casefold()), None)
        if value is not None and (best is None or WEIGHTS[field] > WEIGHTS[best[0]]):
            best = (field, str(value))
    return best


def _score(doc: dict[str, Any], phrases: list[str]) -> tuple[float, float, list[str]]:
    """Each comma-separated phrase counts once: whole-phrase hits beat hits on its separate words."""
    matched, score, reasons = 0.0, 0.0, []
    for phrase in phrases:
        best = _best(doc, phrase)
        if best:
            matched += 1
            score += WEIGHTS[best[0]] + 2 + (2 if best[1].casefold() == phrase else 0)
            reasons.append(f"{best[0]}: {best[1][:60]}")
            continue
        words = phrase.split()
        found = [hit for hit in (_best(doc, word) for word in words) if hit]
        if found:
            matched += len(found) / len(words)
            score += sum(WEIGHTS[field] for field, _ in found) / len(words)
            reasons.extend(f"{field}: {value[:60]}" for field, value in found)
    return matched, score, list(dict.fromkeys(reasons))


def search(docs: list[dict[str, Any]], query: str, kind: str = "", base_model: str = "", limit: int = 20, sort: str = "relevance") -> dict[str, Any]:
    phrases = [" ".join(p.split()).casefold() for p in PHRASE_SPLIT.split(str(query or "")) if p.strip()]
    base = base_model.casefold().strip()
    hits = []
    for doc in docs:
        if kind and doc["kind"] != kind:
            continue
        if base and base not in str(doc.get("base_model", "")).casefold():
            continue
        matched, score, reasons = _score(doc, phrases)
        if phrases and not matched:
            continue
        hits.append((matched, score, doc, reasons))
    # newest first among equal relevance; sort="newest" orders matches by training date only
    hits.sort(key=lambda hit: hit[2].get("trained_at", ""), reverse=True)
    if sort != "newest":
        hits.sort(key=lambda hit: (-hit[0], -hit[1]))
    full = [hit for hit in hits if hit[0] >= len(phrases)]
    chosen = full or hits  # fall back to partial matches only when nothing matches every phrase
    items = [_public(doc, reasons) for _, _, doc, reasons in chosen[:limit]]
    return {"ok": True, "query": query, "total": len(chosen), "partial": bool(phrases) and not full and bool(hits), "items": items}


def _public(doc: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    item = {key: value for key, value in doc.items() if key not in ("fields", "versions")}
    if doc["kind"] == "lora":
        item["triggers"] = doc["triggers"][:6]
        item["version_count"] = len(doc["versions"])
        item["usage"] = f"<lora:{doc['name']}:1>"
    if reasons:
        item["matched"] = reasons
    return {key: value for key, value in item.items() if value not in ("", [], None)}


class ResourceIndex:
    """Caches the built docs; rebuilds when the listings or any LoRA file's mtime changes."""

    def __init__(self, sources: Callable[[], tuple[list, list, list, list]] | None = None):
        self._sources = sources or _forge_sources
        self._lock = threading.Lock()
        self._signature: tuple | None = None
        self._docs: list[dict[str, Any]] = []

    def docs(self) -> list[dict[str, Any]]:
        loras, checkpoints, styles, wildcards = self._sources()
        signature = (
            tuple((l["name"], l["filename"], _mtime(l["filename"])) for l in loras),
            tuple(c["title"] for c in checkpoints),
            tuple((s["name"], s["prompt"], s["negative_prompt"]) for s in styles),
            tuple(wildcards),
        )
        with self._lock:
            if signature != self._signature:
                self._docs = build(loras, checkpoints, styles, wildcards)
                self._signature = signature
            return self._docs

    def find_lora(self, name: str) -> dict[str, Any] | None:
        wanted = name.strip().casefold()
        for doc in self.docs():
            if doc["kind"] != "lora":
                continue
            if wanted == doc["family"].casefold() or any(wanted == v["name"].casefold() for v in doc["versions"]):
                return doc
        return None


def _forge_sources() -> tuple[list, list, list, list]:
    from .resources import wildcard_names

    return forge.loras(), forge.checkpoints(), forge.styles(), wildcard_names(forge.wildcard_root())
