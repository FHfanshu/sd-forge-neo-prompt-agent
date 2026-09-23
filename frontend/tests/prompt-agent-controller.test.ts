import { createDefaultProfileState } from "../src/profile-adapter";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { PromptAgentController, userRequestedBackgroundLookup, userRequestedNaturalLanguagePrompt, userRequestedPromptMutation, userRequestedPromptToolkit } from "../src/agent/controller";
import { useChatStore } from "../src/stores/chat";
import { useProfileStore } from "../src/stores/profiles";
import { useRuntimeStore } from "../src/stores/runtime";
import type { ChatMessage } from "../src/contracts";
import type { PromptAgentMessage, PromptAgentSession } from "../src/sessions/schema";
import type { PromptAgentHostApi } from "../src/bridge";
import * as promptDiff from "../src/prompts/prompt-diff";
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
    vi.useRealTimers();
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
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");
    controller.destroy();
  });

  it("force-recovers a stopped request that never settles", async () => {
    const profiles = createDefaultProfileState();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"type":"start"}',
          'data: {"type":"text_start","contentIndex":0}',
          'data: {"type":"text_delta","contentIndex":0,"delta":"Hanging"}',
          "",
        ].join("\n\n")));
        // Never closed: simulates a tool/provider call that ignores the abort signal.
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/prompt-agent/api/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));
    const controller = new PromptAgentController(repository);
    await controller.mount();
    vi.useFakeTimers();

    const stuck = controller.actions.sendMessage({ text: "Hang", attachments: [], reasoning: "none" });
    await vi.advanceTimersByTimeAsync(50);
    expect(useChatStore.getState().activeRequestId).toBeTruthy();

    controller.actions.stopRequest();
    expect(useRuntimeStore.getState().workingPhase).toBe("cancelling");

    await vi.advanceTimersByTimeAsync(6_000);
    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");

    // The abandoned run no longer owns the session, so a new request can start immediately.
    void controller.actions.sendMessage({ text: "Again", attachments: [], reasoning: "none" });
    await vi.advanceTimersByTimeAsync(20);
    expect(useChatStore.getState().activeRequestId).toBeTruthy();

    controller.destroy();
    void (stuck as Promise<unknown>).catch(() => undefined);
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

  it("runs server sync with the repository as receiver instead of a detached method", async () => {
    installFetch();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let receiver: unknown;
    const syncing = {
      ...repository,
      syncWithServer() {
        receiver = this;
        return this.getPreference().then(() => ({ conflicts: [] }));
      },
    };
    const controller = new PromptAgentController(syncing);

    await controller.mount();
    await vi.waitFor(() => expect(receiver).toBe(syncing));

    expect(warning).not.toHaveBeenCalledWith("Prompt Agent session sync is temporarily unavailable", expect.anything());
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

    await vi.waitFor(() => expect(repository.putMessage).toHaveBeenCalled());
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

  it("coalesces streaming persistence instead of rewriting the session per token", async () => {
    const deltas = 60;
    const events = [
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      ...Array.from({ length: deltas }, (_, index) => ({ type: "text_delta", contentIndex: 0, delta: `t${index}` })),
      { type: "text_end", contentIndex: 0 },
      { type: "done", reason: "stop" },
    ];
    installFetch(() => eventStream(events));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    await controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });

    const writes = repository.putMessage.mock.calls.length;
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThan(deltas);
    controller.destroy();
  });

  it("does not strand the composer on cancelling when a settled run is still finishing post-turn work", async () => {
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>((resolve) => { releasePersistence = resolve; });
    installFetch();
    repository.putMessage.mockImplementation(async () => { await persistenceGate; });
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const send = controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });
    for (let index = 0; index < 200 && useChatStore.getState().activeRequestId === null; index += 1) await tick();
    for (let index = 0; index < 200 && useRuntimeStore.getState().workingPhase !== "idle"; index += 1) await tick();
    expect(useChatStore.getState().activeRequestId).not.toBeNull();

    controller.actions.stopRequest();
    expect(useRuntimeStore.getState().workingPhase).toBe("idle");

    releasePersistence();
    await send;
    controller.destroy();
  });

  it("reuses completed history projections while a new response streams", async () => {
    const profiles = createDefaultProfileState();
    const profile = profiles.profiles.find((item) => item.id === profiles.activeProfileId)!;
    const session: PromptAgentSession = {
      id: "session-stream",
      title: "Long trace",
      createdAt: 1,
      updatedAt: 2,
      profileId: profile.id,
      providerId: profile.modelInfo.providerId || "gemini",
      modelId: profile.modelId,
      reasoningLevel: "off",
      systemPrompt: "",
      schemaVersion: 1,
    };
    const records = completedTrace(session.id, profile.modelId);
    repository.listSessions.mockResolvedValue([session]);
    repository.getMessages.mockImplementation(async () => records.slice());
    const diff = vi.spyOn(promptDiff, "diffPromptText");
    const deltas = 40;
    installFetch(() => eventStream([
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      ...Array.from({ length: deltas }, (_, index) => ({ type: "text_delta", contentIndex: 0, delta: `t${index} ` })),
      { type: "text_end", contentIndex: 0 },
      { type: "done", reason: "stop" },
    ]));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const historyCount = useChatStore.getState().messages.length;
    expect(historyCount).toBe(records.length);

    let baseline: ChatMessage[] | undefined;
    let diffsAtStreamStart = 0;
    const unsubscribe = useChatStore.subscribe((state) => {
      if (!baseline && state.messages.some((message) => message.status === "streaming")) {
        baseline = state.messages;
        diffsAtStreamStart = diff.mock.calls.length;
      }
    });
    await controller.actions.sendMessage({ text: "Continue", attachments: [], reasoning: "none" });
    unsubscribe();

    expect(baseline).toBeDefined();
    const final = useChatStore.getState().messages;
    expect(final.length).toBe(historyCount + 2);
    // Every completed history message keeps its projected identity across the whole stream.
    for (let index = 0; index < historyCount; index += 1) {
      expect(final[index]).toBe(baseline![index]);
    }
    // The mutable streaming message still reprojects and settles as complete.
    const assistant = final.at(-1)!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("complete");
    expect(assistant.content).toContain(`t${deltas - 1} `);
    // Completed history is not re-parsed or re-diffed per streamed token.
    expect(diff.mock.calls.length).toBe(diffsAtStreamStart);
    controller.destroy();
  });

  it("reprojects the mutable streaming message on every update", async () => {
    installFetch(() => eventStream([
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "one " },
      { type: "text_delta", contentIndex: 0, delta: "two " },
      { type: "text_end", contentIndex: 0 },
      { type: "done", reason: "stop" },
    ]));
    const controller = new PromptAgentController(repository);
    await controller.mount();

    const seen: ChatMessage[] = [];
    const unsubscribe = useChatStore.subscribe((state) => {
      const last = state.messages.at(-1);
      if (last?.status === "streaming") seen.push(last);
    });
    await controller.actions.sendMessage({ text: "Hello", attachments: [], reasoning: "none" });
    unsubscribe();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)!.content).toBe("one two ");
    const final = useChatStore.getState().messages.at(-1)!;
    expect(final.status).toBe("complete");
    expect(final.content).toBe("one two ");
    controller.destroy();
  });

  it("always reprojects a streaming message and caches only its terminal projection", () => {
    const controller = new PromptAgentController(repository);
    const project = (controller as unknown as { projectRecord(record: PromptAgentMessage): ChatMessage }).projectRecord.bind(controller);
    const message: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "one" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: traceUsage,
      stopReason: "stop",
      timestamp: 10,
    };
    const record: PromptAgentMessage = { id: "session:assistant:10", sessionId: "session", message, status: "streaming", createdAt: 10, updatedAt: 10 };

    const streaming = project(record);
    expect(project(record)).not.toBe(streaming);
    message.content = [{ type: "text", text: "one two" }];
    expect(project(record).content).toBe("one two");

    const terminal: PromptAgentMessage = { ...record, status: "complete" };
    const completed = project(terminal);
    expect(completed).toMatchObject({ content: "one two", status: "complete" });
    expect(project(terminal)).toBe(completed);
    controller.destroy();
  });

  it("rebuilds history projections after switching sessions", async () => {
    const profiles = createDefaultProfileState();
    const profile = profiles.profiles.find((item) => item.id === profiles.activeProfileId)!;
    const makeSession = (id: string): PromptAgentSession => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 2,
      profileId: profile.id,
      providerId: profile.modelInfo.providerId || "gemini",
      modelId: profile.modelId,
      reasoningLevel: "off",
      systemPrompt: "",
      schemaVersion: 1,
    });
    const sessionA = makeSession("session-a");
    const sessionB = makeSession("session-b");
    const sharedMessage = { role: "user" as const, content: "Shared body", timestamp: 10 };
    const recordA: PromptAgentMessage = { id: "session-a:user:10", sessionId: sessionA.id, message: sharedMessage, status: "complete", createdAt: 10, updatedAt: 10 };
    const recordB: PromptAgentMessage = { ...recordA, id: "session-b:user:10", sessionId: sessionB.id };
    let activeMessages = [recordA];
    repository.listSessions.mockResolvedValue([sessionA, sessionB]);
    repository.getSession.mockResolvedValue(sessionB);
    repository.getMessages.mockImplementation(async () => activeMessages);
    installFetch();
    const controller = new PromptAgentController(repository);
    await controller.mount();
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(["session-a:user:10"]);

    activeMessages = [recordB];
    await controller.selectHistory({ id: sessionB.id, source: "prompt-agent", title: sessionB.title, preview: "", updatedAt: "", messageCount: 1 });

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(["session-b:user:10"]);
    expect(useChatStore.getState().messages[0]?.content).toBe("Shared body");
    controller.destroy();
  });

});

