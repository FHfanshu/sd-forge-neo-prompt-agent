from __future__ import annotations

import json
import shutil
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .common import ToolError, data_dir, new_id, now_ms

ROLES = ("user", "assistant", "tool")
STATUSES = ("complete", "streaming", "stopped", "error", "interrupted")
JSON_COLUMNS = ("tool_calls", "attachments", "usage")
TEXT_LIMIT = 2_000_000

SCHEMA = [
    """
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
      profile_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
      status TEXT NOT NULL CHECK (status IN ('complete','streaming','stopped','error','interrupted')),
      content TEXT NOT NULL DEFAULT '', reasoning TEXT NOT NULL DEFAULT '',
      tool_calls TEXT, tool_call_id TEXT, tool_name TEXT,
      attachments TEXT, error TEXT, usage TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (session_id, seq)
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      mime TEXT NOT NULL, width INTEGER, height INTEGER, bytes INTEGER,
      sha256 TEXT NOT NULL, pnginfo TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX messages_session_seq ON messages(session_id, seq);
    """,
    "ALTER TABLE sessions ADD COLUMN model TEXT;",
]


class SessionStore:
    def __init__(self, root: Path | None = None):
        self.root = root or data_dir()
        self.path = self.root / "v2.sqlite3"
        self.attachment_root = self.root / "attachments"
        self._lock = threading.Lock()
        with self._connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            for index in range(version, len(SCHEMA)):
                db.executescript(SCHEMA[index])
                db.execute(f"PRAGMA user_version = {index + 1}")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """One short-lived connection per operation; always committed or rolled back, then closed."""
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("PRAGMA journal_mode = WAL")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    # -- sessions ----------------------------------------------------------
    def list_sessions(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise ToolError("NOT_FOUND", "会话不存在", status=404)
        return dict(row)

    def create_session(self, title: str = "", profile_id: str | None = None, session_id: str | None = None, model: str | None = None) -> dict[str, Any]:
        stamp = now_ms()
        session = {"id": session_id or new_id("s-"), "title": str(title or "")[:80], "profile_id": profile_id, "model": model,
                   "created_at": stamp, "updated_at": stamp}
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO sessions (id, title, profile_id, model, created_at, updated_at)"
                       " VALUES (:id, :title, :profile_id, :model, :created_at, :updated_at)", session)
        return session

    def update_session(self, session_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        current = self.get_session(session_id)
        if "title" in changes:
            current["title"] = str(changes["title"] or "")[:80]
        if "profile_id" in changes:
            current["profile_id"] = changes["profile_id"] or None
        if "model" in changes:
            current["model"] = str(changes["model"] or "")[:200] or None
        current["updated_at"] = now_ms()
        with self._lock, self._connect() as db:
            db.execute("UPDATE sessions SET title = :title, profile_id = :profile_id, model = :model, updated_at = :updated_at WHERE id = :id", current)
        return current

    def delete_session(self, session_id: str) -> None:
        with self._lock, self._connect() as db:
            db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        folder = self.attachment_root / _safe_name(session_id)
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)

    # -- messages ----------------------------------------------------------
    def list_messages(self, session_id: str, before_seq: int | None = None, limit: int = 60) -> dict[str, Any]:
        self.get_session(session_id)
        limit = max(1, min(int(limit), 500))
        with self._connect() as db:
            if before_seq is None:
                rows = db.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?", (session_id, limit + 1)).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
                    (session_id, int(before_seq), limit + 1),
                ).fetchall()
        has_more = len(rows) > limit
        return {"messages": [_message_out(row) for row in reversed(rows[:limit])], "has_more": has_more}

    def put_message(self, session_id: str, message_id: str, raw: dict[str, Any]) -> dict[str, Any]:
        role = raw.get("role")
        status = raw.get("status", "complete")
        if role not in ROLES or status not in STATUSES:
            raise ToolError("INVALID_ARGS", "消息的 role 或 status 不合法")
        stamp = now_ms()
        values: dict[str, Any] = {
            "id": message_id,
            "session_id": session_id,
            "role": role,
            "status": status,
            "content": str(raw.get("content") or "")[:TEXT_LIMIT],
            "reasoning": str(raw.get("reasoning") or "")[:TEXT_LIMIT],
            "tool_call_id": raw.get("tool_call_id"),
            "tool_name": raw.get("tool_name"),
            "error": raw.get("error"),
            "updated_at": stamp,
        }
        for column in JSON_COLUMNS:
            values[column] = json.dumps(raw[column], ensure_ascii=False) if raw.get(column) is not None else None
        with self._lock, self._connect() as db:
            if db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                raise ToolError("NOT_FOUND", "会话不存在", status=404)
            existing = db.execute("SELECT session_id, seq, created_at FROM messages WHERE id = ?", (message_id,)).fetchone()
            if existing is not None and existing["session_id"] != session_id:
                raise ToolError("INVALID_ARGS", "消息 id 已属于其他会话")
            if existing is None:
                values["seq"] = db.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0]
                values["created_at"] = stamp
                db.execute(
                    "INSERT INTO messages (id, session_id, seq, role, status, content, reasoning, tool_calls, tool_call_id, tool_name,"
                    " attachments, error, usage, created_at, updated_at) VALUES (:id, :session_id, :seq, :role, :status, :content,"
                    " :reasoning, :tool_calls, :tool_call_id, :tool_name, :attachments, :error, :usage, :created_at, :updated_at)",
                    values,
                )
            else:
                values["seq"], values["created_at"] = existing["seq"], existing["created_at"]
                db.execute(
                    "UPDATE messages SET role = :role, status = :status, content = :content, reasoning = :reasoning,"
                    " tool_calls = :tool_calls, tool_call_id = :tool_call_id, tool_name = :tool_name, attachments = :attachments,"
                    " error = :error, usage = :usage, updated_at = :updated_at WHERE id = :id",
                    values,
                )
            db.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (stamp, session_id))
        return {"id": message_id, "seq": values["seq"], "created_at": values["created_at"], "updated_at": stamp}

    def delete_messages_from(self, session_id: str, from_seq: int) -> int:
        with self._lock, self._connect() as db:
            cursor = db.execute("DELETE FROM messages WHERE session_id = ? AND seq >= ?", (session_id, int(from_seq)))
            return cursor.rowcount

    def recover(self) -> int:
        """Mark messages left streaming by a closed page as interrupted. Never resumes them."""
        with self._lock, self._connect() as db:
            cursor = db.execute("UPDATE messages SET status = 'interrupted', updated_at = ? WHERE status = 'streaming'", (now_ms(),))
            return cursor.rowcount

    # -- attachments -------------------------------------------------------
    def attachment_dir(self, session_id: str) -> Path:
        return self.attachment_root / _safe_name(session_id)

    def add_attachment(self, record: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO attachments VALUES (:id, :session_id, :mime, :width, :height, :bytes, :sha256, :pnginfo, :created_at)",
                {**record, "pnginfo": json.dumps(record.get("pnginfo"), ensure_ascii=False)},
            )

    def get_attachment(self, attachment_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
        if row is None:
            raise ToolError("NOT_FOUND", "附图不存在", status=404)
        record = dict(row)
        record["pnginfo"] = json.loads(record["pnginfo"]) if record["pnginfo"] else None
        return record


def _safe_name(value: str) -> str:
    cleaned = "".join(ch for ch in str(value) if ch.isalnum() or ch in "-_")
    if not cleaned:
        raise ToolError("INVALID_ARGS", "id 不合法")
    return cleaned


def _message_out(row: sqlite3.Row) -> dict[str, Any]:
    message = dict(row)
    for column in JSON_COLUMNS:
        message[column] = json.loads(message[column]) if message[column] else None
    return message
