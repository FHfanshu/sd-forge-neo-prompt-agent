import { render } from "@testing-library/svelte";
import DOMPurify from "dompurify";
import { tick } from "svelte";
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

  it("keeps a growing reasoning stream from re-parsing Markdown per event", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
      const sanitize = vi.spyOn(DOMPurify, "sanitize");
      const { container, rerender } = render(Markdown, {
        content: "**step 1**\n",
        streaming: true,
        renderStreamingMarkdown: true,
      });

      // The growth transition re-parsed and replaced the whole document per event
      // before this bounded fallback existed.
      const snapshotParses = sanitize.mock.calls.length;
      expect(snapshotParses).toBe(1);

      let text = "**step 1**\n";
      for (let step = 2; step <= 11; step += 1) {
        text += `step ${step} <script>alert(${step})</script>\n`;
        await rerender({ content: text, streaming: true, renderStreamingMarkdown: true });
      }
      expect(sanitize.mock.calls.length).toBe(snapshotParses);

      // Live progress stays readable as plain text and never injects markup.
      expect(container.querySelector(".pa-markdown")).toHaveTextContent("step 11");
      expect(container.querySelector(".pa-markdown-live")).not.toBeNull();
      expect(container.querySelector("script")).toBeNull();

      await rerender({ content: text, streaming: false, renderStreamingMarkdown: true });
      expect(sanitize.mock.calls.length).toBe(snapshotParses + 1);
      expect(container.querySelector(".pa-markdown-live")).toBeNull();
      expect(container.querySelector("strong")).toHaveTextContent("step 1");
      expect(container.querySelector("script")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers parsing for a long tool trace and flushes it once growth stops", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
      const sanitize = vi.spyOn(DOMPurify, "sanitize");
      const first = "tool line\n".repeat(300);
      const { container, rerender } = render(Markdown, { content: first });
      const parses = sanitize.mock.calls.length;
      expect(parses).toBe(1);

      let text = first;
      for (let step = 0; step < 10; step += 1) {
        text += `trace ${step}\n`;
        await rerender({ content: text });
      }
      expect(sanitize.mock.calls.length).toBe(parses);
      expect(container.querySelector(".pa-markdown")).toHaveTextContent("trace 9");

      await vi.advanceTimersByTimeAsync(500);
      await tick();
      expect(sanitize.mock.calls.length).toBe(parses + 1);
      expect(container.querySelector(".pa-markdown-live")).toBeNull();
      expect(container.querySelector(".pa-markdown")).toHaveTextContent("trace 9");
    } finally {
      vi.useRealTimers();
    }
  });
});
