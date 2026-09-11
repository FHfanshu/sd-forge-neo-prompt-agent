import { render } from "@testing-library/svelte";
import DOMPurify from "dompurify";
import { describe, expect, it, vi } from "vitest";
import Markdown from "../src/components/Markdown.svelte";

describe("Markdown streaming parse cost", () => {
  it("does not re-parse Markdown on every streamed content update", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    const sanitize = vi.spyOn(DOMPurify, "sanitize");
    const { rerender } = render(Markdown, { content: "a", streaming: true, smoothStreaming: true });

    await rerender({ content: "a b", streaming: true, smoothStreaming: true });
    await rerender({ content: "a b c", streaming: true, smoothStreaming: true });
    expect(sanitize).not.toHaveBeenCalled();

    await rerender({ content: "a b c", streaming: false, smoothStreaming: true });
    expect(sanitize).toHaveBeenCalledTimes(1);
  });
});
