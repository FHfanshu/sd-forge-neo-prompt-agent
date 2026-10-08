import type { ToolCall } from "../types";

export interface StreamDelta {
  content: string;
  reasoning: string;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Record<string, number> | null;
  finishReason: string | null;
}

/**
 * Incremental parser for OpenAI-compatible chat completion SSE. Handles reasoning in
 * `reasoning_content` / `reasoning` fields and inline `<think>…</think>` at the start of content.
 */
export class SseParser {
  private buffer = "";
  private thinkState: "unknown" | "inside" | "done" = "unknown";
  private pendingContent = "";
  private calls = new Map<number, ToolCall>();
  readonly result: StreamResult = { content: "", reasoning: "", toolCalls: [], usage: null, finishReason: null };
  done = false;

  /** Feed decoded text; returns the visible delta produced by this chunk. Throws on an in-stream error event. */
  push(text: string): StreamDelta {
    this.buffer += text;
    const delta: StreamDelta = { content: "", reasoning: "" };
    let boundary = this.buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const event = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      this.handleEvent(event, delta);
      boundary = this.buffer.search(/\r?\n\r?\n/);
    }
    return delta;
  }

  /** Flush at end of stream. */
  finish(): StreamDelta {
    const delta: StreamDelta = { content: "", reasoning: "" };
    if (this.buffer.trim()) this.handleEvent(this.buffer, delta);
    this.buffer = "";
    if (this.pendingContent) this.emitContent(this.pendingContent, delta, true);
    this.pendingContent = "";
    this.result.toolCalls = [...this.calls.entries()].sort((x, y) => x[0] - y[0]).map(([, call]) => call);
    return delta;
  }

  private handleEvent(event: string, delta: StreamDelta): void {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      this.done = true;
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (payload?.error) {
      const message = typeof payload.error === "string" ? payload.error : payload.error.message ?? "模型服务返回错误";
      throw new Error(String(message));
    }
    if (payload?.usage) this.result.usage = payload.usage;
    const choice = payload?.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) this.result.finishReason = choice.finish_reason;
    const d = choice.delta ?? {};
    const reasoning = d.reasoning_content ?? d.reasoning;
    if (typeof reasoning === "string" && reasoning) {
      this.result.reasoning += reasoning;
      delta.reasoning += reasoning;
    }
    if (typeof d.content === "string" && d.content) this.emitContent(d.content, delta, false);
    if (Array.isArray(d.tool_calls)) {
      for (const part of d.tool_calls) {
        const index = typeof part.index === "number" ? part.index : this.calls.size;
        const call = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        this.calls.set(index, call);
      }
    }
  }

  private emitContent(text: string, delta: StreamDelta, final: boolean): void {
    if (this.thinkState === "done") {
      this.result.content += text;
      delta.content += text;
      return;
    }
    this.pendingContent += text;
    const pending = this.pendingContent;
    if (this.thinkState === "unknown") {
      const trimmed = pending.trimStart();
      if (!final && trimmed.length < 7 && "<think>".startsWith(trimmed)) return;
      if (!trimmed.startsWith("<think>")) {
        this.thinkState = "done";
        this.pendingContent = "";
        this.emitContent(pending, delta, final);
        return;
      }
      this.thinkState = "inside";
      this.pendingContent = trimmed.slice(7);
    }
    const close = this.pendingContent.indexOf("</think>");
    if (close === -1) {
      const safe = final ? this.pendingContent.length : Math.max(0, this.pendingContent.length - 8);
      const thought = this.pendingContent.slice(0, safe);
      this.pendingContent = this.pendingContent.slice(safe);
      this.result.reasoning += thought;
      delta.reasoning += thought;
      return;
    }
    const thought = this.pendingContent.slice(0, close);
    const rest = this.pendingContent.slice(close + 8).replace(/^\s+/, "");
    this.result.reasoning += thought;
    delta.reasoning += thought;
    this.thinkState = "done";
    this.pendingContent = "";
    if (rest) this.emitContent(rest, delta, final);
  }
}
