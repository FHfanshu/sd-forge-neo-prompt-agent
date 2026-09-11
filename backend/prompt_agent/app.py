from __future__ import annotations

import base64
import mimetypes
import re
import sqlite3
from typing import Any

from .contracts import parse_stream_request
from .errors import PromptAgentError
from .forge_tools import (
    PNGINFO_FIELDS,
    ForgeToolValidationError,
    validate_forge_tool_request,
)
from .models import public_models
from .local_runtime import LocalLlamaRuntime, LocalRuntimeError
from .profile_connection import ConnectionTestError, test_profile_connection
from .profiles import ProfileAuthority, SecretUnavailableError, default_storage_root
from .providers import provider_catalog, public_profile_state, stream_profile
from .session_sync import SessionSyncAuthority, SessionSyncError
from prompt_agent.image_index import DEFAULT_IMAGE_INDEX
from prompt_agent.image_payloads import _decode_image_data
from prompt_agent.pnginfo import extract_image_metadata


API_PREFIX = "/prompt-agent/api"
API_VERSION = 1
_REGISTRATION_MARKER = "_prompt_agent_api_registered"
_IMAGE_ID_RE = re.compile(r"gen-\d+-\d+\Z")
MAX_IMAGE_BYTES = 12 * 1024 * 1024


def health_payload() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "SD Forge Neo Prompt Agent",
        "api_version": API_VERSION,
        "runtime": "frontend-pi",
        "session_storage": "sqlite-sync+indexeddb-cache",
        "features": {
            "agent_loop": True,
            "provider_proxy": True,
            "forge_tools": True,
            "profiles": True,
            "local_models": True,
            "session_sync": True,
        },
    }


