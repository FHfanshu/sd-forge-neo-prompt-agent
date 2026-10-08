import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { Message, TurnState } from "../types";
import { buildContext } from "./context";
import { blankMessage, MAX_TOOL_ROUNDS, runTurn, type LoopDeps } from "./loop";

const sse = (...events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
const text = (content: string) => sse({ choices: [{ delta: { content } }] });
const toolCall = (id: string, name: string, args = "{}") => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] });

function streamResponse(body: string, opts: { hangAfterFirst?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      if (!opts.hangAfterFirst) controller.close();
    },
  });
  return new Response(stream);
}

function harness(responses: Array<(signal: AbortSignal) => Promise<Response>>, overrides: Partial<LoopDeps> = {}) {
  const messages: Message[] = [blankMessage("u1", "user", { content: "hi" })];
  const states: TurnState[] = [];
  const persisted: Message[] = [];
  const bodies: any[] = [];
  let id = 0;
  const deps: LoopDeps = {
    history: () => messages,
    add: (m) => messages.push(m),
    update: (m, persist) => {
      const index = messages.findIndex((x) => x.id === m.id);
      messages[index] = m;
      if (persist) persisted.push(m);
    },
    delta: () => {},
    setState: (s) => states.push(s),
    chat: (body, signal) => {
      bodies.push(body);
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next(signal);
    },
    executeTool: async (call) => ({ result: { ok: true, echoed: call.name } }),
    imageUrl: async (aid) => `data:image/jpeg;base64,${aid}`,
    newId: () => `m${++id}`,
    profileId: "p",
    vision: true,
    systemPrompt: "sys",
    tools: [],
    sleep: async () => {},
    ...overrides,
  };
  return { deps, messages, states, persisted, bodies };
}

describe("runTurn", () => {
  it("completes a plain reply and returns to idle", async () => {
    const h = harness([async () => streamResponse(text("Hello"))]);
    await runTurn(h.deps, new AbortController().signal);
    expect(h.messages.at(-1)).toMatchObject({ role: "assistant", status: "complete", content: "Hello" });
    expect(h.states.at(-1)).toBe("idle");
  });

  it("runs tools then continues, sending tool results back", async () => {
    const h = harness([async () => streamResponse(toolCall("c1", "read_prompt")), async () => streamResponse(text("done"))]);
    await runTurn(h.deps, new AbortController().signal);
    expect(h.messages.map((m) => `${m.role}:${m.status}`)).toEqual(["user:complete", "assistant:complete", "tool:complete", "assistant:complete"]);
    const second = h.bodies[1].messages;
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true, echoed: "read_prompt" }) });
    expect(h.states).toContain("tool_running");
  });

  it("retries network failures before the first byte, then gives up with an error message", async () => {
    let calls = 0;
    const fail = async () => {
      calls++;
      throw new ApiError(502, "NETWORK", "down");
    };
    const h = harness([fail, fail, fail]);
    await runTurn(h.deps, new AbortController().signal);
    expect(calls).toBe(3);
    expect(h.messages.at(-1)).toMatchObject({ role: "assistant", status: "error" });
    expect(h.states.at(-1)).toBe("idle");
  });

  it("does not retry auth errors", async () => {
    let calls = 0;
    const h = harness([async () => { calls++; throw new ApiError(401, "AUTH", "bad"); }]);
    await runTurn(h.deps, new AbortController().signal);
    expect(calls).toBe(1);
    expect(h.messages.at(-1)?.error).toBe("API Key 无效或没有权限");
  });

  it("stop during streaming keeps partial text, marks stopped, and returns to idle", async () => {
    const controller = new AbortController();
    const h = harness([
      async (signal) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(text("part").replace("data: [DONE]\n\n", "")));
            signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
          },
        });
        setTimeout(() => controller.abort(), 10);
        return new Response(stream);
      },
    ]);
    await runTurn(h.deps, controller.signal);
    expect(h.messages.at(-1)).toMatchObject({ status: "stopped", content: "part" });
    expect(h.states.at(-1)).toBe("idle");
    expect(h.messages.some((m) => m.status === "streaming")).toBe(false);
  });

  it("stops at the tool round limit", async () => {
    const responses = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => async () => streamResponse(toolCall(`c${i}`, "read_prompt")));
    const h = harness(responses);
    await runTurn(h.deps, new AbortController().signal);
    expect(h.messages.at(-1)).toMatchObject({ status: "error", error: "已达到单轮工具调用上限" });
  });

  it("tool exceptions become error results, not crashes", async () => {
    const h = harness([async () => streamResponse(toolCall("c1", "edit_prompt")), async () => streamResponse(text("ok"))], {
      executeTool: async () => {
        throw new Error("dom gone");
      },
    });
    await runTurn(h.deps, new AbortController().signal);
    const tool = h.messages.find((m) => m.role === "tool")!;
    expect(tool.status).toBe("error");
    expect(JSON.parse(tool.content).error.message).toBe("dom gone");
  });
});

describe("buildContext", () => {
  const opts = { systemPrompt: "sys", vision: true, imageUrl: async (id: string) => `url:${id}` };

  it("fills missing tool results for interrupted calls and sanitizes bad arguments", async () => {
    const history = [
      blankMessage("u", "user", { content: "go" }),
      blankMessage("a", "assistant", { status: "interrupted", tool_calls: [{ id: "c1", name: "read_prompt", arguments: "{\"tar" }] }),
      blankMessage("u2", "user", { content: "again" }),
    ];
    const wire = await buildContext(history, opts);
    expect(wire.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect((wire[2] as any).tool_calls[0].function.arguments).toBe("{}");
  });

  it("keeps only the latest image messages and omits others with a placeholder", async () => {
    const history = Array.from({ length: 5 }, (_, i) => blankMessage(`u${i}`, "user", { content: `m${i}`, attachments: [{ id: `a${i}`, width: 1, height: 1 }] }));
    const wire = await buildContext(history, opts);
    const urls = JSON.stringify(wire);
    expect(urls).toContain("url:a4");
    expect(urls).toContain("url:a2");
    expect(urls).not.toContain("url:a1");
    expect(urls).toContain("[图片 a0 已省略");
  });

  it("sends no images to non-vision models", async () => {
    const history = [blankMessage("u", "user", { content: "x", attachments: [{ id: "a", width: 1, height: 1 }] })];
    const wire = await buildContext(history, { ...opts, vision: false });
    expect(JSON.stringify(wire)).not.toContain("url:a");
  });

  it("passes reasoning back only within the current turn and moves tool images into a user message", async () => {
    const history = [
      blankMessage("u", "user", { content: "1" }),
      blankMessage("a", "assistant", { content: "old", reasoning: "old thoughts" }),
      blankMessage("u2", "user", { content: "2" }),
      blankMessage("b", "assistant", { reasoning: "new thoughts", tool_calls: [{ id: "c", name: "read_latest_image", arguments: "{}" }] }),
      blankMessage("t", "tool", { tool_call_id: "c", tool_name: "read_latest_image", content: "{}", attachments: [{ id: "img", width: 1, height: 1 }] }),
    ];
    const wire = await buildContext(history, opts);
    expect((wire[2] as any).reasoning_content).toBeUndefined();
    expect((wire[4] as any).reasoning_content).toBe("new thoughts");
    expect(wire.at(-1)).toMatchObject({ role: "user" });
    expect(JSON.stringify(wire.at(-1))).toContain("url:img");
  });
});
