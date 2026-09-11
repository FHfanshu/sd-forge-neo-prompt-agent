<script lang="ts">
  import { ChevronRight } from "lucide-svelte";
  import type { ChatMessage } from "../contracts";
  import type { WorkingPhase } from "../stores/runtime";
  import { useI18nStore } from "../stores/i18n";
  import Markdown from "./Markdown.svelte";
  import PromptChangeCard from "./PromptChangeCard.svelte";
  import ToolCard from "./ToolCard.svelte";
  import WorkingIndicator from "./WorkingIndicator.svelte";

  let {
    finalMessage,
    processMessages = [],
    active = false,
    workingPhase = "idle",
    workingTool = null,
    workingDetail = null,
    onundo,
  }: {
    finalMessage: ChatMessage;
    processMessages?: ChatMessage[];
    active?: boolean;
    workingPhase?: WorkingPhase;
    workingTool?: string | null;
    workingDetail?: string | null;
    onundo?: (message: ChatMessage) => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let wasActive = false;

  $effect(() => {
    if (active) open = true;
    else if (wasActive) open = false;
    wasActive = active;
  });

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  function tf(key: string, fallback: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      t(key, fallback),
    );
  }

  const timelineMessages = $derived(processMessages.some((message) => message.id === finalMessage.id)
    ? processMessages
    : [...processMessages, finalMessage]);
  const assistantMessages = $derived(timelineMessages.filter((message) => message.role === "assistant"));
  const reasoningMessages = $derived(assistantMessages.filter((message) => Boolean(message.reasoning)));
  const visibleIntermediateMessages = $derived(assistantMessages.filter((message) => message.id !== finalMessage.id && Boolean(message.content.trim())));
  const processTools = $derived(timelineMessages.filter((message) => message.role === "tool"));
  const mutationTools = $derived(processTools.filter((message) => {
    const mutation = message.tool?.mutation;
    return Boolean(mutation && (mutation.summary.added > 0 || mutation.summary.removed > 0));
  }));
  const failedTools = $derived(processTools.filter((message) => message.tool?.status === "error").length);
  const turnFailed = $derived(finalMessage.status === "error");
  const usage = $derived.by(() => {
    const latest = [...assistantMessages].reverse().find((message) => message.usage);
    return {
      input: latest?.usage?.inputTokens ?? 0,
      output: latest?.usage?.outputTokens ?? 0,
      cache: latest?.usage?.cacheReadTokens ?? 0,
    };
  });
  const hasProcess = $derived(Boolean(active || processTools.length || reasoningMessages.length || visibleIntermediateMessages.length));
  const summary = $derived.by(() => {
    const parts = [t("chat.process", "Process")];
    if (processTools.length) parts.push(tf("chat.process_tools", "{count} tools", { count: processTools.length }));
    if (failedTools) parts.push(tf("chat.process_failed", "{count} failed", { count: failedTools }));
    if (turnFailed) parts.push(t("chat.process_turn_failed", "Execution failed"));
    if (!processTools.length && reasoningMessages.length) parts.push(t("chat.process_reasoning", "reasoning"));
    return parts.join(" · ");
  });
</script>

{#each mutationTools as tool (tool.id)}
  {#if tool.tool?.mutation}<PromptChangeCard evidence={tool.tool.mutation} />{/if}
{/each}

{#if hasProcess}
  <details bind:open class:pa-process-active={active} class:pa-process-error={turnFailed} class="pa-process-drawer" data-prompt-agent-process="true">
    <summary>
      <span class="pa-process-title"><ChevronRight size={13} aria-hidden="true" /><strong>{summary}</strong></span>
      {#if usage.input || usage.output || usage.cache}<span class="pa-process-usage">{usage.input} in · {usage.output} out · {usage.cache} cache</span>{/if}
    </summary>
    <div class="pa-process-content">
      {#each timelineMessages as message (message.id)}
        {#if message.role === "assistant"}
          {#if message.reasoning}
            <section class="pa-process-reasoning" data-prompt-agent-process-event="reasoning">
              <span>{t("chat.reasoning_trace", "Reasoning trace")}</span>
              <Markdown content={message.reasoning} streaming={message.status === "streaming"} renderStreamingMarkdown={true} />
            </section>
          {/if}
          {#if message.id !== finalMessage.id && message.content.trim()}
            <section class="pa-process-intermediate" data-prompt-agent-process-event="intermediate">
              <span>{t("chat.process_intermediate", "Intermediate response")}</span>
              <Markdown content={message.content} streaming={message.status === "streaming"} />
            </section>
          {/if}
        {:else if message.role === "tool"}
          <div data-prompt-agent-process-event="tool"><ToolCard message={message} onundo={onundo} /></div>
        {/if}
      {/each}
      {#if active && workingPhase !== "idle"}<WorkingIndicator phase={workingPhase} tool={workingTool} statusDetail={workingDetail} />{/if}
    </div>
  </details>
{/if}
