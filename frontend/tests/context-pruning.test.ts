import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { contextPruningConstants, pruneContextForModel } from "../src/agent/context-pruning";
import { acceptanceTest } from "./acceptance";

const usage = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(timestamp: number, text: string, image = false): UserMessage {
  return {
    role: "user",
    content: image ? [{ type: "text", text }, { type: "image", data: "large-base64", mimeType: "image/png" }] : text,
    timestamp,
  };
}

function assistant(timestamp: number, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content, api: "test", provider: "test", model: "test", usage, stopReason, timestamp };
}

function result(timestamp: number, id: string, name: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text: JSON.stringify({ ok: !isError, payload: "verbose" }) }],
    details: { duplicated: "verbose" },
    isError,
    timestamp,
  };
}

describe("provider-facing context pruning", () => {
  acceptanceTest("AGENT-TOOLS-001@12", "context-pruning", "keeps durable messages untouched while completed turns retain only intent and final answers", () => {
    const messages: AgentMessage[] = [
      user(1, "first", true),
      assistant(2, [{ type: "thinking", thinking: "private" }, { type: "toolCall", id: "old", name: "read_prompt", arguments: {} }], "toolUse"),
      result(3, "old", "read_prompt"),
      assistant(4, [{ type: "text", text: "first answer" }]),
      user(5, "current", true),
    ];

    const projected = pruneContextForModel(messages);

    expect(projected).toHaveLength(3);
    expect(JSON.stringify(projected[0])).toContain(contextPruningConstants.oldImagePlaceholder);
    expect(JSON.stringify(projected[0])).not.toContain("large-base64");
    expect(projected[1]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "first answer" }] });
    expect(JSON.stringify(projected[2])).toContain("large-base64");
    expect(messages[0]).toEqual(user(1, "first", true));
  });

  it("keeps the current tool protocol when a control follow-up is projected as a user message", () => {
    const messages: AgentMessage[] = [
      user(1, "rewrite the prompt"),
      assistant(2, [{ type: "toolCall", id: "read", name: "read_prompt", arguments: { field: "positive" } }], "toolUse"),
      result(3, "read", "read_prompt"),
      user(4, "Do not finish until edit_prompt succeeds."),
    ];
    const projected = pruneContextForModel(messages);
    const toolResult = projected.find((message) => message.role === "toolResult") as ToolResultMessage;
    expect(projected.filter((message) => message.role === "user")).toHaveLength(2);
    expect(toolResult.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("verbose") });
  });

  it("starts a new user turn after a completed answer", () => {
    const messages: AgentMessage[] = [
      user(1, "first"),
      assistant(2, [{ type: "thinking", thinking: "private" }, { type: "text", text: "first answer" }]),
      user(3, "second"),
    ];
    expect(pruneContextForModel(messages)).toEqual([
      user(1, "first"),
      assistant(2, [{ type: "text", text: "first answer" }]),
      user(3, "second"),
    ]);
  });

  it("keeps the active tool protocol valid while compacting only older non-critical results", () => {
    const messages: AgentMessage[] = [user(1, "current")];
    for (let index = 0; index < 8; index += 1) {
      const name = index === 0 ? "search_resources" : index === 1 ? "edit_prompt" : "read_prompt";
      messages.push(assistant(10 + index * 2, [{ type: "toolCall", id: `call-${index}`, name, arguments: { query: "large input" } }], "toolUse"));
      messages.push(result(11 + index * 2, `call-${index}`, name));
    }

    const projected = pruneContextForModel(messages);
    const firstCall = projected.find((message) => message.role === "assistant") as AssistantMessage;
    const firstResult = projected.find((message) => message.role === "toolResult") as ToolResultMessage;
    const protectedResult = projected.find((message) => message.role === "toolResult" && message.toolCallId === "call-1") as ToolResultMessage;

    expect(firstCall.content[0]).toMatchObject({ type: "toolCall", arguments: { context_pruned: true } });
    expect(firstResult.content).toEqual([{ type: "text", text: contextPruningConstants.toolResultPlaceholder }]);
    expect(protectedResult.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("verbose") });
    expect(projected.filter((message) => message.role === "toolResult")).toHaveLength(8);
    expect(projected.filter((message) => message.role === "toolResult").every((message) => message.details === undefined)).toBe(true);
  });

  it("never replaces tool errors with a pruning placeholder", () => {
    const messages: AgentMessage[] = [user(1, "current")];
    for (let index = 0; index < 8; index += 1) messages.push(result(2 + index, `call-${index}`, "read_prompt", index === 0));
    const projected = pruneContextForModel(messages);
    const error = projected.find((message) => message.role === "toolResult" && message.toolCallId === "call-0") as ToolResultMessage;
    expect(error.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("verbose") });
  });
});
