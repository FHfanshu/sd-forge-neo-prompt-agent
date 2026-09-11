from __future__ import annotations

import json
import logging
import weakref

import gradio as gr

from backend.prompt_agent import register_prompt_agent_api
from backend.prompt_agent.forge_tools import ForgeToolValidationError, execute_catalog_tool, validate_forge_tool_request
from prompt_agent.forge_resources import inspect_resource, search_resources
from prompt_agent.danbooru import (
    inspect_danbooru_tags,
    inspect_danbooru_wikis,
    related_danbooru_tags,
    search_danbooru_tags,
    search_danbooru_wikis,
)
from prompt_agent.i18n import locale_metadata, translation_bundle
from prompt_agent.prompt_skills import load_prompt_skill
from prompt_agent.reference_image import analyze_reference_image
from modules import call_queue, script_callbacks


_LOGGER = logging.getLogger("prompt_agent")

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

_LOGGER.info("Prompt Agent Python extension loaded")

_batch_image_counts: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()


def _generation_target(processing) -> str:
    name = type(processing).__name__.lower() if processing is not None else ""
    if "txt2img" in name:
        return "txt2img"
    if "img2img" in name:
        return "img2img"
    return "unknown"


def _record_saved_image(params) -> None:
    """Index a completed image from Forge's on_image_saved hook."""
    try:
        from prompt_agent.image_index import DEFAULT_IMAGE_INDEX

        processing = getattr(params, "p", None)
        pnginfo = getattr(params, "pnginfo", None)
        infotext = pnginfo.get("parameters") if isinstance(pnginfo, dict) else None
        image = getattr(params, "image", None)
        width, height = image.size if image is not None else (0, 0)
        expected = 0
        count = 0
        if processing is not None:
            try:
                batch_size = max(1, int(getattr(processing, "batch_size", 1) or 1))
                iterations = max(1, int(getattr(processing, "n_iter", 1) or 1))
                expected = batch_size * iterations
                count = _batch_image_counts.get(processing, 0)
                _batch_image_counts[processing] = count + 1
            except TypeError:
                expected = 0
        # ponytail: Forge's ImageSaveParams has no grid flag, so a grid is
        # inferred as the image saved past batch_size * n_iter in a batch.
        is_grid = bool(expected) and count >= expected
        DEFAULT_IMAGE_INDEX.record_saved(
            batch_key=processing,
            target=_generation_target(processing),
            filename=str(getattr(params, "filename", "") or ""),
            width=width,
            height=height,
            infotext=infotext if isinstance(infotext, str) else None,
            is_grid=is_grid,
        )
    except Exception:  # noqa: BLE001
        _LOGGER.exception("failed to index a saved image")


