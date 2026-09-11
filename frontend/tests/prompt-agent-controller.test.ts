import { createDefaultProfileState } from "../src/profile-adapter";
import { PromptAgentController, userRequestedBackgroundLookup, userRequestedNaturalLanguagePrompt, userRequestedPromptMutation, userRequestedPromptToolkit } from "../src/agent/controller";
import { useChatStore } from "../src/stores/chat";
import { useProfileStore } from "../src/stores/profiles";
import { useRuntimeStore } from "../src/stores/runtime";
import type { PromptAgentMessage, PromptAgentSession } from "../src/sessions/schema";
import type { PromptAgentHostApi } from "../src/bridge";
import { acceptanceTest } from "./acceptance";

const repository = {
  putSession: vi.fn(async (): Promise<void> => undefined),
  getSession: vi.fn(async (): Promise<PromptAgentSession | undefined> => undefined),
  listSessions: vi.fn(async (): Promise<PromptAgentSession[]> => []),
  putMessage: vi.fn(async (_message: PromptAgentMessage): Promise<void> => undefined),
  getMessages: vi.fn(async (): Promise<PromptAgentMessage[]> => []),
  deleteMessages: vi.fn(async (_ids: string[]) => 0),
  putPreference: vi.fn(async (): Promise<void> => undefined),
  getPreference: vi.fn(async () => undefined),
  markInterrupted: vi.fn(async () => 0),
};

const installFetch = (stream?: () => Response | Promise<Response>): void => {
  const profiles = createDefaultProfileState();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
    if (stream) return stream();
    return new Response([
      'data: {"type":"start"}',
      'data: {"type":"text_start","contentIndex":0}',
      'data: {"type":"text_delta","contentIndex":0,"delta":"Done"}',
      'data: {"type":"text_end","contentIndex":0}',
      'data: {"type":"done","reason":"stop"}',
      "",
    ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }));
};

const textResponse = (text = "Done"): Response => new Response([
  'data: {"type":"start"}',
  'data: {"type":"text_start","contentIndex":0}',
  `data: ${JSON.stringify({ type: "text_delta", contentIndex: 0, delta: text })}`,
  'data: {"type":"text_end","contentIndex":0}',
  'data: {"type":"done","reason":"stop"}',
  "",
].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });

