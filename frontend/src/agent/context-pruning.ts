import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

const RECENT_TOOL_RESULTS = 6;
const PROTECTED_ACTIVE_TOOLS = new Set(["load_skill", "load_tools", "edit_prompt", "apply_generation_parameters"]);
const OLD_IMAGE_PLACEHOLDER = "[Earlier attached image omitted from the active model context.]";
const TOOL_RESULT_PLACEHOLDER = "[Older tool result omitted from the active model context; newer steps are retained.]";
const ORPHAN_TOOL_RESULT_PLACEHOLDER = "[Tool call was interrupted before it returned a result.]";

function historicalUser(message: UserMessage): UserMessage {
  if (typeof message.content === "string") return message;
  const text = message.content.filter((block) => block.type === "text");
  const omittedImages = message.content.filter((block) => block.type === "image").length;
  if (!omittedImages) return message;
  return {
    ...message,
    content: [...text, { type: "text", text: OLD_IMAGE_PLACEHOLDER }],
  };
}

function historicalAssistant(message: AssistantMessage): AssistantMessage | null {
  const content = message.content.filter((block) => block.type === "text");
  if (!content.length && message.errorMessage) content.push({ type: "text", text: message.errorMessage });
  return content.length ? { ...message, content, diagnostics: undefined } : null;
}

function completedHistory(messages: Message[]): Message[] {
  const projected: Message[] = [];
  let turn: Message[] = [];

  const flush = (): void => {
    if (!turn.length) return;
    const user = turn.find((message): message is UserMessage => message.role === "user");
    const assistant = [...turn].reverse().find((message): message is AssistantMessage => message.role === "assistant");
    if (user) projected.push(historicalUser(user));
    if (assistant) {
      const compact = historicalAssistant(assistant);
      if (compact) projected.push(compact);
    }
    turn = [];
  };

  for (const message of messages) {
    if (message.role === "user") flush();
    turn.push(message);
  }
  flush();
  return projected;
}

function lastUserTurnIndex(messages: Message[]): number {
  let cursor = messages.length - 1;
  if (cursor < 0) return -1;
  if (messages[cursor]?.role !== "user") {
    while (cursor >= 0 && messages[cursor]?.role !== "user") cursor -= 1;
    return cursor;
  }
  const lastUser = cursor;
  while (cursor >= 0 && messages[cursor]?.role === "user") cursor -= 1;
  if (messages[cursor]?.role !== "toolResult") return lastUser;
  while (cursor >= 0 && messages[cursor]?.role !== "user") cursor -= 1;
  return cursor;
}

function activeTurn(messages: Message[]): Message[] {
  const resultIndexes = messages.flatMap((message, index) => message.role === "toolResult" ? [index] : []);
  const recent = new Set(resultIndexes.slice(-RECENT_TOOL_RESULTS));
  const prunedCallIds = new Set<string>();

  const projected = messages.map((message, index): Message => {
    if (message.role !== "toolResult") return message;
    const keep = message.isError || recent.has(index) || PROTECTED_ACTIVE_TOOLS.has(message.toolName);
    if (!keep) prunedCallIds.add(message.toolCallId);
    return {
      ...message,
      content: keep ? message.content : [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
      details: undefined,
    } satisfies ToolResultMessage;
  });

  const normalized = projected.map((message) => {
    if (message.role !== "assistant") return message;
    return {
      ...message,
      diagnostics: undefined,
      content: message.content.map((block) => block.type === "toolCall" && prunedCallIds.has(block.id)
        ? { ...block, arguments: { context_pruned: true } }
        : block),
    };
  });

  // A run can be interrupted after a tool call is recorded but before its result is
  // persisted. Synthesize an interrupted result so the provider never receives an
  // assistant tool_calls message followed by an unrelated role (HTTP 400).
  const answered = new Set(
    normalized.filter((message) => message.role === "toolResult").map((message) => message.toolCallId),
  );
  const repaired: Message[] = [];
  for (const message of normalized) {
    repaired.push(message);
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || answered.has(block.id)) continue;
      answered.add(block.id);
      repaired.push({
        role: "toolResult",
        toolCallId: block.id,
        toolName: block.name,
        isError: true,
        content: [{ type: "text", text: ORPHAN_TOOL_RESULT_PLACEHOLDER }],
        timestamp: message.timestamp,
      });
    }
  }
  return repaired;
}

/**
 * Builds the provider-facing transcript without mutating the durable/UI history.
 * Completed turns retain user intent and the final answer; their tool chatter,
 * reasoning, and old image payloads are excluded. The active turn stays protocol
 * complete, with only older non-critical tool results replaced by placeholders.
 */
export function pruneContextForModel(messages: AgentMessage[]): Message[] {
  const llmMessages = messages.filter((message): message is Message => (
    message.role === "user" || message.role === "assistant" || message.role === "toolResult"
  ));
  const activeUserIndex = lastUserTurnIndex(llmMessages);
  if (activeUserIndex < 0) return activeTurn(llmMessages);
  return [
    ...completedHistory(llmMessages.slice(0, activeUserIndex)),
    ...activeTurn(llmMessages.slice(activeUserIndex)),
  ];
}

export const contextPruningConstants = {
  recentToolResults: RECENT_TOOL_RESULTS,
  oldImagePlaceholder: OLD_IMAGE_PLACEHOLDER,
  toolResultPlaceholder: TOOL_RESULT_PLACEHOLDER,
  orphanToolResultPlaceholder: ORPHAN_TOOL_RESULT_PLACEHOLDER,
} as const;