def register_prompt_agent_api(
    app: Any,
    profile_authority: ProfileAuthority | None = None,
    session_sync_authority: SessionSyncAuthority | None = None,
) -> None:
    from fastapi import Body, HTTPException
    from fastapi.responses import StreamingResponse

    state = getattr(app, "state", app)
    if getattr(state, _REGISTRATION_MARKER, False):
        return
    setattr(state, _REGISTRATION_MARKER, True)
    profiles = profile_authority or ProfileAuthority()
    session_sync = session_sync_authority or SessionSyncAuthority(getattr(profiles, "root", default_storage_root()))
    local_runtime = LocalLlamaRuntime()
    setattr(state, "_prompt_agent_local_runtime", local_runtime)
    if hasattr(app, "add_event_handler"):
        app.add_event_handler("shutdown", local_runtime.close)

    @app.get(f"{API_PREFIX}/health")
    async def prompt_agent_health() -> dict[str, Any]:
        return health_payload()

    @app.get(f"{API_PREFIX}/profiles")
    async def prompt_agent_profiles() -> dict[str, Any]:
        return profiles.list_state()

    @app.post(f"{API_PREFIX}/sessions/sync")
    async def prompt_agent_session_sync(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return session_sync.sync(payload)
        except (OSError, SessionSyncError, sqlite3.Error) as error:
            status = 422 if isinstance(error, SessionSyncError) else 503
            detail = str(error) if isinstance(error, SessionSyncError) else "Session synchronization is unavailable."
            raise HTTPException(status_code=status, detail=detail) from error

    @app.get(f"{API_PREFIX}/profiles/{{profile_id}}")
    async def prompt_agent_profile(profile_id: str) -> dict[str, Any]:
        try:
            return profiles.get(profile_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error

    @app.post(f"{API_PREFIX}/profiles")
    async def prompt_agent_create_profile(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return profiles.create(payload)
        except (OSError, RuntimeError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.patch(f"{API_PREFIX}/profiles/{{profile_id}}")
    async def prompt_agent_update_profile(profile_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return profiles.update(profile_id, payload)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        except (OSError, RuntimeError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.delete(f"{API_PREFIX}/profiles/{{profile_id}}", status_code=204)
    async def prompt_agent_delete_profile(profile_id: str) -> None:
        try:
            profiles.delete(profile_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/profiles/{{profile_id}}/duplicate")
    async def prompt_agent_duplicate_profile(profile_id: str) -> dict[str, Any]:
        try:
            return profiles.duplicate(profile_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        except (RuntimeError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/profiles/import")
    async def prompt_agent_import_profiles(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return profiles.import_legacy_state(payload)
        except (RuntimeError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/profile-routes/default")
    async def prompt_agent_set_profile_route(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return profiles.set_default(str(payload.get("role") or ""), str(payload.get("profile_id") or ""))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/profiles/restore-defaults")
    async def prompt_agent_restore_default_profiles() -> dict[str, Any]:
        return profiles.restore_defaults()

    @app.get(f"{API_PREFIX}/providers")
    async def prompt_agent_providers() -> dict[str, Any]:
        profile_state = profiles.list_state()
        return {"providers": provider_catalog(profile_state)}

    @app.get(f"{API_PREFIX}/models")
    async def prompt_agent_models() -> dict[str, Any]:
        return public_models(profiles.list_state())

    @app.get(f"{API_PREFIX}/profiles/{{profile_id}}/models")
    async def prompt_agent_profile_models(profile_id: str) -> dict[str, Any]:
        try:
            profile = profiles.get(profile_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        return public_models({"profiles": [profile]})

    @app.post(f"{API_PREFIX}/forge-tools/validate")
    async def prompt_agent_validate_forge_tool(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            tool = str(payload.get("tool") or "").strip()
            arguments = validate_forge_tool_request(tool, payload.get("arguments", {}))
            return {"ok": True, "tool": tool, "arguments": arguments}
        except ForgeToolValidationError as error:
            raise HTTPException(
                status_code=422,
                detail={
                    "ok": False,
                    "error": {
                        "code": "validation_error",
                        "message": str(error),
                        "retryable": False,
                    },
                },
            ) from error

    @app.post(f"{API_PREFIX}/images/metadata")
    async def prompt_agent_image_metadata(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        data_url = payload.get("data_url")
        if not isinstance(data_url, str) or not data_url:
            raise HTTPException(
                status_code=422,
                detail={"ok": False, "error": {"code": "invalid_image", "message": "data_url is required", "retryable": False}},
            )
        try:
            _mime, binary, _raw = _decode_image_data(data_url)
        except (ValueError, RuntimeError) as error:
            raise HTTPException(
                status_code=422,
                detail={"ok": False, "error": {"code": "invalid_image", "message": str(error), "retryable": False}},
            ) from error
        return {"ok": True, "metadata": extract_image_metadata(binary)}

    @app.post(f"{API_PREFIX}/images/recent")
    async def prompt_agent_recent_images(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            request = _recent_images_request(payload)
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail={"ok": False, "error": {"code": "invalid_request", "message": str(error), "retryable": False}},
            ) from error
        return {"ok": True, **DEFAULT_IMAGE_INDEX.list_recent(**request)}

    @app.post(f"{API_PREFIX}/images/pnginfo")
    async def prompt_agent_image_pnginfo(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            image_id = _image_id_request(payload, ("fields",))
            fields = _pnginfo_fields_request(payload)
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail={"ok": False, "error": {"code": "invalid_request", "message": str(error), "retryable": False}},
            ) from error
        reference = DEFAULT_IMAGE_INDEX.find(image_id)
        if reference is None:
            raise HTTPException(
                status_code=404,
                detail={"ok": False, "error": {"code": "not_found", "message": "unknown image id", "retryable": False}},
            )
        binary = _read_indexed_image(reference)
        if binary is None:
            metadata: dict[str, Any] = {
                "metadata_status": reference.metadata_status if reference.metadata_status == "absent" else "unsupported",
                "parser_format": "none",
                "data": {},
                "missing_fields": ["positive_prompt", "generation_parameters"],
                "warnings": ["image_file_unavailable"],
            }
        else:
            metadata = extract_image_metadata(binary)
        warnings = list(metadata.get("warnings") or [])
        return {
            "ok": True,
            "image_id": image_id,
            "target": reference.target,
            "source": "generation",
            "parser_format": metadata.get("parser_format"),
            "metadata_status": metadata.get("metadata_status"),
            "requested_fields": fields,
            "data": _project_pnginfo(metadata, fields),
            "missing_fields": list(metadata.get("missing_fields") or []),
            "warnings": warnings,
            "truncated": "metadata_too_large" in warnings,
            "result_id": None,
            "width": int(metadata.get("width") or reference.width),
            "height": int(metadata.get("height") or reference.height),
            "metadata": metadata,
        }

    @app.post(f"{API_PREFIX}/images/content")
    async def prompt_agent_image_content(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            image_id = _image_id_request(payload)
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail={"ok": False, "error": {"code": "invalid_request", "message": str(error), "retryable": False}},
            ) from error
        reference = DEFAULT_IMAGE_INDEX.find(image_id)
        if reference is None:
            raise HTTPException(
                status_code=404,
                detail={"ok": False, "error": {"code": "not_found", "message": "unknown image id", "retryable": False}},
            )
        binary = _read_indexed_image(reference)
        if binary is None:
            raise HTTPException(
                status_code=404,
                detail={"ok": False, "error": {"code": "not_found", "message": "image file unavailable", "retryable": False}},
            )
        if len(binary) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail={"ok": False, "error": {"code": "too_large", "message": "image exceeds the content limit", "retryable": False}},
            )
        return {
            "ok": True,
            "image_id": image_id,
            "target": reference.target,
            "width": reference.width,
            "height": reference.height,
            "image_mime_type": _image_mime_type(reference),
            "image_base64": base64.b64encode(binary).decode("ascii"),
        }

    @app.post(f"{API_PREFIX}/profiles/{{profile_id}}/connection-test")
    async def prompt_agent_profile_connection_test(profile_id: str) -> dict[str, Any]:
        try:
            profile = profiles.resolve(profile_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        except (OSError, RuntimeError, ValueError) as error:
            raise HTTPException(
                status_code=502,
                detail={
                    "ok": False,
                    "error": {
                        "code": "secret_unavailable",
                        "message": "The stored provider credentials are unavailable.",
                        "retryable": False,
                    },
                    "profile_id": profile_id,
                },
            ) from error
        turn_id = f"connection-test:{profile_id}"
        try:
            if profile.get("runtime") == "llama-once":
                await local_runtime.start_turn(turn_id, profile)
                profile = await local_runtime.stream_profile(turn_id, profile)
            return await test_profile_connection(profile)
        except ConnectionTestError as error:
            raise HTTPException(
                status_code=error.status_code,
                detail={
                    "ok": False,
                    "error": {
                        "code": error.code,
                        "message": error.message,
                        "retryable": error.retryable,
                    },
                    "profile_id": profile_id,
                },
            ) from error
        except LocalRuntimeError as error:
            raise HTTPException(
                status_code=error.status_code,
                detail={"ok": False, "error": {"code": error.code, "message": error.message, "retryable": True}, "profile_id": profile_id},
            ) from error
        except Exception as error:  # noqa: BLE001
            raise HTTPException(
                status_code=502,
                detail={
                    "ok": False,
                    "error": {
                        "code": "connection_failed",
                        "message": "The provider connection test failed.",
                        "retryable": True,
                    },
                    "profile_id": profile_id,
                },
            ) from error
        finally:
            if profile.get("runtime") == "llama-once" and turn_id.startswith("connection-test:"):
                await local_runtime.stop_turn(turn_id, force=True)

    @app.post(f"{API_PREFIX}/local-runtime/start")
    async def prompt_agent_local_runtime_start(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            profile_id, turn_id = _local_runtime_request(payload)
            return await local_runtime.start_turn(turn_id, profiles.resolve(profile_id))
        except KeyError as error:
            raise HTTPException(status_code=404, detail="profile not found") from error
        except (OSError, RuntimeError, ValueError, LocalRuntimeError) as error:
            status = error.status_code if isinstance(error, LocalRuntimeError) else 422
            message = error.message if isinstance(error, LocalRuntimeError) else str(error)
            raise HTTPException(status_code=status, detail=message) from error

    @app.post(f"{API_PREFIX}/local-runtime/stop")
    async def prompt_agent_local_runtime_stop(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            _profile_id, turn_id = _local_runtime_request(payload)
            force = payload.get("force", False)
            if not isinstance(force, bool):
                raise ValueError("force must be a boolean")
            return await local_runtime.stop_turn(turn_id, force=force)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/local-runtime/status")
    async def prompt_agent_local_runtime_status(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            profile_id, turn_id = _local_runtime_request(payload)
            return await local_runtime.status(turn_id, profile_id)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post(f"{API_PREFIX}/stream")
    async def prompt_agent_stream(payload: dict[str, Any] = Body(...)):
        try:
            request = parse_stream_request(payload)
            profile = profiles.resolve(request.profile_id)
            if profile.get("runtime") == "llama-once":
                profile = await local_runtime.stream_profile(request.turn_id, profile)
        except KeyError as error:
            detail = PromptAgentError(
                "unknown_profile",
                "The selected model profile is unavailable.",
                request_id=str(payload.get("request_id") or ""),
            )
            raise HTTPException(status_code=404, detail=detail.payload()["error"]) from error
        except LocalRuntimeError as error:
            detail = PromptAgentError(error.code, error.message, request_id=str(payload.get("request_id") or ""))
            raise HTTPException(status_code=error.status_code, detail=detail.payload()["error"]) from error
        except SecretUnavailableError as error:
            detail = PromptAgentError(
                "secret_unavailable",
                "The stored API key cannot be decrypted on this machine. Re-enter it in the profile settings.",
                request_id=str(payload.get("request_id") or ""),
                retryable=True,
            )
            raise HTTPException(status_code=422, detail=detail.payload()["error"]) from error
        except (RuntimeError, ValueError) as error:
            detail = PromptAgentError(
                "validation_error",
                str(error),
                request_id=str(payload.get("request_id") or ""),
            )
            raise HTTPException(status_code=422, detail=detail.payload()["error"]) from error
        return StreamingResponse(
            stream_profile(request, profile),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "X-Request-ID": request.request_id,
            },
        )


def _local_runtime_request(payload: Any) -> tuple[str, str]:
    import re

    if not isinstance(payload, dict):
        raise ValueError("request body must be an object")
    values = []
    for key in ("profile_id", "turn_id"):
        value = str(payload.get(key) or "")
        if len(value) > 96 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}", value):
            raise ValueError(f"{key} must be a safe identifier")
        values.append(value)
    return values[0], values[1]


def _recent_images_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be an object")
    limit = payload.get("limit", 8)
    if isinstance(limit, bool) or not isinstance(limit, int):
        raise ValueError("limit must be an integer")
    target = payload.get("target")
    if target is not None and target not in ("txt2img", "img2img", "unknown"):
        raise ValueError("target must be txt2img, img2img, or unknown")
    include_grids = payload.get("include_grids", False)
    if not isinstance(include_grids, bool):
        raise ValueError("include_grids must be a boolean")
    return {"limit": limit, "target": target, "include_grids": include_grids}


def _image_id_request(payload: Any, allowed_extra: tuple[str, ...] = ()) -> str:
    if not isinstance(payload, dict):
        raise ValueError("request body must be an object")
    unknown = set(payload) - {"image_id"} - set(allowed_extra)
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    image_id = payload.get("image_id")
    if not isinstance(image_id, str) or not _IMAGE_ID_RE.fullmatch(image_id):
        raise ValueError("image_id is required")
    return image_id


def _pnginfo_fields_request(payload: dict[str, Any]) -> list[str]:
    fields = payload.get("fields")
    if fields is None:
        return ["summary"]
    if not isinstance(fields, list) or not fields or len(fields) > len(PNGINFO_FIELDS):
        raise ValueError("fields must be a list of supported pnginfo fields")
    selected: list[str] = []
    for field in fields:
        if field not in PNGINFO_FIELDS:
            raise ValueError(f"unsupported pnginfo field: {field}")
        if field not in selected:
            selected.append(field)
    return selected


def _project_pnginfo(metadata: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    data = metadata.get("data") or {}
    projected: dict[str, Any] = {}
    for field in fields:
        if field == "summary":
            parameters = data.get("generation_parameters") or {}
            short = ", ".join(
                f"{key}={parameters[key]}"
                for key in ("steps", "sampler", "scheduler", "cfg_scale", "seed", "size")
                if key in parameters
            )
            projected["summary"] = {
                "has_metadata": metadata.get("metadata_status") in ("available", "partial"),
                "recognized_fields": sorted(data.keys()),
                "parameter_summary": short,
            }
        else:
            projected[field] = data.get(field)
    return projected


def _image_mime_type(reference: Any) -> str:
    mime = mimetypes.guess_type(str(getattr(reference, "filename", "") or ""))[0]
    return mime or "image/png"


def _read_indexed_image(reference: Any) -> bytes | None:
    filename = str(getattr(reference, "filename", "") or "")
    if not filename:
        return None
    try:
        with open(filename, "rb") as handle:
            return handle.read()
    except OSError:
        return None
