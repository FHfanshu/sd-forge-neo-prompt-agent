<script lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { useI18nStore } from "../stores/i18n";

  let { content, streaming = false, renderStreamingMarkdown = false, smoothStreaming = false }: { content: string; streaming?: boolean; renderStreamingMarkdown?: boolean; smoothStreaming?: boolean } = $props();
  let markdownElement = $state<HTMLDivElement>();
  let displayedContent = $state("");
  let reducedMotion = $state(false);
  let revealTimer: number | undefined;
  const resetTimers = new Map<HTMLButtonElement, number>();
  const html = $derived(DOMPurify.sanitize(marked.parse(content || " ", { gfm: true }) as string));

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
    html;
    $useI18nStore.locale;
    if (streaming || !markdownElement) return;
    void tick().then(enhanceCodeBlocks);
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
    for (const timer of resetTimers.values()) window.clearTimeout(timer);
    resetTimers.clear();
  });
</script>

{#if streaming && !renderStreamingMarkdown}
  <div class="pa-markdown pa-markdown-streaming">{smoothStreaming ? displayedContent : content}</div>
{:else if streaming}
  <div class="pa-markdown pa-markdown-streaming">{@html html}</div>
{:else}
  <div bind:this={markdownElement} class="pa-markdown">{@html html}</div>
{/if}
