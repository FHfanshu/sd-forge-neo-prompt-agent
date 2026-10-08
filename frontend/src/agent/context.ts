import type { Message } from "../types";

export const MAX_IMAGE_MESSAGES = 3;

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type WireMessage =
  | { role: "system" | "user"; content: string | Part[] }
  | { role: "assistant"; content: string | null; tool_calls?: unknown[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ContextOptions {
  systemPrompt: string;
  vision: boolean;
  imageUrl: (attachmentId: string) => Promise<string>;
}

function safeArguments(raw: string): string {
  try {
    JSON.parse(raw || "{}");
    return raw || "{}";
  } catch {
    return "{}";
  }
}

/** Tool output as the model should see it: drop UI-only fields. */
export function modelFacingToolContent(message: Message): string {
  if (message.tool_name !== "edit_prompt") return message.content;
  try {
    const { before: _before, ...rest } = JSON.parse(message.content);
    return JSON.stringify(rest);
  } catch {
    return message.content;
  }
}

/** Convert stored history into an OpenAI-compatible message list that is always protocol-valid. */
export async function buildContext(history: Message[], options: ContextOptions): Promise<WireMessage[]> {
  const imageMessages = history.filter((m) => m.attachments?.length).slice(-MAX_IMAGE_MESSAGES);
  const showImages = new Set(options.vision ? imageMessages.map((m) => m.id) : []);
  const lastUser = history.map((m) => m.role).lastIndexOf("user");
  const answered = new Set(history.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  const out: WireMessage[] = [{ role: "system", content: options.systemPrompt }];
  let pendingImages: Part[] = [];

  const imageParts = async (message: Message): Promise<Part[]> => {
    const parts: Part[] = [];
    for (const attachment of message.attachments ?? []) {
      if (showImages.has(message.id)) parts.push({ type: "image_url", image_url: { url: await options.imageUrl(attachment.id) } });
      else parts.push({ type: "text", text: `[图片 ${attachment.id} 已省略，可用 read_attachment 读取]` });
    }
    return parts;
  };
  const flushImages = () => {
    if (pendingImages.length) out.push({ role: "user", content: [{ type: "text", text: "[工具返回的图片]" }, ...pendingImages] });
    pendingImages = [];
  };

  for (let index = 0; index < history.length; index++) {
    const message = history[index];
    if (message.role === "user") {
      flushImages();
      const parts = await imageParts(message);
      const text = message.content || (parts.length ? "" : " ");
      out.push({ role: "user", content: parts.length ? [{ type: "text", text: text || "（见附图）" }, ...parts] : text });
    } else if (message.role === "assistant") {
      flushImages();
      const calls = (message.tool_calls ?? []).filter((call) => call.id && call.name);
      if (!message.content && !calls.length) continue;
      const item: WireMessage = { role: "assistant", content: message.content || null };
      if (calls.length) {
        item.tool_calls = calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: safeArguments(call.arguments) } }));
      }
      if (index > lastUser && message.reasoning) item.reasoning_content = message.reasoning;
      out.push(item);
      for (const call of calls) {
        if (!answered.has(call.id)) {
          // keep the request valid when a turn was stopped or interrupted mid-tool
          const later = history.slice(index + 1).some((m) => m.role === "tool" && m.tool_call_id === call.id);
          if (!later) out.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: { code: "INTERRUPTED", message: "interrupted" } }) });
        }
      }
    } else if (message.role === "tool" && message.tool_call_id) {
      out.push({ role: "tool", tool_call_id: message.tool_call_id, content: modelFacingToolContent(message) });
      pendingImages.push(...(await imageParts(message)).filter((part) => part.type === "image_url"));
    }
  }
  flushImages();
  return out;
}
