"""Agent memory: one plain Markdown file the agent and the user both edit.

The whole file is injected into the system prompt, so it is capped. The agent edits it with
exact-text patches, the same way it edits prompts, so user edits in between are never lost.
"""

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from .common import ToolError, data_dir

# injected into every request; keep well inside small local context windows
MAX_CHARS = 8000
OPS = ("append", "replace", "delete")


class MemoryStore:
    def __init__(self, path: Path | None = None):
        self.path = path or data_dir() / "MEMORY.md"
        self._lock = threading.Lock()

    def read(self) -> str:
        try:
            return self.path.read_text(encoding="utf-8-sig")
        except FileNotFoundError:
            return ""

    def _write(self, text: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=self.path.parent, prefix=".memory-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            os.replace(temp, self.path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise

    def write(self, text: str) -> dict[str, Any]:
        """Whole-file save from the settings editor."""
        text = str(text or "").replace("\r\n", "\n")
        if len(text) > MAX_CHARS:
            raise ToolError("INVALID_ARGS", f"记忆文件最多 {MAX_CHARS} 字")
        with self._lock:
            self._write(text)
        return {"ok": True, "chars": len(text)}

    def edit(self, op: str, text: str = "", find: str = "") -> dict[str, Any]:
        if op not in OPS:
            raise ToolError("INVALID_ARGS", f"op 只能是 {'、'.join(OPS)}")
        with self._lock:
            current = self.read()
            if op == "append":
                if not text.strip():
                    raise ToolError("INVALID_ARGS", "append 需要 text")
                updated = current.rstrip("\n") + ("\n" if current.strip() else "") + text.strip("\n") + "\n"
            else:
                if not find:
                    raise ToolError("INVALID_ARGS", f"{op} 需要 find（要精确匹配的原文）")
                count = current.count(find)
                if count != 1:
                    raise ToolError("STALE" if count == 0 else "AMBIGUOUS",
                                    "find 在记忆里不存在" if count == 0 else "find 匹配到多处，请给更长的原文", memory=current)
                updated = current.replace(find, text if op == "replace" else "", 1)
                if op == "delete":
                    updated = _drop_blank_runs(updated)
            if len(updated) > MAX_CHARS:
                raise ToolError("FULL", f"记忆超过 {MAX_CHARS} 字，请先合并或删除过时的内容", memory=current)
            self._write(updated)
        return {"ok": True, "op": op, "chars": len(updated)}


def _drop_blank_runs(text: str) -> str:
    """Deleting a line can leave an empty bullet gap; collapse runs of blank lines."""
    lines, blank = [], 0
    for line in text.split("\n"):
        blank = blank + 1 if not line.strip() else 0
        if blank <= 1:
            lines.append(line)
    return "\n".join(lines).strip("\n") + "\n" if text.strip() else ""
