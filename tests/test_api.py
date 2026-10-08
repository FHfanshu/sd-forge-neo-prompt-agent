import asyncio
import json
import unittest

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from helpers import TempData, png_bytes

from prompt_agent.api import build_router
from prompt_agent.chat import ChatProxy, sanitize_error, upstream_request
from prompt_agent.common import ToolError
from prompt_agent.tools import Tools

SSE = b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.data = TempData()
        self.profiles = self.data.profiles()
        self.sessions = self.data.sessions()
        self.upstream: list[httpx.Request] = []
        self.reply = lambda request: httpx.Response(200, stream=httpx.ByteStream(SSE), headers={"content-type": "text/event-stream"})

        def handler(request: httpx.Request) -> httpx.Response:
            self.upstream.append(request)
            return self.reply(request)

        chat = ChatProxy(self.profiles, transport=httpx.MockTransport(handler))
        app = FastAPI()
        app.include_router(build_router(self.profiles, self.sessions, chat, Tools(self.profiles, self.sessions), lambda: {"sampler": ["Euler"]}))
        self.client = TestClient(app)
        self.profile = self.profiles.upsert(None, {"name": "p", "base_url": "https://llm.test/v1", "models": ["real-model"],
                                                   "api_key": "sk-123", "reasoning_effort": "high"})

    def tearDown(self):
        self.data.cleanup()

    def test_chat_forwards_with_stored_model_and_key(self):
        body = {"profile_id": self.profile["id"], "model": "real-model", "base_url": "http://evil", "messages": [{"role": "user", "content": "x"}],
                "tools": [{"type": "function", "function": {"name": "t", "parameters": {}}}]}
        response = self.client.post("/prompt-agent/v2/chat", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, SSE)
        sent = self.upstream[0]
        self.assertEqual(str(sent.url), "https://llm.test/v1/chat/completions")
        self.assertEqual(sent.headers["authorization"], "Bearer sk-123")
        payload = json.loads(sent.content)
        self.assertEqual(payload["model"], "real-model")
        self.assertEqual(payload["reasoning_effort"], "high")
        self.assertTrue(payload["stream"])
        self.assertNotIn("base_url", payload)

    def test_chat_rejects_model_not_configured_for_provider(self):
        body = {"profile_id": self.profile["id"], "model": "evil", "messages": [{"role": "user", "content": "x"}]}
        response = self.client.post("/prompt-agent/v2/chat", json=body)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.upstream, [])

    def test_chat_upstream_error_is_sanitized(self):
        self.reply = lambda request: httpx.Response(401, json={"error": {"message": "bad key sk-123"}})
        response = self.client.post("/prompt-agent/v2/chat", json={"profile_id": self.profile["id"], "model": "real-model", "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH")
        self.assertNotIn("sk-123", response.text)

    def test_chat_network_error(self):
        def boom(request):
            raise httpx.ConnectError("nope")

        self.reply = boom
        response = self.client.post("/prompt-agent/v2/chat", json={"profile_id": self.profile["id"], "model": "real-model", "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "NETWORK")

    def test_profiles_never_return_key(self):
        response = self.client.get("/prompt-agent/v2/profiles")
        self.assertNotIn("sk-123", response.text)
        self.assertTrue(response.json()["profiles"][0]["has_api_key"])

    def test_session_message_and_attachment_flow(self):
        session = self.client.post("/prompt-agent/v2/sessions", json={"title": "s", "profile_id": self.profile["id"]}).json()
        sid = session["id"]
        put = self.client.put(f"/prompt-agent/v2/sessions/{sid}/messages/m1", json={"role": "user", "content": "hi"})
        self.assertEqual(put.json()["seq"], 1)
        self.client.put(f"/prompt-agent/v2/sessions/{sid}/messages/m2", json={"role": "assistant", "status": "streaming", "content": "p"})
        self.assertEqual(self.client.post("/prompt-agent/v2/sessions/recover").json()["recovered"], 1)
        listed = self.client.get(f"/prompt-agent/v2/sessions/{sid}/messages").json()
        self.assertEqual([m["status"] for m in listed["messages"]], ["complete", "interrupted"])
        upload = self.client.post(f"/prompt-agent/v2/attachments?session_id={sid}", content=png_bytes("a\nSteps: 3"), headers={"content-type": "image/png"})
        self.assertEqual(upload.status_code, 200)
        aid = upload.json()["id"]
        self.assertEqual(self.client.get(f"/prompt-agent/v2/attachments/{aid}/model").headers["content-type"], "image/jpeg")
        tool = self.client.post("/prompt-agent/v2/tools/read_attachment", json={"attachment_id": aid}).json()
        self.assertTrue(tool["ok"])
        self.assertEqual(tool["pnginfo"]["parameters"]["steps"], 3)
        self.assertEqual(self.client.delete(f"/prompt-agent/v2/sessions/{sid}").status_code, 200)
        self.assertEqual(self.client.get(f"/prompt-agent/v2/sessions/{sid}/messages").status_code, 404)

    def test_tool_errors_are_results_and_unknown_tool_is_404(self):
        result = self.client.post("/prompt-agent/v2/tools/load_skill", json={"name": "../../etc"}).json()
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "NOT_FOUND")
        self.assertEqual(self.client.post("/prompt-agent/v2/tools/rm_rf", json={}).status_code, 404)
        self.assertEqual(self.client.get("/prompt-agent/v2/forge/options").json(), {"sampler": ["Euler"]})

    def test_context_lists_skills_and_characters(self):
        context = self.client.get("/prompt-agent/v2/context").json()
        self.assertTrue(any(s["name"] == "danbooru-prompting" for s in context["skills"]))
        self.assertIsInstance(context["characters"], list)


class ChatUnitTest(unittest.TestCase):
    def test_upstream_request_requires_messages(self):
        with self.assertRaises(ToolError):
            upstream_request({"models": ["m"], "base_url": "http://x"}, "", {"messages": []})

    def test_context_length_error_code(self):
        error = sanitize_error(400, b'{"error":{"message":"maximum context length exceeded"}}', [])
        self.assertEqual(error.code, "CONTEXT_LENGTH")

    def test_stream_closes_upstream(self):
        closed = []

        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"data: 1\n\n"
                yield b"data: 2\n\n"

            async def aclose(self):
                closed.append(True)

        data = TempData()
        try:
            profiles = data.profiles()
            profile = profiles.upsert(None, {"name": "p", "base_url": "http://x", "models": ["m"]})
            proxy = ChatProxy(profiles, transport=httpx.MockTransport(lambda r: httpx.Response(200, stream=Stream())))

            async def consume_one():
                iterator = await proxy.open_stream({"profile_id": profile["id"], "model": "m", "messages": [{"role": "user", "content": "x"}]})
                first = await iterator.__anext__()
                await iterator.aclose()  # client disconnect
                return first

            self.assertEqual(asyncio.run(consume_one()), b"data: 1\n\n")
            self.assertTrue(closed)
        finally:
            data.cleanup()


if __name__ == "__main__":
    unittest.main()
