from __future__ import annotations

import itertools
import threading
import time
from dataclasses import dataclass, field
from typing import Any

MAX_RECENT_BATCHES = 200
MAX_PAGE_LIMIT = 20


@dataclass
class ImageRef:
    image_id: str
    source: str = "generation"
    generation_id: str | None = None
    batch_index: int = 0
    created_at: float | None = None
    time_source: str = "generation"
    target: str | None = None
    width: int = 0
    height: int = 0
    metadata_status: str = "absent"
    availability: str = "available"
    filename: str | None = None
    is_grid: bool = False

    def to_summary(self) -> dict[str, Any]:
        return {
            "image_id": self.image_id,
            "source": self.source,
            "generation_id": self.generation_id,
            "batch_index": self.batch_index,
            "created_at": self.created_at,
            "time_source": self.time_source,
            "target": self.target,
            "width": self.width,
            "height": self.height,
            "metadata_status": self.metadata_status,
            "availability": self.availability,
            "is_grid": self.is_grid,
        }


@dataclass
class GenerationBatch:
    generation_id: str
    target: str
    created_at: float
    images: list[ImageRef] = field(default_factory=list)

    def to_summary(self, images: list[ImageRef] | None = None) -> dict[str, Any]:
        chosen = self.images if images is None else images
        return {
            "generation_id": self.generation_id,
            "target": self.target,
            "created_at": self.created_at,
            "image_count": len(chosen),
            "images": [image.to_summary() for image in chosen],
        }


class ImageIndex:
    """Bounded in-memory index of recently completed generation batches."""

    def __init__(self, max_batches: int = MAX_RECENT_BATCHES) -> None:
        self._max_batches = max(1, int(max_batches))
        self._lock = threading.Lock()
        self._counter = itertools.count(1)
        self._batches: list[GenerationBatch] = []
        self._current_key: Any = None
        self._current: GenerationBatch | None = None
        self._refs: dict[str, ImageRef] = {}

    def record_saved(
        self,
        *,
        batch_key: Any,
        target: str,
        filename: str = "",
        width: int = 0,
        height: int = 0,
        infotext: str | None = None,
        is_grid: bool = False,
        created_at: float | None = None,
        availability: str = "available",
    ) -> ImageRef:
        with self._lock:
            timestamp = float(created_at) if created_at is not None else time.time()
            if batch_key is None or batch_key is not self._current_key or self._current is None:
                self._current_key = batch_key
                self._current = GenerationBatch(
                    generation_id=f"gen-{next(self._counter)}",
                    target=target,
                    created_at=timestamp,
                )
                self._batches.append(self._current)
                if len(self._batches) > self._max_batches:
                    for dropped in self._batches[: len(self._batches) - self._max_batches]:
                        for image in dropped.images:
                            self._refs.pop(image.image_id, None)
                    del self._batches[: len(self._batches) - self._max_batches]
            batch = self._current
            assert batch is not None
            image_id = f"{batch.generation_id}-{len(batch.images)}"
            ref = ImageRef(
                image_id=image_id,
                generation_id=batch.generation_id,
                batch_index=len(batch.images),
                created_at=timestamp,
                target=target,
                width=max(0, int(width or 0)),
                height=max(0, int(height or 0)),
                metadata_status="available" if infotext else "absent",
                availability=availability,
                filename=filename or None,
                is_grid=bool(is_grid),
            )
            batch.images.append(ref)
            self._refs[image_id] = ref
            return ref

    def find(self, image_id: str) -> ImageRef | None:
        with self._lock:
            return self._refs.get(image_id)

    def coverage(self) -> dict[str, Any]:
        with self._lock:
            return {
                "scope": "host_recent",
                "batches_tracked": len(self._batches),
                "oldest_generation_id": self._batches[0].generation_id if self._batches else None,
                "newest_generation_id": self._batches[-1].generation_id if self._batches else None,
            }

    def list_recent(
        self,
        *,
        limit: int = 8,
        target: str | None = None,
        include_grids: bool = False,
    ) -> dict[str, Any]:
        page_limit = max(1, min(int(limit), MAX_PAGE_LIMIT))
        with self._lock:
            batches = [batch for batch in self._batches if not target or batch.target == target]
            coverage = {
                "scope": "host_recent",
                "batches_tracked": len(self._batches),
                "oldest_generation_id": self._batches[0].generation_id if self._batches else None,
            }
        batches = sorted(batches, key=lambda batch: (batch.created_at, batch.generation_id), reverse=True)
        items: list[dict[str, Any]] = []
        returned = 0
        for batch in batches:
            images = [image for image in batch.images if include_grids or not image.is_grid]
            if not images:
                continue
            remaining = page_limit - returned
            selected = images[:remaining]
            items.append(batch.to_summary(selected))
            returned += len(selected)
            if returned >= page_limit:
                break
        return {
            "items": items,
            "returned_count": returned,
            "has_more": returned >= page_limit,
            "next_cursor": items[-1]["generation_id"] if items else None,
            "scope": "host_recent",
            "coverage": coverage,
            "snapshot_id": coverage["oldest_generation_id"],
        }

    def clear(self) -> None:
        with self._lock:
            self._counter = itertools.count(1)
            self._batches.clear()
            self._refs.clear()
            self._current = None
            self._current_key = None


DEFAULT_IMAGE_INDEX = ImageIndex()
