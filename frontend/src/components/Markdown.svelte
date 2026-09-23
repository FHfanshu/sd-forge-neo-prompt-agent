<script lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { useI18nStore } from "../stores/i18n";

  let { content, streaming = false, renderStreamingMarkdown = false, smoothStreaming = false }: { content: string; streaming?: boolean; renderStreamingMarkdown?: boolean; smoothStreaming?: boolean } = $props();
  let markdownElement = $state<HTMLDivElement>();
  let displayedContent = $state("");
  let reducedMotion = $state(false);
  let settleToken = $state(0);
  let revealTimer: number | undefined;
  let settleTimer: number | undefined;
  const resetTimers = new Map<HTMLButtonElement, number>();

  // Bounded Markdown parsing: append-only stream growth is appended as plain text
  // instead of re-parsing and replacing the whole document on every event, so long
  // reasoning and tool traces cannot freeze the UI. Anything rendered as HTML still
  // passes through DOMPurify; the live tail is rendered as a text node.
  const STREAM_INLINE_LIMIT = 2048;
  const SETTLE_MS = 380;
  let parsedSource: string | null = null;
  let parsedHtml = "";
  let parsedWhileStreaming = false;
  let parsedToken = 0;

  function parseMarkdown(source: string): string {
    return DOMPurify.sanitize(marked.parse(source || " ", { gfm: true }) as string);
  }

  const rendered = $derived.by(() => {
    const current = content || "";
    const settle = settleToken;
    if (streaming && !renderStreamingMarkdown) return { html: "", tail: "", pending: false };
    const prior = parsedSource;
    if (current === prior) return { html: parsedHtml, tail: "", pending: false };
    const grown = prior !== null && current.startsWith(prior);
    const parseNow = prior === null
      || !grown
      || (!streaming && parsedWhileStreaming)
      || (!streaming && (settle !== parsedToken || current.length < STREAM_INLINE_LIMIT));
    if (parseNow) {
      parsedHtml = parseMarkdown(current);
      parsedSource = current;
      parsedWhileStreaming = streaming;
      parsedToken = settle;
      return { html: parsedHtml, tail: "", pending: false };
    }
    const tail = current.slice(prior?.length ?? 0);
    return { html: parsedHtml, tail, pending: true };
  });

  function graphemes(value: string): string[] {
    if (typeof Intl.Segmenter === "function") {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
    }
    return Array.from(value);
  }

  function stopReveal(): void {
    if (revealTimer === undefined) return;
    window.clearInterval(revealTimer);
    revealTimer = undefined;
  }

  function advanceReveal(): void {
    if (!content.startsWith(displayedContent)) displayedContent = "";
    const pending = graphemes(content.slice(displayedContent.length));
    if (!pending.length) {
      stopReveal();
      return;
    }
    const amount = Math.max(1, Math.min(12, Math.ceil(pending.length / 30)));
    displayedContent += pending.slice(0, amount).join("");
  }

  function startReveal(): void {
    if (revealTimer !== undefined) return;
    revealTimer = window.setInterval(advanceReveal, 24);
  }

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  function enhanceCodeBlocks(): void {
    if (!markdownElement) return;
    const copyLabel = t("chat.copy", "Copy");
    for (const pre of markdownElement.querySelectorAll("pre")) {
      const existing = pre.closest<HTMLElement>(".pa-code-block");
      if (existing) {
        const button = existing.querySelector<HTMLButtonElement>("[data-prompt-agent-code-copy]");
        if (button && !resetTimers.has(button)) button.textContent = copyLabel;
        continue;
      }
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      wrapper.className = "pa-code-block";
      button.type = "button";
      button.className = "pa-code-copy";
      button.dataset.codeCopy = "";
      button.textContent = copyLabel;
      button.setAttribute("aria-label", copyLabel);
      button.addEventListener("click", () => void copyCodeBlock(button));
      pre.before(wrapper);
      wrapper.append(button, pre);
    }
  }

  async function writeClipboard(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fall through for embedded browsers that expose but deny Clipboard API.
    }
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("Clipboard is unavailable");
  }

  async function copyCodeBlock(button: HTMLButtonElement): Promise<void> {
    const code = button.closest(".pa-code-block")?.querySelector("code");
    if (!code) return;
    try {
      await writeClipboard(code.textContent ?? "");
      button.textContent = t("chat.copied", "Copied");
    } catch {
      button.textContent = t("chat.copy_failed", "Copy failed");
    }
    window.clearTimeout(resetTimers.get(button));
    resetTimers.set(button, window.setTimeout(() => {
      resetTimers.delete(button);
      if (button.isConnected) button.textContent = t("chat.copy", "Copy");
    }, 1200));
  }

  $effect(() => {
    $useI18nStore.locale;
    if (streaming || !markdownElement) return;
    rendered.html;
    void tick().then(enhanceCodeBlocks);
  });

  $effect(() => {
    const pending = rendered.pending && !streaming;
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    if (!pending) return;
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      settleToken += 1;
    }, SETTLE_MS);
  });

  $effect(() => {
    const nextContent = content;
    const shouldReveal = streaming && smoothStreaming && !reducedMotion;
    const currentContent = untrack(() => displayedContent);
    if (!shouldReveal) {
      stopReveal();
      displayedContent = nextContent;
      return;
    }
    if (!nextContent.startsWith(currentContent)) displayedContent = "";
    if (nextContent !== currentContent) startReveal();
  });

  onMount(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const updateMotionPreference = () => reducedMotion = preference.matches;
    updateMotionPreference();
    preference.addEventListener?.("change", updateMotionPreference);
    return () => preference.removeEventListener?.("change", updateMotionPreference);
  });

  onDestroy(() => {
    stopReveal();
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    for (const timer of resetTimers.values()) window.clearTimeout(timer);
    resetTimers.clear();
  });
</script>

{#if streaming && !renderStreamingMarkdown}
  <div class="pa-markdown pa-markdown-streaming">{smoothStreaming ? displayedContent : content}</div>
{:else if streaming}
  <div class="pa-markdown pa-markdown-streaming">{@html rendered.html}{#if rendered.tail}<span class="pa-markdown-live">{rendered.tail}</span>{/if}</div>
{:else}
  <div bind:this={markdownElement} class="pa-markdown">{@html rendered.html}{#if rendered.tail}<span class="pa-markdown-live">{rendered.tail}</span>{/if}</div>
{/if}
