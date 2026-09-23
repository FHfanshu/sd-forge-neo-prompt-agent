import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../src/stores/chat";
import { useUiStore } from "../src/stores/ui";
import { chatMessageSchema, type ChatMessage } from "../src/contracts";
import * as attachments from "../src/attachments";

afterEach(() => {
  vi.unstubAllGlobals();
  useChatStore.getState().reset();
  useUiStore.getState().reset();
});

describe("chat store cancellation", () => {
  it("aborts the active request immediately and marks streaming output cancelled", () => {
    useChatStore.getState().reset();
    useChatStore.getState().appendMessage({ id: "assistant-1", role: "assistant", content: "partial", status: "streaming" });
    const signal = useChatStore.getState().beginRequest("request-1");

    expect(signal.aborted).toBe(false);
    useChatStore.getState().cancelRequest();

    expect(signal.aborted).toBe(true);
    expect(useChatStore.getState().activeRequestId).toBeNull();
    expect(useChatStore.getState().messages[0].status).toBe("cancelled");
  });

  it("cancels an older request when a newer request begins", () => {
    useChatStore.getState().reset();
    const first = useChatStore.getState().beginRequest("first");
    const second = useChatStore.getState().beginRequest("second");

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(useChatStore.getState().activeRequestId).toBe("second");
    useChatStore.getState().cancelRequest();
  });
});

describe("chat store message reconciliation", () => {
  it("keeps unchanged messages without revalidating or re-owning them", () => {
    const parse = vi.spyOn(chatMessageSchema, "parse");
    const retain = vi.spyOn(attachments, "retainImageAttachments");
    const release = vi.spyOn(attachments, "releaseImageAttachments");
    const message: ChatMessage = {
      id: "user-1",
      role: "user",
      content: "hello",
      status: "complete",
      attachments: [{ id: "attachment-1", name: "reference.png", dataUrl: "data:image/png;base64,AQID" }],
      createdAt: 1,
    };

    useChatStore.getState().setMessages([message]);
    const projected = useChatStore.getState().messages[0];
    expect(parse).toHaveBeenCalledTimes(1);
    expect(retain).toHaveBeenCalledTimes(1);

    parse.mockClear();
    retain.mockClear();
    release.mockClear();
    useChatStore.getState().setMessages([projected]);

    expect(parse).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages[0]).toBe(projected);
  });

  it("does not notify subscribers when the projected list is unchanged", () => {
    const message: ChatMessage = { id: "user-1", role: "user", content: "hello", status: "complete", attachments: [], createdAt: 1 };
    useChatStore.getState().setMessages([message]);
    const before = useChatStore.getState().messages;
    let notifications = 0;
    const unsubscribe = useChatStore.subscribe(() => { notifications += 1; });
    notifications = 0;

    useChatStore.getState().setMessages([before[0]]);

    expect(notifications).toBe(0);
    expect(useChatStore.getState().messages).toBe(before);
    unsubscribe();
  });

  it("keeps unchanged neighbors stable while a replaced message updates and removal releases attachments", () => {
    const release = vi.spyOn(attachments, "releaseImageAttachments");
    const user: ChatMessage = {
      id: "user-1",
      role: "user",
      content: "hello",
      status: "complete",
      attachments: [{ id: "attachment-1", name: "reference.png", dataUrl: "data:image/png;base64,AQID" }],
      createdAt: 1,
    };
    const assistant: ChatMessage = { id: "assistant-1", role: "assistant", content: "partial", status: "streaming", attachments: [], createdAt: 2 };
    useChatStore.getState().setMessages([user, assistant]);
    const projectedUser = useChatStore.getState().messages[0];

    const completedAssistant: ChatMessage = { ...assistant, content: "final", status: "complete" };
    useChatStore.getState().setMessages([projectedUser, completedAssistant]);
    expect(useChatStore.getState().messages[0]).toBe(projectedUser);
    expect(useChatStore.getState().messages[1]).toMatchObject({ content: "final", status: "complete" });

    release.mockClear();
    useChatStore.getState().setMessages([useChatStore.getState().messages[1]]);
    expect(release).toHaveBeenCalledWith([expect.objectContaining({ id: "attachment-1" })]);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });
});
