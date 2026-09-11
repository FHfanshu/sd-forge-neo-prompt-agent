from __future__ import annotations

import io
import re
from typing import Any

from PIL import Image

MAX_METADATA_TEXT = 1024 * 1024
JS_SAFE_INTEGER = 2**53

_PARAM_SPLIT_RE = re.compile(r",\s*(?=[A-Za-z][A-Za-z0-9 _./-]*:)")
_PARAM_KEYS = {
    "steps": "steps",
    "sampler": "sampler",
    "scheduler": "scheduler",
    "cfg scale": "cfg_scale",
    "seed": "seed",
    "size": "size",
    "model hash": "model_hash",
    "model": "model",
    "vae hash": "vae_hash",
    "vae": "vae",
    "clip skip": "clip_skip",
    "denoising strength": "denoising_strength",
    "hires upscale": "hires_upscale",
    "hires upscaler": "hires_upscaler",
    "hires steps": "hires_steps",
    "face restoration": "face_restoration",
    "lora hashes": "lora_hashes",
    "version": "version",
}
_INT_KEYS = {"steps": "steps", "clip skip": "clip_skip", "hires steps": "hires_steps"}


def _coerce_seed(value: str) -> int | str:
    text = value.strip()
    if not re.fullmatch(r"-?\d+", text):
        return text
    number = int(text)
    return number if abs(number) <= JS_SAFE_INTEGER else text


def _coerce_int(value: str) -> int | str:
    text = value.strip()
    return int(text) if re.fullmatch(r"-?\d+", text) else text


def parse_a1111_parameters(text: str) -> dict[str, Any]:
    """Parse an A1111/Forge infotext block into prompt and parameter fields."""
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    while lines and not lines[-1].strip():
        lines.pop()

    param_index = -1
    for index in range(len(lines) - 1, -1, -1):
        if lines[index].lstrip().startswith("Steps:"):
            param_index = index
            break

    if param_index < 0:
        return {
            "positive_prompt": normalized.strip(),
            "negative_prompt": "",
            "generation_parameters": {},
            "extra_metadata": {},
            "parse_status": "partial",
        }

    head = lines[:param_index]
    negative_index = -1
    for index, line in enumerate(head):
        if line.startswith("Negative prompt:"):
            negative_index = index
            break

    if negative_index >= 0:
        positive = "\n".join(head[:negative_index]).strip()
        negative_lines = [head[negative_index][len("Negative prompt:") :].lstrip()]
        negative_lines.extend(head[negative_index + 1 :])
        negative = "\n".join(negative_lines).strip()
    else:
        positive = "\n".join(head).strip()
        negative = ""

    generation: dict[str, Any] = {}
    extra: dict[str, Any] = {}
    for chunk in _PARAM_SPLIT_RE.split(lines[param_index]):
        if ":" not in chunk:
            continue
        key, _, value = chunk.partition(":")
        raw_key = key.strip().lower()
        raw_value = value.strip()
        if not raw_key:
            continue
        normalized_key = _PARAM_KEYS.get(raw_key)
        if normalized_key == "seed":
            generation["seed"] = _coerce_seed(raw_value)
        elif normalized_key in _INT_KEYS.values():
            generation[normalized_key] = _coerce_int(raw_value)
        elif normalized_key:
            generation[normalized_key] = raw_value
        else:
            extra[key.strip()] = raw_value

    return {
        "positive_prompt": positive,
        "negative_prompt": negative,
        "generation_parameters": generation,
        "extra_metadata": extra,
        "parse_status": "available",
    }


def _infotext_from_image(image: Image.Image) -> tuple[str | None, str]:
    info = getattr(image, "info", {}) or {}
    parameters = info.get("parameters")
    if isinstance(parameters, str) and parameters.strip():
        return parameters, "a1111"
    for key in ("prompt", "workflow"):
        value = info.get(key)
        if isinstance(value, str) and value.strip():
            return value, "comfyui"
    comment = info.get("UserComment")
    if isinstance(comment, bytes):
        comment = comment.decode("utf-8", "replace")
    if isinstance(comment, str) and comment.strip():
        return comment, "exif"
    return None, "none"


def extract_image_metadata(binary: bytes) -> dict[str, Any]:
    """Read generation metadata from raw image bytes without transcoding."""
    try:
        with Image.open(io.BytesIO(binary)) as image:
            width, height = image.size
            infotext, parser_format = _infotext_from_image(image)
    except Exception as error:  # noqa: BLE001
        return {
            "metadata_status": "error",
            "parser_format": "none",
            "width": 0,
            "height": 0,
            "infotext": None,
            "data": {},
            "missing_fields": [],
            "warnings": [f"image_unreadable: {type(error).__name__}"],
        }

    base = {"width": int(width), "height": int(height), "infotext": infotext}
    if not infotext:
        return {
            **base,
            "metadata_status": "absent",
            "parser_format": "none",
            "data": {},
            "missing_fields": ["positive_prompt", "generation_parameters"],
            "warnings": [],
        }
    if len(infotext) > MAX_METADATA_TEXT:
        return {
            **base,
            "metadata_status": "unsupported",
            "parser_format": parser_format,
            "data": {},
            "missing_fields": ["positive_prompt", "generation_parameters"],
            "warnings": ["metadata_too_large"],
        }

    if parser_format == "a1111":
        parsed = parse_a1111_parameters(infotext)
        status = "available" if parsed["generation_parameters"] else "partial"
    else:
        parsed = {
            "positive_prompt": "",
            "negative_prompt": "",
            "generation_parameters": {},
            "extra_metadata": {"raw": infotext},
            "parse_status": "unsupported",
        }
        status = "partial"

    missing = [field for field in ("positive_prompt", "generation_parameters") if not parsed.get(field)]
    return {
        **base,
        "metadata_status": status,
        "parser_format": parser_format,
        "data": {
            "positive_prompt": parsed["positive_prompt"],
            "negative_prompt": parsed["negative_prompt"],
            "generation_parameters": parsed["generation_parameters"],
            "extra_metadata": parsed["extra_metadata"],
        },
        "missing_fields": missing,
        "warnings": [],
    }
