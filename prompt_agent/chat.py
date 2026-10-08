from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator

import httpx

from .common import ToolError, clip
from .profiles import REASONING_EFFORTS, ProfileStore

LOGGER = logging.getLogger("prompt_agent")
CONNECT_TIMEOUT = 15.0
READ_TIMEOUT = 300.0


def upstream_request(profile: dict[str, Any], api_key: str, body: dict[str, Any]) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Build the OpenAI-compatible request. Connection target and model always come from the stored profile."""
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ToolError("INVALID_ARGS", "messages 不能为空")
    payload: dict[str, Any] = {
        "model": profile["model"],
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    tools = body.get("tools")
    if isinstance(tools, list) and tools:
        payload["tools"] = tools
    # the composer may override the provider's effort per request; values differ by model template
    effort = body.get("reasoning_effort") or profile.get("reasoning_effort")
    if effort not in REASONING_EFFORTS:
        raise ToolError("INVALID_ARGS", f"不支持的推理强度：{effort}")
    if effort:
        payload["reasoning_effort"] = effort
    if profile.get("temperature") is not None:
        payload["temperature"] = profile["temperature"]
    if profile.get("max_tokens"):
        payload["max_tokens"] = profile["max_tokens"]
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return f"{profile['base_url']}/chat/completions", headers, payload


def sanitize_error(status: int, raw: bytes, secrets: list[str]) -> ToolError:
    text = raw.decode("utf-8", "replace")
    message = text
    try:
        parsed = json.loads(text)
        error = parsed.get("error") if isinstance(parsed, dict) else None
        if isinstance(error, dict):
            message = str(error.get("message") or error)
        elif isinstance(error, str):
            message = error
        elif isinstance(parsed, dict) and parsed.get("message"):
            message = str(parsed["message"])
    except ValueError:
        pass
    for secret in secrets:
        if secret:
            message = message.replace(secret, "***")
    code = {401: "AUTH", 403: "AUTH", 429: "RATE_LIMIT"}.get(status, "UPSTREAM")
    lowered = message.lower()
    if "context" in lowered and any(word in lowered for word in ("length", "too long", "maximum", "size", "window")):
        code = "CONTEXT_LENGTH"
    return ToolError(code, clip(message.strip() or f"HTTP {status}", 600), status=status if status >= 400 else 502)


class ChatProxy:
    def __init__(self, profiles: ProfileStore, transport: httpx.AsyncBaseTransport | None = None):
        self.profiles = profiles
        self.transport = transport
        self._no_tokenize: set[str] = set()

    def _client(self) -> httpx.AsyncClient:
        timeout = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
        return httpx.AsyncClient(timeout=timeout, transport=self.transport, trust_env=True)

    async def open_stream(self, body: dict[str, Any]) -> AsyncIterator[bytes]:
        """Connect upstream and return a byte iterator. Errors before the first byte raise ToolError."""
        profile = self.profiles.resolve(str(body.get("profile_id") or ""), str(body.get("model") or ""))
        api_key = self.profiles.api_key(profile["id"])
        url, headers, payload = upstream_request(profile, api_key, body)
        client = self._client()
        try:
            request = client.build_request("POST", url, headers=headers, json=payload)
            response = await client.send(request, stream=True)
        except httpx.HTTPError as error:
            await client.aclose()
            raise ToolError("NETWORK", f"连接模型服务失败：{type(error).__name__}", status=502) from None
        if response.status_code >= 400:
            raw = await response.aread()
            await response.aclose()
            await client.aclose()
            raise sanitize_error(response.status_code, raw, [api_key])

        async def iterate() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_raw():
                    yield chunk
            except httpx.HTTPError as error:
                LOGGER.warning("[prompt-agent] upstream stream ended: %s", type(error).__name__)
                note = {"error": {"code": "NETWORK", "message": "模型服务连接中断"}}
                yield f"\n\ndata: {json.dumps(note, ensure_ascii=False)}\n\n".encode()
            finally:
                await response.aclose()
                await client.aclose()

        return iterate()

    async def count_tokens(self, profile_id: str, model: str, text: str) -> int:
        """Exact token count from the provider's own tokenizer (llama.cpp style POST /tokenize).

        Used when the stream's usage does not report reasoning tokens. The URL comes from the
        stored profile; servers without the endpoint are remembered and not asked again.
        """
        profile = self.profiles.resolve(profile_id, model)
        root = re.sub(r"/v1$", "", profile["base_url"])
        if root in self._no_tokenize:
            raise ToolError("UNSUPPORTED", "这个服务不提供 tokenize")
        api_key = self.profiles.api_key(profile["id"])
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        async with self._client() as client:
            try:
                response = await client.post(f"{root}/tokenize", json={"content": text}, headers=headers, timeout=5.0)
            except httpx.HTTPError as error:
                raise ToolError("NETWORK", f"连接模型服务失败：{type(error).__name__}", status=502) from None
        try:
            tokens = response.json().get("tokens") if response.status_code < 400 else None
        except ValueError:
            tokens = None
        if not isinstance(tokens, list):
            self._no_tokenize.add(root)
            raise ToolError("UNSUPPORTED", "这个服务不提供 tokenize")
        return len(tokens)

    async def list_models(self, profile_id: str) -> list[str]:
        profile = self.profiles.get(profile_id)
        api_key = self.profiles.api_key(profile_id)
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        async with self._client() as client:
            try:
                response = await client.get(f"{profile['base_url']}/models", headers=headers)
            except httpx.HTTPError as error:
                raise ToolError("NETWORK", f"连接模型服务失败：{type(error).__name__}", status=502) from None
            if response.status_code >= 400:
                raise sanitize_error(response.status_code, response.content, [api_key])
            try:
                data = response.json().get("data", [])
            except ValueError:
                raise ToolError("UPSTREAM", "模型列表格式无法识别", status=502) from None
        return sorted(str(item.get("id")) for item in data if isinstance(item, dict) and item.get("id"))
