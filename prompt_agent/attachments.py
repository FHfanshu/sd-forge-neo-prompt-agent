from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import Any

from PIL import Image

from .common import ToolError, clip, new_id, now_ms
from .pnginfo import extract_image_metadata
from .sessions import SessionStore

MAX_BYTES = 10 * 1024 * 1024
MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
FORMAT_MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
MODEL_EDGE = 1568


def pnginfo_summary(binary: bytes) -> dict[str, Any]:
    meta = extract_image_metadata(binary)
    status = {"available": "ok", "partial": "ok", "absent": "missing"}.get(meta["metadata_status"], meta["metadata_status"])
    data = meta.get("data") or {}
    if meta.get("parser_format") not in ("a1111", "none") and status == "ok":
        status = "unsupported"
    return {
        "status": status,
        "positive": data.get("positive_prompt", ""),
        "negative": data.get("negative_prompt", ""),
        "parameters": {**data.get("generation_parameters", {}), **data.get("extra_metadata", {})} if status == "ok" else {},
        "raw": clip(meta.get("infotext") or "", 8000),
    }


def save_attachment(store: SessionStore, session_id: str, binary: bytes) -> dict[str, Any]:
    store.get_session(session_id)
    if not binary:
        raise ToolError("INVALID_ARGS", "图片为空")
    if len(binary) > MAX_BYTES:
        raise ToolError("INVALID_ARGS", "图片超过 10 MB", status=413)
    try:
        with Image.open(io.BytesIO(binary)) as image:
            mime = FORMAT_MIME.get(image.format or "")
            width, height = image.size
    except Exception:  # noqa: BLE001
        raise ToolError("INVALID_ARGS", "无法识别的图片") from None
    if mime is None:
        raise ToolError("INVALID_ARGS", "只支持 PNG、JPEG、WebP")
    attachment_id = new_id("a-")
    folder = store.attachment_dir(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{attachment_id}.{MIME_EXT[mime]}").write_bytes(binary)
    record = {
        "id": attachment_id,
        "session_id": session_id,
        "mime": mime,
        "width": width,
        "height": height,
        "bytes": len(binary),
        "sha256": hashlib.sha256(binary).hexdigest(),
        "pnginfo": pnginfo_summary(binary),
        "created_at": now_ms(),
    }
    store.add_attachment(record)
    return {key: record[key] for key in ("id", "mime", "width", "height", "pnginfo")}


def original_path(store: SessionStore, attachment_id: str) -> tuple[Path, str]:
    record = store.get_attachment(attachment_id)
    path = store.attachment_dir(record["session_id"]) / f"{record['id']}.{MIME_EXT[record['mime']]}"
    if not path.is_file():
        raise ToolError("NOT_FOUND", "附图文件已丢失", status=404)
    return path, record["mime"]


def model_jpeg(store: SessionStore, attachment_id: str) -> bytes:
    """Downscaled JPEG used when sending the image to a vision model; cached next to the original."""
    path, _ = original_path(store, attachment_id)
    cached = path.with_name(path.stem + ".model.jpg")
    if cached.is_file():
        return cached.read_bytes()
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((MODEL_EDGE, MODEL_EDGE))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90)
    cached.write_bytes(buffer.getvalue())
    return buffer.getvalue()
