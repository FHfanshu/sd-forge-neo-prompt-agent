import { ApiError } from "../api";
import type { Message, ToolCall, TurnState } from "../types";
import { buildContext } from "./context";
import { SseParser, type StreamDelta } from "./sse";

export const MAX_TOOL_ROUNDS = 24;
export const RETRY_DELAYS = [1000, 3000];
const PERSIST_INTERVAL = 2000;
const RESULT_LIMIT = 16_000;

export interface ToolExecution {
  result: Record<string, unknown>;
  imageAttachmentId?: string;
}

export interface LoopDeps {
  history: () => Message[];
  add: (message: Message) => void;
  /** Replace a message; `persist` asks the caller to write it to the server. */
  update: (message: Message, persist: boolean) => void;
  delta: (messageId: string, delta: StreamDelta) => void;
  setState: (state: TurnState, note?: string) => void;
  chat: (body: unknown, signal: AbortSignal) => Promise<Response>;
  executeTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolExecution>;
  imageUrl: (attachmentId: string) => Promise<string>;
  newId: () => string;
  profileId: string;
  vision: boolean;
  systemPrompt: string;
  tools: unknown[];
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function blankMessage(id: string, role: Message["role"], extra: Partial<Message> = {}): Message {
  return {
    id,
    role,
    status: "complete",
    content: "",
    reasoning: "",
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    attachments: null,
    error: null,
    usage: null,
    created_at: Date.now(),
    ...extra,
  };
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function retryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError; // fetch network failure
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "AUTH") return "API Key 无效或没有权限";
    if (error.code === "CONTEXT_LENGTH") return "对话过长，请新建会话";
    if (error.code === "NETWORK") return `连接模型服务失败：${error.message}`;
    return error.message;
  }
  if (error instanceof TypeError) return `连接失败：${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Run one user turn to completion. Always returns; every exit leaves no message in `streaming`. */
export async function runTurn(deps: LoopDeps, signal: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? abortableSleep;
  let current: Message | null = null;
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      deps.setState("requesting");
      const body = {
        profile_id: deps.profileId,
        messages: await buildContext(deps.history(), { systemPrompt: deps.systemPrompt, vision: deps.vision, imageUrl: deps.imageUrl }),
        tools: deps.tools,
      };
      let response: Response | null = null;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await deps.chat(body, signal);
        } catch (error) {
          if (isAbort(error) || attempt >= RETRY_DELAYS.length || !retryable(error)) throw error;
          deps.setState("requesting", `重试中（${attempt + 1}/${RETRY_DELAYS.length}）`);
          await sleep(RETRY_DELAYS[attempt], signal);
        }
      }

      current = blankMessage(deps.newId(), "assistant", { status: "streaming" });
      deps.add(current);
      deps.setState("streaming");
      const parser = new SseParser();
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let lastPersist = Date.now();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const delta = parser.push(decoder.decode(value, { stream: true }));
          if (delta.content || delta.reasoning) deps.delta(current.id, delta);
          if (Date.now() - lastPersist > PERSIST_INTERVAL) {
            lastPersist = Date.now();
            deps.update({ ...current, content: parser.result.content, reasoning: parser.result.reasoning }, true);
          }
        }
        const tail = parser.finish();
        if (tail.content || tail.reasoning) deps.delta(current.id, tail);
      } catch (error) {
        current = { ...current, content: parser.result.content, reasoning: parser.result.reasoning };
        throw error;
      } finally {
        reader.releaseLock?.();
      }
      const calls = parser.result.toolCalls.map((call, index) => ({ ...call, id: call.id || `call_${round}_${index}` }));
      current = { ...current, status: "complete", content: parser.result.content, reasoning: parser.result.reasoning, tool_calls: calls.length ? calls : null, usage: parser.result.usage };
      deps.update(current, true);
      current = null;
      if (!calls.length) return;

      deps.setState("tool_running");
      for (const call of calls) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        let execution: ToolExecution;
        try {
          execution = await deps.executeTool(call, signal);
        } catch (error) {
          if (isAbort(error)) throw error;
          execution = { result: { ok: false, error: { code: "INTERNAL", message: errorText(error) } } };
        }
        let content = JSON.stringify(execution.result);
        if (content.length > RESULT_LIMIT) content = JSON.stringify({ ...execution.result, truncated: true }).slice(0, RESULT_LIMIT);
        const tool = blankMessage(deps.newId(), "tool", {
          content,
          tool_call_id: call.id,
          tool_name: call.name,
          status: execution.result.ok === false ? "error" : "complete",
          attachments: execution.imageAttachmentId ? [{ id: execution.imageAttachmentId, width: 0, height: 0 }] : null,
        });
        deps.add(tool);
        deps.update(tool, true);
      }
    }
    deps.add(blankMessage(deps.newId(), "assistant", { status: "error", error: "已达到单轮工具调用上限" }));
    deps.update(deps.history()[deps.history().length - 1], true);
  } catch (error) {
    if (current) {
      const stopped = isAbort(error);
      deps.update({ ...current, status: stopped ? "stopped" : "error", error: stopped ? null : errorText(error) }, true);
    } else if (!isAbort(error)) {
      const failed = blankMessage(deps.newId(), "assistant", { status: "error", error: errorText(error) });
      deps.add(failed);
      deps.update(failed, true);
    }
  } finally {
    deps.setState("idle");
  }
}
