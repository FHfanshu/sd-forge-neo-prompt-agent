"""Summaries of kohya/sd-scripts training metadata embedded in LoRA safetensors headers."""

from __future__ import annotations

import json
import re
from typing import Any

# kohya saves intermediate epochs as name-000001; some trainers use _e12 / -epoch12
EPOCH_SUFFIX = re.compile(r"(?:-(\d{6})|[-_]e(?:poch)?(\d{1,4}))$", re.IGNORECASE)
CONCEPT_DIR = re.compile(r"^\d+_(.+)$")
# tags present in at least this share of a concept's images describe that concept's identity
IDENTITY_SHARE = 0.8
TOP_TAGS = 25


def _json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if isinstance(value, str) and value.strip()[:1] in "{[" else None
    except ValueError:
        return None


def _clean_tag(tag: Any) -> str:
    return str(tag).replace("﻿", "").strip()


def _number(value: Any) -> int | float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def family_key(name: str, output_name: str = "") -> str:
    """Training run identity: the output name, or the file stem with its epoch suffix removed."""
    return (output_name or EPOCH_SUFFIX.sub("", name)).strip().casefold()


def epoch_of(name: str, metadata: dict[str, Any]) -> int | None:
    epoch = _number(metadata.get("ss_epoch"))
    if isinstance(epoch, int):
        return epoch
    match = EPOCH_SUFFIX.search(name)
    return int(match.group(1) or match.group(2)) if match else None


def _network_type(metadata: dict[str, Any]) -> str:
    module = str(metadata.get("ss_network_module") or "")
    args = _json(metadata.get("ss_network_args")) or {}
    if "lokr" in module or args.get("algo") == "lokr":
        return "LoKr"
    if "lycoris" in module:
        return f"LyCORIS/{args.get('algo') or 'lycoris'}"
    return "LoRA" if module or metadata.get("ss_network_dim") else ""


def concepts(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    """One entry per training folder: image count and its most frequent tags."""
    frequency = _json(metadata.get("ss_tag_frequency")) or {}
    dirs = _json(metadata.get("ss_dataset_dirs")) or {}
    result = []
    for folder, tags in frequency.items():
        if not isinstance(tags, dict):
            continue
        counts: dict[str, int] = {}
        for tag, count in tags.items():
            clean = _clean_tag(tag)
            if clean:
                counts[clean] = counts.get(clean, 0) + int(_number(count) or 0)
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        info = dirs.get(folder) if isinstance(dirs.get(folder), dict) else {}
        images = int(_number(info.get("img_count")) or 0) or (ranked[0][1] if ranked else 0)
        match = CONCEPT_DIR.match(str(folder))
        name = (match.group(1) if match else str(folder)).strip()
        identity = [tag for tag, count in ranked if images and count >= images * IDENTITY_SHARE]
        result.append({
            "folder": str(folder),
            "name": name,
            "images": images,
            "repeats": _number(info.get("n_repeats")),
            "identity_tags": identity[:15],
            "top_tags": [f"{tag} ({count})" for tag, count in ranked[:TOP_TAGS]],
            "_tags": [tag for tag, _ in ranked],
        })
    return result


def trigger_candidates(metadata: dict[str, Any], found: list[dict[str, Any]]) -> list[str]:
    """Likely trigger words: explicit metadata first, then concept names that were also used as tags."""
    candidates: list[str] = []
    for key in ("modelspec.trigger_phrase", "ss_trigger_words"):
        value = metadata.get(key)
        if value:
            candidates.extend(part.strip() for part in str(value).split(",") if part.strip())
    for concept in found:
        lowered = {tag.casefold(): tag for tag in concept["_tags"]}
        name = concept["name"].casefold()
        if name in lowered:
            candidates.append(lowered[name])
    seen: set[str] = set()
    return [c for c in candidates if not (c.casefold() in seen or seen.add(c.casefold()))]


def summarize(name: str, metadata: dict[str, Any] | None) -> dict[str, Any]:
    metadata = metadata or {}
    found = concepts(metadata)
    training = {
        "network": _network_type(metadata),
        "dim": _number(metadata.get("ss_network_dim")),
        "alpha": _number(metadata.get("ss_network_alpha")),
        "epoch": epoch_of(name, metadata),
        "steps": _number(metadata.get("ss_steps")),
        "learning_rate": _number(metadata.get("ss_learning_rate")),
        "resolution": str(metadata.get("modelspec.resolution") or metadata.get("ss_resolution") or ""),
        "train_images": _number(metadata.get("ss_num_train_images")),
        "trained_on": str(metadata.get("ss_sd_model_name") or ""),
        "comment": "" if str(metadata.get("ss_training_comment") or "") in ("", "None") else str(metadata["ss_training_comment"])[:500],
    }
    return {
        "output_name": str(metadata.get("ss_output_name") or metadata.get("modelspec.title") or ""),
        "base_model": str(metadata.get("ss_base_model_version") or metadata.get("modelspec.architecture") or ""),
        "description": str(metadata.get("modelspec.description") or "")[:1000],
        "trigger_candidates": trigger_candidates(metadata, found),
        "training": {key: value for key, value in training.items() if value not in (None, "")},
        "concepts": found,
    }


def public_concepts(found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in concept.items() if not key.startswith("_")} for concept in found]