describe("PromptAgentController recovery", () => {
  beforeEach(() => {
    repository.putSession.mockReset().mockResolvedValue(undefined);
    repository.getSession.mockReset().mockResolvedValue(undefined);
    repository.listSessions.mockReset().mockResolvedValue([]);
    repository.putMessage.mockReset().mockResolvedValue(undefined);
    repository.getMessages.mockReset().mockResolvedValue([]);
    repository.deleteMessages.mockReset().mockResolvedValue(0);
    repository.putPreference.mockReset().mockResolvedValue(undefined);
    repository.getPreference.mockReset().mockResolvedValue(undefined);
    repository.markInterrupted.mockReset().mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
    useProfileStore.getState().reset();
    useRuntimeStore.getState().reset();
    delete window.__SD_FORGE_NEO_PROMPT_AGENT__;
  });

  it("re-enables the composer when persistence rejects after generation", async () => {
    installFetch();
    repository.putMessage.mockRejectedValue(new Error("session write failed"));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    await expect(controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" })).rejects.toThrow("session write failed");

    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");
    controller.destroy();
  });

  it("drains queued follow-ups in FIFO order only after the active response completes", async () => {
    const profiles = createDefaultProfileState();
    let releaseFirst!: () => void;
    let streamRequests = 0;
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      bodies.push(JSON.parse(String(init?.body)));
      streamRequests += 1;
      if (streamRequests === 1) return await new Promise<Response>((resolve) => { releaseFirst = () => resolve(textResponse("First done")); });
      return textResponse(`Follow-up ${streamRequests - 1}`);
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const first = controller.actions.sendMessage({ text: "First", attachments: [], reasoning: "none" });
    await vi.waitFor(() => expect(useChatStore.getState().activeRequestId).toBeTruthy());
    await vi.waitFor(() => expect(streamRequests).toBe(1));
    controller.actions.queueMessage({ text: "Second", attachments: [], reasoning: "low" });
    controller.actions.queueMessage({ text: "Third", attachments: [], reasoning: "low" });
    expect(useRuntimeStore.getState().queuedFollowUps.map((item) => item.text)).toEqual(["Second", "Third"]);
    expect(streamRequests).toBe(1);

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(streamRequests).toBe(3));
    await vi.waitFor(() => expect(useRuntimeStore.getState().queuedFollowUps).toEqual([]));
    await vi.waitFor(() => expect(useChatStore.getState().messages.at(-1)?.content).toBe("Follow-up 2"));
    const submittedTexts = bodies.map((body) => body.context.messages.findLast((message: any) => message.role === "user")?.content?.find((block: any) => block.type === "text")?.text);
    expect(submittedTexts).toEqual(["First", "Second", "Third"]);
    controller.destroy();
  });

  it("keeps a follow-up paused after failure and resumes it explicitly", async () => {
    const profiles = createDefaultProfileState();
    let releaseFailure!: () => void;
    let streamRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      streamRequests += 1;
      if (streamRequests === 1) return await new Promise<Response>((resolve) => {
        releaseFailure = () => resolve(new Response([
          'data: {"type":"start"}',
          'data: {"type":"error","reason":"error","errorMessage":"provider unavailable"}',
          "",
        ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      });
      return textResponse("Recovered");
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const first = controller.actions.sendMessage({ text: "First", attachments: [], reasoning: "none" });
    await vi.waitFor(() => expect(useChatStore.getState().activeRequestId).toBeTruthy());
    await vi.waitFor(() => expect(streamRequests).toBe(1));
    controller.actions.queueMessage({ text: "Keep me", attachments: [], reasoning: "low" });
    releaseFailure();
    await first;

    expect(streamRequests).toBe(1);
    expect(useRuntimeStore.getState().queuedFollowUps.map((item) => item.text)).toEqual(["Keep me"]);
    await controller.actions.resumeQueuedMessages();
    await vi.waitFor(() => expect(streamRequests).toBe(2));
    await vi.waitFor(() => expect(useRuntimeStore.getState().queuedFollowUps).toEqual([]));
    controller.destroy();
  });

  it("cancels safely during profile preparation and leaves queued work paused", async () => {
    const profiles = createDefaultProfileState();
    let streamRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      streamRequests += 1;
      return textResponse();
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();
    let releaseProfile!: () => void;
    repository.putSession.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseProfile = resolve; }));

    const submission = controller.actions.sendMessage({ text: "First", attachments: [], reasoning: "none" });
    await vi.waitFor(() => expect(useChatStore.getState().activeRequestId).toBeTruthy());
    controller.actions.queueMessage({ text: "Keep queued", attachments: [], reasoning: "low" });
    controller.actions.stopRequest();
    releaseProfile();
    await submission;

    expect(streamRequests).toBe(0);
    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().queuedFollowUps.map((item) => item.text)).toEqual(["Keep queued"]);
    controller.destroy();
  });

  it("keeps the IndexedDB-backed controller usable when server sync is offline", async () => {
    installFetch();
    const offlineRepository = {
      ...repository,
      syncWithServer: vi.fn(async () => { throw new Error("offline"); }),
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new PromptAgentController(offlineRepository);

    await expect(controller.mount()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("Prompt Agent session sync is temporarily unavailable", expect.any(Error)));

    expect(useRuntimeStore.getState().startup).toBe("ready");
    expect(useRuntimeStore.getState().sessionId).toBeTruthy();
    controller.destroy();
  });

  it("resolves a terminal send even while server sync is still pending", async () => {
    installFetch();
    const offline = {
      ...repository,
      syncWithServer: vi.fn(async () => ({ conflicts: [] })),
    };
    const controller = new PromptAgentController(offline);
    await controller.mount();
    offline.syncWithServer.mockImplementation(() => new Promise<never>(() => {}));

    await controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });

    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");
    controller.destroy();
  });

  it("does not fail a send when background history reload rejects", async () => {
    installFetch();
    const controller = new PromptAgentController(repository);
    await controller.mount();
    repository.listSessions.mockRejectedValueOnce(new Error("history failed"));

    await controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });

    expect(useChatStore.getState().activeRequestId).toBeNull();
    controller.destroy();
  });

  acceptanceTest("MODEL-PROFILE-001@3", "hot-reload", "rebinds the current conversation to the latest active profile before sending", async () => {
    const profiles = createDefaultProfileState();
    const original = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId)!;
    const grok = { ...original, id: "grok", displayName: "Grok", modelId: "grok-4", providerId: "openai-compatible" };
    profiles.profiles.push(grok);
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      bodies.push(JSON.parse(String(init?.body)));
      return new Response([
        'data: {"type":"start"}',
        'data: {"type":"text_start","contentIndex":0}',
        'data: {"type":"text_delta","contentIndex":0,"delta":"Done"}',
        'data: {"type":"text_end","contentIndex":0}',
        'data: {"type":"done","reason":"stop"}',
        "",
      ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    useProfileStore.getState().activateProfile(grok.id);
    await controller.actions.sendMessage({ text: "Hello Grok", attachments: [], reasoning: "none" });

    expect(bodies.find((body) => body.context)).toMatchObject({ profile_id: grok.id });
    expect(repository.putSession).toHaveBeenCalledWith(expect.objectContaining({
      profileId: grok.id,
      modelId: grok.modelId,
    }));
    controller.destroy();
  });

  it("serializes runtime writes against the session that produced them", async () => {
    installFetch();
    let releaseFirst: (() => void) | undefined;
    repository.putMessage.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    repository.putMessage.mockImplementation(async () => undefined);
    const controller = new PromptAgentController(repository);
    await controller.mount();
    const sessionId = useRuntimeStore.getState().sessionId;
    const submission = controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });

    await vi.waitFor(() => expect(repository.putMessage).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(repository.putMessage).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await submission;
    await vi.waitFor(() => expect(repository.putMessage.mock.calls.at(-1)?.[0].status).toBe("complete"));

    expect(repository.putMessage.mock.calls.every(([message]) => message.sessionId === sessionId)).toBe(true);
    const statuses = repository.putMessage.mock.calls.map(([message]) => message.status);
    expect(statuses.at(-1)).toBe("complete");
    controller.destroy();
  });

  acceptanceTest("SESSION-LIFECYCLE-001@3", "failure,recovery", "restores the composer after a terminal provider failure", async () => {
    installFetch(() => new Response([
      'data: {"type":"start"}',
      'data: {"type":"error","reason":"error","errorMessage":"provider unavailable"}',
      "",
    ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    repository.putMessage.mockImplementation(async () => undefined);
    const controller = new PromptAgentController(repository);
    await controller.mount();

    await controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });

    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");
    expect(useRuntimeStore.getState().error).toBe("provider unavailable");
    controller.destroy();
  });

  acceptanceTest("SESSION-LIFECYCLE-001@3", "abort,recovery", "aborts the provider request and restores the composer", async () => {
    let requestAborted = false;
    let requestStarted = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(createDefaultProfileState()), { status: 200 });
      requestStarted = true;
      const signal = init?.signal;
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode('data: {"type":"start"}\n\n'));
          const finishAbort = () => {
            requestAborted = true;
            try { streamController.close(); } catch { /* already closed */ }
          };
          if (signal?.aborted) queueMicrotask(finishAbort);
          else signal?.addEventListener("abort", finishAbort, { once: true });
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));
    repository.putMessage.mockImplementation(async () => undefined);
    const controller = new PromptAgentController(repository);
    await controller.mount();
    const submission = controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });
    await vi.waitFor(() => expect(useChatStore.getState().activeRequestId).not.toBeNull());
    await vi.waitFor(() => expect(requestStarted).toBe(true));

    controller.actions.stopRequest();
    await submission;

    expect(requestAborted).toBe(true);
    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");
    controller.destroy();
  });

  acceptanceTest("IMAGE-INPUT-001@2", "visual-grounding,bilingual-caption", "passes image-grounding and bilingual caption rules into the runtime", async () => {
    installFetch();
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const runtime = (controller as unknown as { runtime: {
      getTools(): Array<{ name: string }>;
      getSystemPrompt(): string;
    } }).runtime;
    expect(runtime.getTools().map((tool) => tool.name)).toEqual([
      "read_prompt",
      "edit_prompt",
      "read_generation_parameters",
      "apply_generation_parameters",
      "generate_image",
      "prompt_toolkit",
      "load_skill",
      "load_tools",
    ]);
    expect(runtime.getSystemPrompt()).toContain("read prompts or generation parameters before changing them");
    expect(runtime.getSystemPrompt()).toContain("correct the arguments or refresh stale Forge state");
    expect(runtime.getSystemPrompt()).toContain("search_danbooru_tags");
    expect(runtime.getSystemPrompt()).toContain("first call load_tools with the matching group name");
    expect(runtime.getSystemPrompt()).toContain("natural-language descriptions and Danbooru-style tags are both first-class");
    expect(runtime.getSystemPrompt()).toContain("Text in a disabled negative field is editable but not effective");
    expect(runtime.getSystemPrompt()).toContain("inspect every image and build a factual per-image visual inventory");
    expect(runtime.getSystemPrompt()).toContain("visible content, visual style, and composition");
    expect(runtime.getSystemPrompt()).toContain("Version 1 is detailed, objective, neutral English natural language");
    expect(runtime.getSystemPrompt()).toContain("Version 2 conveys the same evidence, order, continuity, and detail in natural, purely Chinese language");
    expect(runtime.getSystemPrompt()).toContain("continuous order of image content, visual style, then composition");
    expect(runtime.getSystemPrompt()).toContain("do not turn the result into disconnected bullets, tag fragments, or independent captions");
    expect(runtime.getSystemPrompt()).toContain("A tag-only edit does not satisfy a natural-language request");
    expect(runtime.getSystemPrompt()).toContain("Treat names such as Frutiger Aero as brainstorming seeds");
    expect(runtime.getSystemPrompt()).toContain("scene objects, environment, materials, lighting, palette, atmosphere, and composition");
    expect(runtime.getSystemPrompt()).toContain("search_danbooru_wikis");
    expect(runtime.getSystemPrompt()).toContain("inspect_danbooru_wikis");
    expect(runtime.getSystemPrompt()).toContain("Follow only the relevant next-hop references");
    expect(runtime.getSystemPrompt()).toContain("read_generation_parameters reports the active Forge preset, checkpoint, and a recommended_skill");
    expect(runtime.getSystemPrompt()).toContain("whenever it recommends a skill, call load_skill with that name before writing or revising prompts");
    expect(runtime.getSystemPrompt()).toContain("Before constructing multi-character or regional prompts for Forge Couple, call load_skill with forge_couple");
    expect(runtime.getSystemPrompt()).toContain("Danbooru canonical status is required only for an explicitly requested Danbooru catalog");
    expect(runtime.getSystemPrompt()).toContain("autocomplete/auto-fill");
    controller.destroy();
  });

  it("detects direct prompt mutation requests without treating advice questions as writes", () => {
    expect(userRequestedPromptMutation("把当前提示词改写成雨夜霓虹场景")).toBe(true);
    expect(userRequestedPromptMutation("Rewrite the current prompt with stronger rim light")).toBe(true);
    expect(userRequestedPromptMutation("改成这种风格的 先解压视觉信息")).toBe(true);
    expect(userRequestedPromptMutation("这个提示词应该怎么改？")).toBe(false);
    expect(userRequestedPromptMutation("Review the composition and suggest improvements")).toBe(false);
  });

  it("detects explicit NL writes and attached-image style transfers without overriding tags-only requests", () => {
    expect(userRequestedNaturalLanguagePrompt("写点 NL，不要再只写 tag")).toBe(true);
    expect(userRequestedNaturalLanguagePrompt("加一段自然语言描述到当前提示词")).toBe(true);
    expect(userRequestedNaturalLanguagePrompt("改成这种风格的 先解压视觉信息", true)).toBe(true);
    expect(userRequestedNaturalLanguagePrompt("只用 tag 改成这种风格", true)).toBe(false);
    expect(userRequestedNaturalLanguagePrompt("NL prompt 应该怎么写？")).toBe(false);
    expect(userRequestedNaturalLanguagePrompt("改成这种风格的 先解压视觉信息", false)).toBe(false);
  });

  it("requires the deterministic toolkit for prompt cleanup operations", () => {
    expect(userRequestedPromptToolkit("把当前提示词去重并按标签类别排序")).toBe(true);
    expect(userRequestedPromptToolkit("Normalize this negative prompt")).toBe(true);
    expect(userRequestedPromptToolkit("把当前提示词改写成雨夜霓虹场景")).toBe(false);
    expect(userRequestedPromptToolkit("解释一下 Danbooru tag 是什么")).toBe(false);
  });

  it("requires lookup for named-entity background questions without hijacking routine searches", () => {
    expect(userRequestedBackgroundLookup("moqing 是谁？先查背景资料再回答")).toBe(true);
    expect(userRequestedBackgroundLookup("Who is Hatsune Miku?")).toBe(true);
    expect(userRequestedBackgroundLookup("查一下当前模型是否安装")).toBe(false);
    expect(userRequestedBackgroundLookup("这个提示词是什么结构？")).toBe(false);
  });

  acceptanceTest("DATA-INTEGRITY-001@1", "stale-recovery", "continues the agent loop after a Forge tool error so the model can correct it", async () => {
    const streamBodies: Array<Record<string, any>> = [];
    let streamCall = 0;
    const executeAssistantTool = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "prompt hash is stale; read_prompt again" })
      .mockResolvedValueOnce({ ok: true, prompt: "portrait", prompt_hash: "fresh-hash" })
      .mockResolvedValueOnce({ ok: true, prompt: "portrait, rim light", prompt_hash: "final-hash" });
    window.__SD_FORGE_NEO_PROMPT_AGENT__ = { hostApi: testHost(executeAssistantTool) };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(createDefaultProfileState()), { status: 200 });
      streamBodies.push(JSON.parse(String(init?.body)));
      streamCall += 1;
      if (streamCall === 1) {
        return eventStream([
          { type: "start" },
          { type: "toolcall_start", contentIndex: 0, id: "call-1", toolName: "edit_prompt" },
          { type: "toolcall_delta", contentIndex: 0, delta: "{\"field\":\"positive\",\"base_hash\":\"stale-hash\",\"patches\":[{\"operation\":\"append\",\"text\":\"rim light\"}]}" },
          { type: "toolcall_end", contentIndex: 0 },
          { type: "done", reason: "toolUse" },
        ]);
      }
      if (streamCall === 2) {
        return eventStream([
          { type: "start" },
          { type: "toolcall_start", contentIndex: 0, id: "call-2", toolName: "read_prompt" },
          { type: "toolcall_delta", contentIndex: 0, delta: "{\"field\":\"positive\",\"target\":\"active\"}" },
          { type: "toolcall_end", contentIndex: 0 },
          { type: "done", reason: "toolUse" },
        ]);
      }
      if (streamCall === 3) {
        return eventStream([
          { type: "start" },
          { type: "toolcall_start", contentIndex: 0, id: "call-3", toolName: "edit_prompt" },
          { type: "toolcall_delta", contentIndex: 0, delta: "{\"field\":\"positive\",\"base_hash\":\"fresh-hash\",\"patches\":[{\"operation\":\"append\",\"text\":\"rim light\"}]}" },
          { type: "toolcall_end", contentIndex: 0 },
          { type: "done", reason: "toolUse" },
        ]);
      }
      return eventStream([
        { type: "start" },
        { type: "text_start", contentIndex: 0 },
        { type: "text_delta", contentIndex: 0, delta: "Recovered after retrying the tool" },
        { type: "text_end", contentIndex: 0 },
        { type: "done", reason: "stop" },
      ]);
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    await controller.actions.sendMessage({ text: "Rewrite the prompt", attachments: [], reasoning: "none" });

    expect(executeAssistantTool).toHaveBeenCalledTimes(3);
    expect(streamCall).toBe(4);
    expect(streamBodies[1].context.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", isError: true }),
    ]));
    expect(executeAssistantTool.mock.calls[1]?.[0]).toMatchObject({
      tool: "read_prompt",
      arguments: { field: "positive", target: "active" },
    });
    expect(executeAssistantTool.mock.calls[2]?.[0]).toMatchObject({
      tool: "edit_prompt",
      arguments: { field: "positive", base_hash: "fresh-hash" },
    });
    expect(streamBodies[3].context.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", isError: false }),
    ]));
    expect(useChatStore.getState().messages.at(-1)?.content).toBe("Recovered after retrying the tool");
    controller.destroy();
  });

  it("rewinds persisted history before resending an edited user message", async () => {
    const profiles = createDefaultProfileState();
    const profile = profiles.profiles.find((item) => item.id === profiles.activeProfileId)!;
    const session = {
      id: "session-edit",
      title: "Original request",
      createdAt: 1,
      updatedAt: 2,
      profileId: profile.id,
      providerId: profile.modelInfo.providerId || "gemini",
      modelId: profile.modelId,
      reasoningLevel: "off",
      systemPrompt: "",
      schemaVersion: 1,
    };
    const records: PromptAgentMessage[] = [
      { id: "session-edit:user:10", sessionId: session.id, message: { role: "user", content: "Original request", timestamp: 10 }, status: "complete", createdAt: 10, updatedAt: 10 },
      {
        id: "session-edit:assistant:20",
        sessionId: session.id,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Old reply" }],
          api: "gemini",
          provider: "gemini",
          model: profile.modelId,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: 20,
        },
        status: "complete",
        createdAt: 20,
        updatedAt: 20,
      },
    ];
    repository.listSessions.mockResolvedValue([session]);
    repository.getMessages.mockImplementation(async () => records.slice());
    repository.deleteMessages.mockImplementation(async (ids) => {
      for (const id of ids) {
        const index = records.findIndex((record) => record.id === id);
        if (index >= 0) records.splice(index, 1);
      }
      return ids.length;
    });
    repository.putMessage.mockImplementation(async (message) => {
      const index = records.findIndex((record) => record.id === message.id);
      if (index >= 0) records[index] = message;
      else records.push(message);
    });
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      bodies.push(JSON.parse(String(init?.body)));
      return eventStream([
        { type: "start" },
        { type: "text_start", contentIndex: 0 },
        { type: "text_delta", contentIndex: 0, delta: "New reply" },
        { type: "text_end", contentIndex: 0 },
        { type: "done", reason: "stop" },
      ]);
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    await controller.actions.sendMessage({ text: "Edited request", attachments: [], reasoning: "none", editOf: records[0].id });

    expect(repository.deleteMessages).toHaveBeenCalledWith(["session-edit:user:10", "session-edit:assistant:20"]);
    expect(bodies[0].context.messages).toEqual([
      expect.objectContaining({ role: "user", content: [expect.objectContaining({ type: "text", text: "Edited request" })] }),
    ]);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(["Edited request", "New reply"]);
    await vi.waitFor(() => expect(repository.putSession).toHaveBeenCalledWith(expect.objectContaining({ title: "Edited request" })));
    controller.destroy();
  });

  it("removes a superseded complete snapshot when runtime correction hides it", async () => {
    installFetch();
    const stale: PromptAgentMessage = {
      id: "stale-assistant",
      sessionId: "session",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Advice that should be corrected" }],
        api: "test",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 30,
      },
      status: "complete",
      createdAt: 30,
      updatedAt: 30,
    };
    repository.getMessages.mockResolvedValue([stale]);
    const controller = new PromptAgentController(repository);
    await controller.mount();
    const sessionId = useRuntimeStore.getState().sessionId!;

    await (controller as unknown as { persistRuntimeState(state: any, sessionId: string): Promise<void> }).persistRuntimeState({
      status: "retrying",
      messages: [],
      pendingToolCalls: [],
    }, sessionId);

    expect(repository.deleteMessages).toHaveBeenCalledWith(["stale-assistant"]);
    controller.destroy();
  });

  it("does not prune complete history during an ordinary streaming snapshot", async () => {
    installFetch();
    const stale: PromptAgentMessage = {
      id: "complete-history",
      sessionId: "session",
      message: { role: "user", content: "Earlier turn", timestamp: 10 },
      status: "complete",
      createdAt: 10,
      updatedAt: 10,
    };
    repository.getMessages.mockResolvedValue([stale]);
    const controller = new PromptAgentController(repository);
    await controller.mount();
    const sessionId = useRuntimeStore.getState().sessionId!;

    await (controller as unknown as { persistRuntimeState(state: any, sessionId: string): Promise<void> }).persistRuntimeState({
      status: "streaming",
      messages: [],
      pendingToolCalls: [],
    }, sessionId);

    expect(repository.deleteMessages).not.toHaveBeenCalled();
    controller.destroy();
  });

});

function eventStream(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function testHost(executeAssistantTool: PromptAgentHostApi["executeAssistantTool"]): PromptAgentHostApi {
  return {
    name: "prompt-agent-host",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["forge-availability", "prompt-target", "tool-execution"],
    handshake: () => ({ ok: true, bridge: "prompt-agent-ui", apiVersion: 1, version: "1.0.0", capabilities: ["forge-availability", "prompt-target", "tool-execution"] }),
    isForgeAvailable: () => true,
    activePromptTarget: () => "txt2img",
    readPrompt: async () => ({}),
    captureForgeState: () => ({}),
    restoreForgeState: () => true,
    executeTool: executeAssistantTool,
    executeAssistantTool,
    getLocaleHints: () => ({ locale: "en" }),
    subscribeLocaleHints: () => () => undefined,
    openSettings: () => undefined,
  };
}
