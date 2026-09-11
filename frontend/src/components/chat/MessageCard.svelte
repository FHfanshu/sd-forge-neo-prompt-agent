<script lang="ts">
  import {
    Bot, Check, ChevronDown, ChevronRight, Clipboard, Copy, FileCog, Pencil, UserRound, XCircle,
  } from "lucide-svelte";
  import type { ChatMessage } from "../../contracts";
  import { attachmentPreviewUrl, type PreparedImageAttachment } from "../../attachments";
  import { useChatStore } from "../../stores/chat";
  import { useI18nStore } from "../../stores/i18n";
  import type { WorkingPhase } from "../../stores/runtime";
  import Markdown from "../Markdown.svelte";
  import ProcessDrawer from "../ProcessDrawer.svelte";

  let {
    message,
    processMessages = [],
    collapsed = false,
    copied = false,
    submissionInFlight = false,
    requestActive = false,
    visibleWorkingPhase = "idle",
    workingTool = null,
    workingDetail = null,
    ontogglecollapse,
    oncopy,
    onbeginedit,
    onundo,
    onpreviewattachments,
  }: {
    message: ChatMessage;
    processMessages?: ChatMessage[];
    collapsed?: boolean;
    copied?: boolean;
    submissionInFlight?: boolean;
    requestActive?: boolean;
    visibleWorkingPhase?: WorkingPhase;
    workingTool?: string | null;
    workingDetail?: string | null;
    ontogglecollapse: (messageId: string) => void;
    oncopy: (message: ChatMessage) => void;
    onbeginedit: (message: ChatMessage) => void;
    onundo?: (message: ChatMessage) => void | Promise<void>;
    onpreviewattachments: (attachments: PreparedImageAttachment[], index: number) => void;
  } = $props();

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

  function roleLabel(msg: ChatMessage): string {
    if (msg.role === "tool") return msg.tool?.name ?? t("chat.role.tool", "Tool");
    return t(`chat.role.${msg.role}`, msg.role);
  }

  function reasoningPreview(value: string): string {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
  }

  function groupHasProcess(procMsgs: ChatMessage[], finalMsg: ChatMessage): boolean {
    return procMsgs.some((msg) => msg.role === "tool"
      || Boolean(msg.reasoning)
      || (msg.role === "assistant" && msg.id !== finalMsg.id && Boolean(msg.content.trim())));
  }
</script>

<article
  class:pa-message-user={message.role === "user"}
  class:pa-message-assistant={message.role === "assistant"}
  class:pa-message-error={message.role === "error"}
  class:pa-message-system={message.role === "system"}
  class:pa-message-streaming={message.status === "streaming"}
  class:pa-message-cancelled={message.status === "cancelled"}
  class="pa-message-card"
  data-prompt-agent-message-id={message.id}
>
  <div class="pa-message-heading">
    <span class="pa-message-role">
      {#if message.role === "user"}
        <UserRound size={15} />
      {:else if message.role === "error"}
        <XCircle size={15} />
      {:else if message.role === "assistant"}
        <Bot size={15} />
      {:else}
        <FileCog size={15} />
      {/if}
      {roleLabel(message)}
    </span>
    <span class="pa-message-meta">
      {#if message.status === "cancelled"}
        <span class="pa-status-marker pa-status-cancelled"><XCircle size={12} /> {t("chat.status.cancelled", "Cancelled")}</span>
      {:else if message.status === "error"}
        <span class="pa-status-marker pa-status-error">{t("chat.status.error", "Error")}</span>
      {/if}
      {#if message.usage && (message.role !== "assistant" || !groupHasProcess(processMessages, message))}
        <span class="pa-usage"><Clipboard size={11} /> {[message.usage.inputTokens !== undefined ? `${message.usage.inputTokens} in` : "", message.usage.outputTokens !== undefined ? `${message.usage.outputTokens} out` : "", message.usage.cacheReadTokens !== undefined ? `${message.usage.cacheReadTokens} cache` : "", message.usage.latencyMs !== undefined ? `${(message.usage.latencyMs / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ")}</span>
      {/if}
      {#if message.role !== "tool"}
        <button type="button" class="pa-message-collapse" onclick={() => oncopy(message)} aria-label={copied ? t("chat.copied", "Copied") : t("chat.copy", "Copy")}>
          {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
        </button>
      {/if}
      {#if message.role === "assistant" && message.status !== "streaming"}
        <button type="button" class="pa-message-collapse" onclick={() => ontogglecollapse(message.id)} aria-label={collapsed ? t("chat.expand", "Expand response") : t("chat.collapse", "Collapse response")}>
          {#if collapsed}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}
        </button>
      {/if}
    </span>
  </div>
  {#if collapsed}
    <button type="button" class="pa-message-collapsed-preview" onclick={() => ontogglecollapse(message.id)}>{reasoningPreview(message.content)}</button>
  {:else}
    {#if message.role === "assistant"}
      <ProcessDrawer
        finalMessage={message}
        processMessages={processMessages}
        active={message.status === "streaming" && (submissionInFlight || requestActive)}
        workingPhase={visibleWorkingPhase}
        workingTool={workingTool}
        workingDetail={workingDetail}
        onundo={onundo}
      />
    {/if}
    <Markdown content={message.content} streaming={message.status === "streaming"} smoothStreaming={message.role === "assistant"} />
  {/if}
  {#if message.attachments.length && !collapsed}
    <div class="pa-message-attachments" aria-label={tf("assistant.reference_images", "{count} reference images", { count: message.attachments.length })}>
      {#each message.attachments as attachment, index (attachment.id)}
        <button type="button" class="pa-message-attachment" onclick={() => onpreviewattachments(message.attachments, index)} aria-label={tf("assistant.preview_named", "Preview {name}", { name: attachment.name })}>
          <img src={attachmentPreviewUrl(attachment)} alt={attachment.name} width="58" height="48" loading="lazy" />
        </button>
      {/each}
    </div>
  {/if}
  {#if message.role === "user"}
    <div class="pa-message-footer">
      <div class="pa-message-actions">
        <button type="button" class="pa-message-action" disabled={Boolean($useChatStore.activeRequestId)} onclick={() => onbeginedit(message)}>
          <Pencil size={13} /> {t("assistant.rewind", "Edit and resend")}
        </button>
      </div>
    </div>
  {/if}
</article>