function eventStream(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const traceUsage = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** A completed multi-turn trace whose edit_prompt results make projection expensive. */
function completedTrace(sessionId: string, modelId: string): PromptAgentMessage[] {
  const records: PromptAgentMessage[] = [];
  let timestamp = 10;
  for (let turn = 0; turn < 6; turn += 1) {
    records.push({
      id: `${sessionId}:user:${timestamp}`,
      sessionId,
      message: { role: "user", content: `Turn ${turn} request`, timestamp },
      status: "complete",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    timestamp += 10;
    records.push({
      id: `${sessionId}:assistant:${timestamp}`,
      sessionId,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: `reasoning for turn ${turn} `.repeat(12) },
          { type: "text", text: `Reply ${turn}` },
        ],
        api: "test",
        provider: "test",
        model: modelId,
        usage: traceUsage,
        stopReason: "stop",
        timestamp,
      },
      status: "complete",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    timestamp += 10;
    records.push({
      id: `${sessionId}:toolResult:${timestamp}`,
      sessionId,
      message: {
        role: "toolResult",
        toolCallId: `call-${turn}`,
        toolName: "edit_prompt",
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            before_prompt: `solo, portrait, turn ${turn}`,
            after_prompt: `solo, portrait, turn ${turn}, rim light`,
            target: "txt2img",
            field: "positive",
            before_hash: `before-${turn}`,
            prompt_hash: `after-${turn}`,
          }),
        }],
        isError: false,
        timestamp,
      },
      status: "complete",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    timestamp += 10;
  }
  return records;
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
