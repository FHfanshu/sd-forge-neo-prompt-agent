<script lang="ts">
  import { Sparkles } from "lucide-svelte";
  import type { ChatMessage } from "../../contracts";
  import type { PreparedImageAttachment } from "../../attachments";
  import { useChatStore } from "../../stores/chat";
  import { useI18nStore } from "../../stores/i18n";
  import { useRuntimeStore } from "../../stores/runtime";
  import type { WorkingPhase } from "../../stores/runtime";
  import ToolCard from "../ToolCard.svelte";
  import WorkingIndicator from "../WorkingIndicator.svelte";
  import MessageCard from "./MessageCard.svelte";

  let {
    visibleMessages,
    renderMessages,
    collapsedMessageIds,
    copiedId,
    submissionInFlight,
    requestActive,
    visibleWorkingPhase,
    onscroll,
    ontogglecollapse,
    oncopy,
    onbeginedit,
    onundo,
    onpreviewattachments,
    onusesuggestion,
    onchooseattachments,
  }: {
    visibleMessages: ChatMessage[];
    renderMessages: { groups: Array<{ message: ChatMessage; processMessages: ChatMessage[] }>; pendingTools: ChatMessage[] };
    collapsedMessageIds: Set<string>;
    copiedId: string | null;
    submissionInFlight: boolean;
    requestActive: boolean;
    visibleWorkingPhase: WorkingPhase;
    onscroll: () => void;
    ontogglecollapse: (messageId: string) => void;
    oncopy: (message: ChatMessage) => void;
    onbeginedit: (message: ChatMessage) => void;
    onundo?: (message: ChatMessage) => void | Promise<void>;
    onpreviewattachments: (attachments: PreparedImageAttachment[], index: number) => void;
    onusesuggestion: (text: string) => void;
    onchooseattachments: () => void;
  } = $props();

  let messageScroll = $state<HTMLDivElement>();

  export function getScrollElement(): HTMLDivElement | undefined {
    return messageScroll;
  }

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }
</script>

<div
  bind:this={messageScroll}
  class="pa-message-scroll"
  role="log"
  aria-live="polite"
  aria-busy={Boolean($useChatStore.activeRequestId)}
  onscroll={onscroll}
>
  {#if visibleMessages.length > 0}
    {#each renderMessages.groups as group (group.message.id)}
      <MessageCard
        message={group.message}
        processMessages={group.processMessages}
        collapsed={collapsedMessageIds.has(group.message.id)}
        copied={copiedId === group.message.id}
        {submissionInFlight}
        {requestActive}
        {visibleWorkingPhase}
        workingTool={$useRuntimeStore.workingTool}
        workingDetail={$useRuntimeStore.workingDetail}
        {ontogglecollapse}
        {oncopy}
        {onbeginedit}
        {onundo}
        {onpreviewattachments}
      />
    {/each}
    {#each renderMessages.pendingTools as tool (tool.id)}
      <div class="pa-orphan-tools">
        <ToolCard message={tool} onundo={onundo} />
      </div>
    {/each}
  {:else}
    <div class="pa-empty-state">
      <Sparkles size={20} aria-hidden="true" />
      <strong>{t("assistant.empty.title", "Start with the current prompt")}</strong>
      <p>{t("assistant.empty.hint", "Ask Prompt Agent to review composition, rewrite a prompt, inspect installed resources, or attach reference images.")}</p>
      <div>
        <button type="button" onclick={() => onusesuggestion(t("assistant.quick.review_prompt", "Read the current prompt and suggest the highest-impact improvement."))}>
          {t("assistant.quick.review", "Review current prompt")}
        </button>
        <button type="button" onclick={onchooseattachments}>
          {t("assistant.quick.reference", "Analyze reference images")}
        </button>
      </div>
    </div>
  {/if}
  {#if (submissionInFlight || requestActive) && visibleWorkingPhase !== "idle" && !visibleMessages.some((message) => message.role === "assistant" && message.status === "streaming")}
    <WorkingIndicator phase={visibleWorkingPhase} tool={$useRuntimeStore.workingTool} statusDetail={$useRuntimeStore.workingDetail} />
  {/if}
</div>
