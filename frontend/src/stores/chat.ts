import { createStore } from "./store";
import {
  chatMessageSchema,
  type ChatAttachment,
  type ChatMessage,
  type ChatMessageInput,
} from "../contracts";
import { releaseImageAttachments, retainImageAttachments } from "../attachments";

export interface ChatStore {
  messages: ChatMessage[];
  activeRequestId: string | null;
  setActiveRequest(requestId: string | null): void;
  appendMessage(message: ChatMessageInput): void;
  upsertMessage(message: ChatMessageInput): void;
  updateMessage(id: string, patch: Partial<ChatMessage>): void;
  setMessages(messages: ChatMessage[]): void;
  setAttachments(messageId: string, attachments: ChatAttachment[]): void;
  beginRequest(requestId: string): AbortSignal;
  cancelRequest(): void;
  finishRequest(requestId?: string): void;
  reset(): void;
}

let activeController: AbortController | null = null;
// Streaming updates re-deliver the same source projections; validating each object once
// keeps unchanged messages reference-stable instead of cloning them per event.
const validatedMessages = new WeakMap<object, ChatMessage>();
function validateChatMessage(message: ChatMessage): ChatMessage {
  const validated = validatedMessages.get(message);
  if (validated) return validated;
  const parsed = chatMessageSchema.parse(message);
  validatedMessages.set(message, parsed);
  return parsed;
}
function replaceOwnedAttachments(current: ChatAttachment[], next: ChatAttachment[]): void {
  retainImageAttachments(next);
  releaseImageAttachments(current);
}

export const useChatStore = createStore<ChatStore>((set, get) => ({
  messages: [],
  activeRequestId: null,
  setActiveRequest(activeRequestId) {
    set({ activeRequestId });
  },
  appendMessage(message) {
    const parsed = chatMessageSchema.parse(message);
    retainImageAttachments(parsed.attachments);
    set((state) => ({ messages: [...state.messages, parsed] }));
  },
  upsertMessage(message) {
    const parsed = chatMessageSchema.parse(message);
    set((state) => {
      const index = state.messages.findIndex((item) => item.id === parsed.id);
      if (index < 0) {
        retainImageAttachments(parsed.attachments);
        return { messages: [...state.messages, parsed] };
      }
      const messages = state.messages.slice();
      replaceOwnedAttachments(messages[index].attachments, parsed.attachments);
      messages[index] = parsed;
      return { messages };
    });
  },
  updateMessage(id, patch) {
    set((state) => ({ messages: state.messages.map((message) => {
      if (message.id !== id) return message;
      const next = chatMessageSchema.parse({ ...message, ...patch });
      replaceOwnedAttachments(message.attachments, next.attachments);
      return next;
    }) }));
  },
  setMessages(messages) {
    const current = get().messages;
    const previous = new Map(current.map((message) => [message.id, message]));
    const next: ChatMessage[] = [];
    let changed = false;
    for (const candidate of messages) {
      const existing = previous.get(candidate.id);
      previous.delete(candidate.id);
      // Projection caches hand back the same ChatMessage object while a message cannot
      // change; reuse it so unchanged items are neither revalidated nor re-rendered.
      if (existing === candidate) {
        next.push(existing);
        continue;
      }
      const parsed = validateChatMessage(candidate);
      if (existing === parsed) {
        next.push(existing);
        continue;
      }
      if (existing) replaceOwnedAttachments(existing.attachments, parsed.attachments);
      else retainImageAttachments(parsed.attachments);
      next.push(parsed);
      changed = true;
    }
    if (previous.size) {
      for (const removed of previous.values()) releaseImageAttachments(removed.attachments);
      changed = true;
    }
    if (!changed && next.length === current.length && next.every((message, index) => message === current[index])) return;
    set({ messages: next });
  },
  setAttachments(messageId, attachments) {
    set((state) => ({
      messages: state.messages.map((message) => message.id === messageId
        ? (() => {
          const next = chatMessageSchema.parse({ ...message, attachments });
          replaceOwnedAttachments(message.attachments, next.attachments);
          return next;
        })()
        : message),
    }));
  },
  beginRequest(requestId) {
    activeController?.abort();
    activeController = new AbortController();
    set({ activeRequestId: requestId });
    return activeController.signal;
  },
  cancelRequest() {
    activeController?.abort();
    activeController = null;
    set((state) => ({
      activeRequestId: null,
      messages: state.messages.map((message) =>
        message.status === "streaming" ? { ...message, status: "cancelled" } : message,
      ),
    }));
  },
  finishRequest(requestId) {
    if (requestId && get().activeRequestId !== requestId) return;
    activeController = null;
    set({ activeRequestId: null });
  },
  reset() {
    activeController?.abort();
    activeController = null;
    releaseImageAttachments(get().messages.flatMap((message) => message.attachments));
    set({ messages: [], activeRequestId: null });
  },
}));
