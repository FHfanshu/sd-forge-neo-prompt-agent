from __future__ import annotations

import inspect
import json
import logging
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import attachments
from .chat import ChatProxy
from .common import ToolError
from .profiles import ProfileStore
from .sessions import SessionStore
from .tools import Tools

PREFIX = "/prompt-agent/v2"
MAX_CHAT_BODY = 32 * 1024 * 1024
LOGGER = logging.getLogger("prompt_agent")


def _error(error: ToolError) -> JSONResponse:
    return JSONResponse({"error": error.payload()}, status_code=error.status)


async def _json(request: Request, limit: int = 1024 * 1024) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > limit:
        raise ToolError("TOO_LARGE", "请求体过大", status=413)
    try:
        value = json.loads(raw or b"{}")
    except ValueError:
        raise ToolError("INVALID_ARGS", "请求体不是合法 JSON") from None
    if not isinstance(value, dict):
        raise ToolError("INVALID_ARGS", "请求体必须是对象")
    return value


def build_router(profiles: ProfileStore, sessions: SessionStore, chat: ChatProxy, tools: Tools, forge_options=None) -> APIRouter:
    router = APIRouter(prefix=PREFIX)

    def guarded(handler):
        async def wrapper(*args, **kwargs):
            try:
                return await handler(*args, **kwargs)
            except ToolError as error:
                return _error(error)
            except Exception:  # noqa: BLE001
                LOGGER.exception("[prompt-agent] request failed")
                return _error(ToolError("INTERNAL", "服务端内部错误", status=500))

        wrapper.__name__ = handler.__name__
        wrapper.__signature__ = inspect.signature(handler)
        return wrapper

    # -- profiles and settings ----------------------------------------------
    @router.get("/profiles")
    @guarded
    async def list_profiles():
        return profiles.list()

    @router.put("/profiles/default")
    @guarded
    async def set_default(request: Request):
        body = await _json(request)
        profiles.set_default(str(body.get("id") or ""))
        return profiles.list()

    @router.put("/profiles/{profile_id}")
    @guarded
    async def put_profile(profile_id: str, request: Request):
        body = await _json(request)
        return profiles.upsert(None if profile_id == "new" else profile_id, body)

    @router.delete("/profiles/{profile_id}")
    @guarded
    async def delete_profile(profile_id: str):
        profiles.delete(profile_id)
        return {"ok": True}

    @router.post("/profiles/{profile_id}/models")
    @guarded
    async def list_models(profile_id: str):
        return {"models": await chat.list_models(profile_id)}

    @router.get("/settings")
    @guarded
    async def get_settings():
        return profiles.settings()

    @router.put("/settings")
    @guarded
    async def put_settings(request: Request):
        return profiles.update_settings(await _json(request))

    # -- chat ------------------------------------------------------------------
    @router.post("/chat")
    @guarded
    async def chat_stream(request: Request):
        body = await _json(request, MAX_CHAT_BODY)
        stream = await chat.open_stream(body)
        return StreamingResponse(stream, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # -- sessions ----------------------------------------------------------------
    @router.get("/sessions")
    @guarded
    async def list_sessions():
        return {"sessions": await run_in_threadpool(sessions.list_sessions)}

    @router.post("/sessions")
    @guarded
    async def create_session(request: Request):
        body = await _json(request)
        return await run_in_threadpool(sessions.create_session, str(body.get("title") or ""), body.get("profile_id"), body.get("id"))

    @router.post("/sessions/recover")
    @guarded
    async def recover():
        return {"recovered": await run_in_threadpool(sessions.recover)}

    @router.patch("/sessions/{session_id}")
    @guarded
    async def patch_session(session_id: str, request: Request):
        return await run_in_threadpool(sessions.update_session, session_id, await _json(request))

    @router.delete("/sessions/{session_id}")
    @guarded
    async def delete_session(session_id: str):
        await run_in_threadpool(sessions.delete_session, session_id)
        return {"ok": True}

    @router.get("/sessions/{session_id}/messages")
    @guarded
    async def list_messages(session_id: str, before_seq: int | None = None, limit: int = 60):
        return await run_in_threadpool(sessions.list_messages, session_id, before_seq, limit)

    @router.put("/sessions/{session_id}/messages/{message_id}")
    @guarded
    async def put_message(session_id: str, message_id: str, request: Request):
        body = await _json(request, MAX_CHAT_BODY)
        return await run_in_threadpool(sessions.put_message, session_id, message_id, body)

    @router.delete("/sessions/{session_id}/messages")
    @guarded
    async def delete_messages(session_id: str, from_seq: int):
        return {"deleted": await run_in_threadpool(sessions.delete_messages_from, session_id, from_seq)}

    # -- attachments -------------------------------------------------------------
    @router.post("/attachments")
    @guarded
    async def upload(request: Request, session_id: str):
        raw = await request.body()
        return await run_in_threadpool(attachments.save_attachment, sessions, session_id, raw)

    @router.get("/attachments/{attachment_id}")
    @guarded
    async def original(attachment_id: str):
        path, mime = await run_in_threadpool(attachments.original_path, sessions, attachment_id)
        return Response(path.read_bytes(), media_type=mime, headers={"Cache-Control": "private, max-age=86400"})

    @router.get("/attachments/{attachment_id}/model")
    @guarded
    async def model_image(attachment_id: str):
        data = await run_in_threadpool(attachments.model_jpeg, sessions, attachment_id)
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    # -- tools and context -------------------------------------------------------
    @router.post("/tools/{name}")
    @guarded
    async def run_tool(name: str, request: Request):
        args = await _json(request)
        try:
            return await run_in_threadpool(tools.run, name, args)
        except ToolError as error:
            if error.status == 404 and error.code == "NOT_FOUND" and name not in tools.handlers:
                raise
            return {"ok": False, "error": error.payload()}

    @router.get("/context")
    @guarded
    async def context():
        return await run_in_threadpool(tools.context)

    @router.get("/forge/options")
    @guarded
    async def options():
        if forge_options is None:
            raise ToolError("FORGE_UNAVAILABLE", "Forge 不可用", status=503)
        return await run_in_threadpool(forge_options)

    return router


def mount(app: FastAPI) -> None:
    from .forge import generation_options

    profiles = ProfileStore()
    sessions = SessionStore()
    app.include_router(build_router(profiles, sessions, ChatProxy(profiles), Tools(profiles, sessions), generation_options))
