import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { PiPromptAgentRuntime } from "../src/agent/agent-runtime";
import { toPromptAgentModel } from "../src/providers/proxy-model";
import { acceptanceTest } from "./acceptance";

const model = toPromptAgentModel({
  id: "test-model",
  providerId: "test",
  displayName: "Test",
  capabilities: { streaming: true, tools: false, vision: false, reasoning: false, attachments: false, systemPrompt: true },
  contextWindow: 8192,
  maxTokens: 1024,
});

const successfulStream: StreamFn = (activeModel) => {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "Hello" }],
    api: activeModel.api,
    provider: activeModel.provider,
    model: activeModel.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "done", reason: "stop", message });
    stream.end();
  });
  return stream;
};

const failedStream: StreamFn = (activeModel) => {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "" }],
    api: activeModel.api,
    provider: activeModel.provider,
    model: activeModel.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error" as const,
    errorMessage: "provider unavailable",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "error", reason: "error", error: message });
    stream.end();
  });
  return stream;
};

function abortableStream(onAbort: () => void): StreamFn {
  return (activeModel, _context, options = {}) => {
    const stream = createAssistantMessageEventStream();
    const partial = {
      role: "assistant" as const,
      content: [] as Array<{ type: "text"; text: string }>,
      api: activeModel.api,
      provider: activeModel.provider,
      model: activeModel.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
    queueMicrotask(() => stream.push({ type: "start", partial }));
    const finishAbort = () => {
      onAbort();
      const error = { ...partial, stopReason: "aborted" as const, errorMessage: "Request aborted" };
      stream.push({ type: "error", reason: "aborted", error });
      stream.end();
    };
    if (options.signal?.aborted) queueMicrotask(finishAbort);
    else options.signal?.addEventListener("abort", finishAbort, { once: true });
    return stream;
  };
}

function streamMessage(activeModel: typeof model, content: any[], reason: "stop" | "toolUse" = "stop") {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const,
    content,
    api: activeModel.api,
    provider: activeModel.provider,
    model: activeModel.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: reason,
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "done", reason, message });
    stream.end();
  });
  return stream;
}