def _assistant_api(_: gr.Blocks, app):
    from fastapi import Body, HTTPException
    register_prompt_agent_api(app)
    _LOGGER.info("Prompt Agent API registered under /prompt-agent/api")

    @app.post("/prompt-agent/api/analyze-image")
    async def prompt_agent_reference_image(payload: dict = Body(...)):
        try:
            with call_queue.queue_lock:
                return analyze_reference_image(payload)
        except Exception as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.get("/prompt-agent/api/i18n")
    async def prompt_agent_i18n(locale: str | None = None):
        return translation_bundle(locale)

    @app.get("/prompt-agent/api/i18n/locale")
    async def prompt_agent_i18n_locale(locale: str | None = None):
        return locale_metadata(locale)

    @app.get("/prompt-agent/api/prompt-styles")
    async def prompt_agent_prompt_styles():
        try:
            from modules import shared

            styles = []
            prompt_styles = getattr(shared, "prompt_styles", None)
            for style in getattr(prompt_styles, "styles", {}).values():
                styles.append(
                    {
                        "name": getattr(style, "name", ""),
                        "prompt": getattr(style, "prompt", ""),
                        "negative_prompt": getattr(style, "negative_prompt", ""),
                    }
                )
            return {"styles": styles}
        except Exception as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.get("/prompt-agent/api/resources/search")
    async def prompt_agent_resource_search(
        kind: str,
        query: str = "",
        limit: int = 20,
        cursor: str = "",
    ):
        try:
            arguments = validate_forge_tool_request("search_resources", {"kind": kind, "query": query, "limit": limit, "cursor": cursor})
            if kind in {"model", "embedding"}:
                return execute_catalog_tool("search_resources", arguments)
            return search_resources(kind, query=query, limit=limit, cursor=cursor)
        except (ValueError, ForgeToolValidationError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.get("/prompt-agent/api/resources/inspect")
    async def prompt_agent_resource_inspect(
        kind: str,
        id: str,
        query: str = "",
        limit: int = 20,
        cursor: str = "",
    ):
        try:
            arguments = validate_forge_tool_request("inspect_resource", {"kind": kind, "id": id, "query": query, "limit": limit, "cursor": cursor})
            if kind in {"model", "embedding"}:
                return execute_catalog_tool("inspect_resource", arguments)
            return inspect_resource(kind, id, query=query, limit=limit, cursor=cursor)
        except (ValueError, ForgeToolValidationError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.get("/prompt-agent/api/danbooru/tags/search")
    async def prompt_agent_danbooru_tag_search(query: str = "", queries: str = "", category: str = "", limit: int = 12):
        try:
            batch = json.loads(queries) if queries else None
            validate_forge_tool_request("search_danbooru_tags", {"query": query, "queries": batch, "category": category, "limit": limit})
            return search_danbooru_tags(query, category, limit, batch)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail="queries must be a JSON array") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.get("/prompt-agent/api/danbooru/tags/inspect-batch")
    async def prompt_agent_danbooru_tag_inspect_batch(names: str, include_wiki: bool = True):
        try:
            batch = [name for name in names.split(",") if name.strip()]
            validate_forge_tool_request("inspect_danbooru_tags", {"names": batch, "include_wiki": include_wiki})
            return inspect_danbooru_tags(batch, include_wiki)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.get("/prompt-agent/api/danbooru/tags/related")
    async def prompt_agent_danbooru_tag_related(name: str, category: str = "", limit: int = 12):
        try:
            validate_forge_tool_request("related_danbooru_tags", {"name": name, "category": category, "limit": limit})
            return related_danbooru_tags(name, category, limit)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.get("/prompt-agent/api/danbooru/wikis/search")
    async def prompt_agent_danbooru_wiki_search(query: str = "", queries: str = "", limit: int = 12):
        try:
            batch = json.loads(queries) if queries else None
            validate_forge_tool_request("search_danbooru_wikis", {"query": query, "queries": batch, "limit": limit})
            return search_danbooru_wikis(query, limit, batch)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail="queries must be a JSON array") from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.get("/prompt-agent/api/danbooru/wikis/inspect-batch")
    async def prompt_agent_danbooru_wiki_inspect_batch(titles: str):
        try:
            batch = [title for title in titles.split(",") if title.strip()]
            validate_forge_tool_request("inspect_danbooru_wikis", {"titles": batch})
            return inspect_danbooru_wikis(batch)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.get("/prompt-agent/api/prompt-skills/{name}")
    async def prompt_agent_prompt_skill(name: str):
        result = load_prompt_skill(name)
        if not result.get("ok"):
            raise HTTPException(status_code=404, detail=result.get("error") or "unknown prompt skill")
        return result

    @app.get("/prompt-agent/api/settings-export")
    async def prompt_agent_settings_export():
        from modules import shared

        prefix = "prompt_agent_"
        return {
            key.removeprefix(prefix): value
            for key, value in shared.opts.data.items()
            if key.startswith(prefix) and "settings_" not in key and "api_key" not in key
        }

script_callbacks.on_app_started(_assistant_api, name="prompt-agent-api")

if hasattr(script_callbacks, "on_image_saved"):
    script_callbacks.on_image_saved(_record_saved_image, name="prompt-agent-image-index")