describe("PiPromptAgentRuntime", () => {
  it("owns the transcript and reaches completed state", async () => {
    const runtime = new PiPromptAgentRuntime({ model, streamFn: successfulStream });
    const statuses: string[] = [];
    runtime.subscribe((state) => statuses.push(state.status));
    await runtime.submit({ text: "Hi" });
    expect(runtime.getMessages().map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(runtime.getState().status).toBe("completed");
    expect(statuses).toContain("submitting");
    runtime.destroy();
  });

  acceptanceTest("AGENT-TOOLS-001@9", "parallel-reads,serialized-writes", "runs independent read batches concurrently while serializing any batch that contains a write", async () => {
    async function peakConcurrency(modes: Array<"parallel" | "sequential">): Promise<number> {
      let turn = 0;
      let active = 0;
      let peak = 0;
      const tools: AgentTool<any>[] = modes.map((executionMode, index) => ({
        name: `tool_${index}`,
        label: `Tool ${index}`,
        description: "Concurrency probe",
        parameters: Type.Object({}),
        executionMode,
        execute: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return { content: [{ type: "text", text: "ok" }], details: { ok: true } };
        },
      }));
      const streamFn: StreamFn = (activeModel) => {
        turn += 1;
        return turn === 1
          ? streamMessage(activeModel as typeof model, tools.map((tool, index) => ({ type: "toolCall", id: `call-${index}`, name: tool.name, arguments: {} })), "toolUse")
          : streamMessage(activeModel as typeof model, [{ type: "text", text: "done" }]);
      };
      const runtime = new PiPromptAgentRuntime({ model, streamFn, tools });
      await runtime.submit({ text: "Run the independent checks" });
      runtime.destroy();
      return peak;
    }

    await expect(peakConcurrency(["parallel", "parallel", "parallel"])).resolves.toBe(3);
    await expect(peakConcurrency(["parallel", "sequential", "parallel"])).resolves.toBe(1);
  });

  it("rejects use after destroy", async () => {
    const runtime = new PiPromptAgentRuntime({ model, streamFn: successfulStream });
    runtime.destroy();
    await expect(runtime.submit({ text: "Hi" })).rejects.toThrow("destroyed");
  });

  it("produces a terminal failed state when the provider fails", async () => {
    const runtime = new PiPromptAgentRuntime({ model, streamFn: failedStream });

    await runtime.submit({ text: "Hi" });

    expect(runtime.getState()).toMatchObject({
      status: "failed",
      error: { code: "provider_error", message: "provider unavailable" },
    });
    runtime.destroy();
  });

  it("replaces the transcript while idle for edit-and-resend", () => {
    const runtime = new PiPromptAgentRuntime({
      model,
      streamFn: successfulStream,
      messages: [
        { role: "user", content: "Original", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: "Old reply" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: 2,
        },
      ],
    });

    runtime.replaceMessages([{ role: "user", content: "Earlier context", timestamp: 3 }]);

    expect(runtime.getMessages()).toEqual([{ role: "user", content: "Earlier context", timestamp: 3 }]);
    expect(runtime.getState().status).toBe("idle");
    runtime.destroy();
  });

  it("injects bounded corrective follow-ups until a requested prompt edit succeeds", async () => {
    let call = 0;
    const contexts: any[] = [];
    const editPrompt: AgentTool<any> = {
      name: "edit_prompt",
      label: "Edit prompt",
      description: "Edit prompt",
      parameters: Type.Object({ base_hash: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    };
    const streamFn: StreamFn = (activeModel, context) => {
      contexts.push(context);
      call += 1;
      if (call === 1) return streamMessage(activeModel as typeof model, [{ type: "text", text: "Here is some advice instead." }]);
      if (call === 2) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "edit-1", name: "edit_prompt", arguments: { base_hash: "fresh" } }], "toolUse");
      return streamMessage(activeModel as typeof model, [{ type: "text", text: "Prompt updated." }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn, tools: [editPrompt] });

    await runtime.submit({ text: "Rewrite the current prompt", requirePromptMutation: true });

    expect(call).toBe(3);
    expect(contexts[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("no edit_prompt call has succeeded"),
    });
    expect(runtime.getMessages().some((message) => message.role === "promptAgentControl")).toBe(false);
    expect(runtime.getMessages().some((message) => message.role === "assistant" && message.content.some((block) => block.type === "text" && block.text.includes("advice instead")))).toBe(false);
    expect(runtime.getState()).toMatchObject({ status: "completed", error: undefined });

    await runtime.submit({ text: "Summarize the result" });
    expect(contexts[3].messages.some((message: any) => (
      message.role === "user" && typeof message.content === "string" && message.content.includes("no edit_prompt call has succeeded")
    ))).toBe(false);
    runtime.destroy();
  });

  acceptanceTest("PROMPT-TOOLKIT-001@2", "natural-language-write", "blocks a tag-only edit when the user requested natural-language prompt content", async () => {
    let call = 0;
    const executed: unknown[] = [];
    const editPrompt: AgentTool<any> = {
      name: "edit_prompt",
      label: "Edit prompt",
      description: "Edit prompt",
      parameters: Type.Object({
        base_hash: Type.String(),
        patches: Type.Array(Type.Any()),
      }),
      execute: async (_id, args) => {
        executed.push(args);
        return { content: [{ type: "text", text: "edited" }], details: { ok: true } };
      },
    };
    const streamFn: StreamFn = (activeModel) => {
      call += 1;
      if (call === 1) return streamMessage(activeModel as typeof model, [{
        type: "toolCall",
        id: "tag-only",
        name: "edit_prompt",
        arguments: {
          base_hash: "fresh",
          patches: [{ operation: "replace", find: "old prompt", replace: "1boy, solo, blue eyes, underwater, flat color" }],
        },
      }], "toolUse");
      if (call === 2) return streamMessage(activeModel as typeof model, [{
        type: "toolCall",
        id: "with-nl",
        name: "edit_prompt",
        arguments: {
          base_hash: "fresh",
          patches: [{
            operation: "replace",
            find: "old prompt",
            replace: "1boy, solo. A young man floats upside down beneath a rippling water surface, with loose ribbons rising around him.",
          }],
        },
      }], "toolUse");
      return streamMessage(activeModel as typeof model, [{ type: "text", text: "Added a natural-language scene block." }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn, tools: [editPrompt] });

    await runtime.submit({
      text: "写点 NL，不要再只写 tag",
      requirePromptMutation: true,
      requireNaturalLanguagePrompt: true,
    });

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ patches: [expect.objectContaining({ replace: expect.stringContaining("floats upside down") })] });
    expect(runtime.getMessages()).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", toolName: "edit_prompt", isError: true }),
    ]));
    expect(runtime.getState()).toMatchObject({ status: "completed", error: undefined });
    runtime.destroy();
  });

  acceptanceTest("PROMPT-TOOLKIT-001@2", "toolkit-before-write", "blocks deterministic prompt cleanup writes until prompt_toolkit succeeds", async () => {
    let call = 0;
    const executed: string[] = [];
    const editPrompt: AgentTool<any> = {
      name: "edit_prompt",
      label: "Edit prompt",
      description: "Edit prompt",
      parameters: Type.Object({ base_hash: Type.String() }),
      execute: async () => {
        executed.push("edit_prompt");
        return { content: [{ type: "text", text: "edited" }], details: { ok: true } };
      },
    };
    const promptToolkit: AgentTool<any> = {
      name: "prompt_toolkit",
      label: "Prompt toolkit",
      description: "Normalize prompt deterministically",
      parameters: Type.Object({ action: Type.String(), prompt: Type.String() }),
      execute: async () => {
        executed.push("prompt_toolkit");
        return { content: [{ type: "text", text: "analyzed" }], details: { ok: true } };
      },
    };
    const streamFn: StreamFn = (activeModel) => {
      call += 1;
      if (call === 1) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "edit-too-early", name: "edit_prompt", arguments: { base_hash: "fresh" } }], "toolUse");
      if (call === 2) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "toolkit-1", name: "prompt_toolkit", arguments: { action: "sort", prompt: "1girl, blue eyes" } }], "toolUse");
      if (call === 3) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "edit-allowed", name: "edit_prompt", arguments: { base_hash: "fresh" } }], "toolUse");
      return streamMessage(activeModel as typeof model, [{ type: "text", text: "Prompt sorted." }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn, tools: [editPrompt, promptToolkit] });

    await runtime.submit({ text: "Sort the current prompt tags", requirePromptMutation: true, requirePromptToolkit: true });

    expect(call).toBe(4);
    expect(executed).toEqual(["prompt_toolkit", "edit_prompt"]);
    expect(runtime.getMessages()).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", toolName: "edit_prompt", isError: true }),
      expect.objectContaining({ role: "toolResult", toolName: "prompt_toolkit", isError: false }),
    ]));
    expect(runtime.getState()).toMatchObject({ status: "completed", error: undefined });
    runtime.destroy();
  });

  it("fails visibly after bounded correction when a requested prompt edit never happens", async () => {
    let call = 0;
    const streamFn: StreamFn = (activeModel) => {
      call += 1;
      return streamMessage(activeModel as typeof model, [{ type: "text", text: `Advice ${call}` }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn });

    await runtime.submit({ text: "Rewrite the current prompt", requirePromptMutation: true });

    expect(call).toBe(3);
    expect(runtime.getState()).toMatchObject({
      status: "failed",
      error: { code: "prompt_mutation_incomplete" },
    });
    expect(runtime.getMessages().filter((message) => message.role === "assistant")).toEqual([]);
    runtime.destroy();
  });

  acceptanceTest("AGENT-LOOKUP-001@2", "style-first,unverified-hidden", "suppresses a direct background answer until a matching Forge style is inspected", async () => {
    let call = 0;
    const contexts: any[] = [];
    const choices: unknown[] = [];
    const searchStyles: AgentTool<any> = {
      name: "search_resources",
      label: "Search resources",
      description: "Search resources",
      parameters: Type.Object({ kind: Type.String(), query: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "style match" }], details: { ok: true, kind: "style", items: [{ id: "moqing" }] } }),
    };
    const inspectStyle: AgentTool<any> = {
      name: "inspect_resource",
      label: "Inspect resource",
      description: "Inspect resource",
      parameters: Type.Object({ kind: Type.String(), id: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "trigger words" }], details: { ok: true, kind: "style", id: "moqing" } }),
    };
    const streamFn: StreamFn = (activeModel, context, options) => {
      contexts.push(context);
      choices.push((options as { toolChoice?: string }).toolChoice);
      call += 1;
      if (call === 1) return streamMessage(activeModel as typeof model, [{ type: "text", text: "Moqing is definitely ..." }]);
      if (call === 2) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "search-1", name: "search_resources", arguments: { kind: "style", query: "moqing" } }], "toolUse");
      if (call === 3) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "inspect-1", name: "inspect_resource", arguments: { kind: "style", id: "moqing" } }], "toolUse");
      return streamMessage(activeModel as typeof model, [{ type: "text", text: "The local Forge style says ..." }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn, tools: [searchStyles, inspectStyle] });

    await runtime.submit({ text: "moqing 是谁？", requireBackgroundLookup: true });

    expect(call).toBe(4);
    expect(choices).toEqual(["search_resources", "search_resources", "inspect_resource", undefined]);
    expect(contexts[1].messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Forge style templates") });
    expect(runtime.getMessages().some((message) => message.role === "assistant" && message.content.some((block) => block.type === "text" && block.text.includes("definitely")))).toBe(false);
    expect(runtime.getMessages().some((message) => message.role === "toolResult")).toBe(true);
    expect(runtime.getState()).toMatchObject({ status: "completed", error: undefined });
    runtime.destroy();
  });

  acceptanceTest("AGENT-LOOKUP-001@2", "fallback", "searches then inspects a Danbooru Wiki only when no Forge style matches", async () => {
    let call = 0;
    let inspection = 0;
    const choices: unknown[] = [];
    const searchStyles: AgentTool<any> = {
      name: "search_resources",
      label: "Search resources",
      description: "Search resources",
      parameters: Type.Object({ kind: Type.String(), query: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "no styles" }], details: { ok: true, kind: "style", items: [] } }),
    };
    const searchWikis: AgentTool<any> = {
      name: "search_danbooru_wikis",
      label: "Search Wikis",
      description: "Search Wikis",
      parameters: Type.Object({ query: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "candidate" }], details: { ok: true, items: [{ canonical_title: "moqing" }] } }),
    };
    const inspectWikis: AgentTool<any> = {
      name: "inspect_danbooru_wikis",
      label: "Inspect Wikis",
      description: "Inspect Wikis",
      parameters: Type.Object({ titles: Type.Array(Type.String()) }),
      execute: async () => {
        inspection += 1;
        const item = inspection === 1
          ? { canonical_title: "moqing", url: "https://danbooru.donmai.us/wiki_pages/moqing" }
          : { canonical_title: "moqing", body: "Verified Danbooru Wiki body." };
        return { content: [{ type: "text", text: "wiki result" }], details: { ok: true, items: [item] } };
      },
    };
    const streamFn: StreamFn = (activeModel, _context, options) => {
      choices.push((options as { toolChoice?: string }).toolChoice);
      call += 1;
      if (call === 1) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "search-1", name: "search_resources", arguments: { kind: "style", query: "moqing" } }], "toolUse");
      if (call === 2) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "wiki-search-1", name: "search_danbooru_wikis", arguments: { query: "moqing" } }], "toolUse");
      if (call === 3) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "wiki-inspect-1", name: "inspect_danbooru_wikis", arguments: { titles: ["moqing"] } }], "toolUse");
      if (call === 4) return streamMessage(activeModel as typeof model, [{ type: "toolCall", id: "wiki-inspect-2", name: "inspect_danbooru_wikis", arguments: { titles: ["moqing"] } }], "toolUse");
      return streamMessage(activeModel as typeof model, [{ type: "text", text: "No local style matched; Danbooru reports ..." }]);
    };
    const runtime = new PiPromptAgentRuntime({ model, streamFn, tools: [searchStyles, searchWikis, inspectWikis] });

    await runtime.submit({ text: "moqing 是谁？", requireBackgroundLookup: true });

    expect(choices).toEqual(["search_resources", "search_danbooru_wikis", "inspect_danbooru_wikis", "inspect_danbooru_wikis", undefined]);
    expect(runtime.getState()).toMatchObject({ status: "completed", error: undefined });
    runtime.destroy();
  });

  it("propagates abort to the active stream and reaches a terminal state", async () => {
    let aborted = false;
    const runtime = new PiPromptAgentRuntime({ model, streamFn: abortableStream(() => { aborted = true; }) });
    const submission = runtime.submit({ text: "Hi" });
    await vi.waitFor(() => expect(runtime.getState().status).not.toBe("idle"));

    runtime.abort();
    await submission;

    expect(aborted).toBe(true);
    expect(runtime.getState()).toMatchObject({ status: "failed", error: { code: "runtime_aborted" } });
    runtime.destroy();
  });

  it("destroy aborts in-flight work and removes subscribers", async () => {
    let aborted = false;
    let notifications = 0;
    const runtime = new PiPromptAgentRuntime({ model, streamFn: abortableStream(() => { aborted = true; }) });
    runtime.subscribe(() => { notifications += 1; });
    const submission = runtime.submit({ text: "Hi" });
    await vi.waitFor(() => expect(notifications).toBeGreaterThan(1));
    const beforeDestroy = notifications;

    runtime.destroy();
    await submission;

    expect(aborted).toBe(true);
    expect(notifications).toBe(beforeDestroy);
  });
});
