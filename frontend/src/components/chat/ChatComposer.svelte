<script lang="ts">
  import {
    CircleStop, Clock3, ImagePlus, Pencil, Plus, RefreshCw, Send, Trash2, X,
  } from "lucide-svelte";
  import type { QueuedFollowUp } from "../../contracts";
  import { attachmentPreviewUrl, type PreparedImageAttachment } from "../../attachments";
  import { useChatStore } from "../../stores/chat";
  import { useI18nStore } from "../../stores/i18n";
  import { useRuntimeStore } from "../../stores/runtime";
  import ContextMeter from "../ContextMeter.svelte";
  import ModelPicker from "../ModelPicker.svelte";
  import ReasoningPicker from "../ReasoningPicker.svelte";

  let {
    draft = $bindable(""),
    attachments = $bindable<PreparedImageAttachment[]>([]),
    editingMessageId = null,
    dropActive = false,
    submissionPending = false,
    queueSubmissionInFlight = false,
    submissionInFlight = false,
    requestActive = false,
    contextTokens = 0,
    contextLimit = 131072,
    onsubmit,
    onaddfiles,
    oncanceledit,
    onresumequeued,
    onremovequeued,
    onchooseattachments,
    onreplacerequest,
    onremoveattachment,
    onpreviewattachment,
    onstop,
    onkeepcomposerfocus,
    onfocus,
    onblur,
  }: {
    draft: string;
    attachments: PreparedImageAttachment[];
    editingMessageId: string | null;
    dropActive: boolean;
    submissionPending: boolean;
    queueSubmissionInFlight: boolean;
    submissionInFlight: boolean;
    requestActive: boolean;
    contextTokens: number;
    contextLimit: number;
    onsubmit: () => void;
    onaddfiles: (files: File[]) => void;
    oncanceledit: () => void;
    onresumequeued: () => void;
    onremovequeued: (id: string) => void;
    onchooseattachments: () => void;
    onreplacerequest: (attachmentId: string) => void;
    onremoveattachment: (attachmentId: string) => void;
    onpreviewattachment: (index: number) => void;
    onstop: () => void;
    onkeepcomposerfocus: (event: PointerEvent) => void;
    onfocus: () => void;
    onblur: () => void;
  } = $props();

  let composerInput = $state<HTMLTextAreaElement>();
  let fileInput = $state<HTMLInputElement>();
  let replacementInput = $state<HTMLInputElement>();
  let attachmentMenuId = $state<string | null>(null);

  const queuedFollowUps = $derived($useRuntimeStore.queuedFollowUps);

  export function focusComposer(): void {
    composerInput?.focus();
  }

  export function getComposerInput(): HTMLTextAreaElement | undefined {
    return composerInput;
  }

  export function triggerFileInput(): void {
    fileInput?.click();
  }

  export function resizeComposer(element = composerInput): void {
    if (!element) return;
    element.style.height = "0px";
    const styles = getComputedStyle(element);
    const minimum = Number.parseFloat(styles.minHeight) || 42;
    const maximum = Number.parseFloat(styles.maxHeight) || 132;
    const contentHeight = element.scrollHeight;
    element.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
    element.style.overflowY = contentHeight > maximum ? "auto" : "hidden";
  }

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
</script>

<form
  class:pa-composer-drop-active={dropActive}
  class="pa-composer"
  onsubmit={(event) => { event.preventDefault(); onsubmit(); }}
  ondragover={(event) => { event.preventDefault(); dropActive = true; }}
  ondragleave={() => dropActive = false}
  ondrop={(event) => { event.preventDefault(); dropActive = false; onaddfiles(Array.from(event.dataTransfer?.files ?? [])); }}
>
  {#if editingMessageId}
    <div class="pa-editing-banner" role="status">
      <span><Pencil size={13} /> {t("chat.editing", "Editing message")}</span>
      <button type="button" onclick={oncanceledit}>{t("chat.cancel_edit", "Cancel")}</button>
    </div>
  {/if}

  {#if queuedFollowUps.length}
    <section class="pa-followup-queue" aria-label={t("assistant.queue.label", "Queued follow-ups")}>
      <div class="pa-followup-heading">
        <span><Clock3 size={13} /> {tf("assistant.queue.next", "Next · {count}", { count: queuedFollowUps.length })}</span>
        {#if !requestActive}
          <span class="pa-followup-paused">{t("assistant.queue.paused", "Paused")}</span>
          <button type="button" onclick={onresumequeued}>{t("assistant.queue.continue", "Continue")}</button>
        {/if}
      </div>
      <ol>
        {#each queuedFollowUps as item, index (item.id)}
          <li>
            <span class="pa-followup-index">{index + 1}</span>
            <span class="pa-followup-text">{item.text.trim() || tf("assistant.queue.attachments_only", "{count} attached image(s)", { count: item.attachmentCount })}</span>
            {#if item.attachmentCount > 0 && item.text.trim()}
              <span class="pa-followup-attachments">+{item.attachmentCount} <ImagePlus size={11} /></span>
            {/if}
            <button type="button" onclick={() => onremovequeued(item.id)} aria-label={t("assistant.queue.remove", "Remove queued follow-up")}>
              <X size={13} />
            </button>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if attachments.length}
    <div class="pa-filmstrip" aria-label={t("assistant.attached_images", "Attached reference images")}>
      {#each attachments as attachment, index (attachment.id)}
        <div class="pa-filmstrip-item">
          <button
            type="button"
            class="pa-filmstrip-preview"
            onclick={() => onpreviewattachment(index)}
            oncontextmenu={(event) => { event.preventDefault(); attachmentMenuId = attachment.id; }}
            aria-label={tf("assistant.preview_named", "Preview {name}", { name: attachment.name })}
          >
            <img src={attachmentPreviewUrl(attachment)} alt={attachment.name} width="58" height="54" />
            <span class="pa-filmstrip-name">{attachment.name}</span>
          </button>
          <button type="button" class="pa-filmstrip-remove" onclick={() => onremoveattachment(attachment.id)} aria-label={tf("assistant.remove_named", "Remove {name}", { name: attachment.name })}>
            <X size={12} />
          </button>
          <button type="button" class="pa-filmstrip-more" onclick={() => attachmentMenuId = attachmentMenuId === attachment.id ? null : attachment.id} aria-label={tf("assistant.edit_named", "Edit {name}", { name: attachment.name })}>
            •••
          </button>
          {#if attachmentMenuId === attachment.id}
            <div class="pa-attachment-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onclick={() => {
                  onreplacerequest(attachment.id);
                  replacementInput?.click();
                  attachmentMenuId = null;
                }}
              >
                <Pencil size={13} /> {t("common.replace", "Replace")}
              </button>
              <button type="button" role="menuitem" onclick={() => { onremoveattachment(attachment.id); attachmentMenuId = null; }}>
                <Trash2 size={13} /> {t("common.remove", "Remove")}
              </button>
            </div>
          {/if}
        </div>
      {/each}
      <button type="button" class="pa-filmstrip-add" onclick={onchooseattachments} aria-label={t("assistant.attach_another", "Attach another image")}>
        <Plus size={17} />
      </button>
    </div>
  {/if}

  <textarea
    name="prompt-agent-message"
    autocomplete="off"
    bind:this={composerInput}
    bind:value={draft}
    rows="1"
    placeholder={requestActive ? t("assistant.input.follow_up", "Add a follow-up for after this response…") : t("assistant.input.placeholder", "Ask about or change the current prompt…")}
    aria-label={t("assistant.input.label", "Message Prompt Agent")}
    onfocus={onfocus}
    onblur={onblur}
    oninput={(event) => resizeComposer(event.currentTarget)}
    onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) { event.preventDefault(); onsubmit(); } }}
  ></textarea>

  <div class="pa-composer-bottom">
    <div class="pa-composer-tools">
      <button type="button" class="pa-composer-icon" onclick={onchooseattachments} aria-label={t("assistant.attach", "Attach reference images")}><ImagePlus size={16} /></button>
    </div>
    <div class="pa-composer-tools">
      <ContextMeter tokens={contextTokens} limit={contextLimit} label={t("assistant.context_usage", "Context")} />
      <div class="pa-composer-picker-row" aria-label={t("assistant.model_controls", "Model controls")}>
        <ModelPicker />
        <ReasoningPicker />
      </div>
      {#if requestActive}
        <button
          type="button"
          class="pa-stop-button"
          onclick={onstop}
          disabled={$useRuntimeStore.workingPhase === "cancelling"}
          aria-label={t("assistant.stop", "Stop response")}
        >
          <CircleStop size={17} />
        </button>
      {/if}
      <button
        type="submit"
        class="pa-send-button"
        onpointerdown={onkeepcomposerfocus}
        disabled={(requestActive || queuedFollowUps.length ? queueSubmissionInFlight : submissionInFlight) || (!draft.trim() && !attachments.length)}
        aria-busy={submissionPending}
        aria-label={requestActive || queuedFollowUps.length ? t("assistant.queue.send", "Queue follow-up") : t("assistant.send", "Send message")}
      >
        {#if submissionPending}
          <RefreshCw class="pa-send-pending-icon" size={17} />
        {:else if requestActive || queuedFollowUps.length}
          <Clock3 size={17} />
        {:else}
          <Send size={17} />
        {/if}
      </button>
    </div>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    multiple
    hidden
    onchange={(event) => { onaddfiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}
  />
  <input
    bind:this={replacementInput}
    type="file"
    accept="image/*"
    hidden
    onchange={(event) => {
      const file = event.currentTarget.files?.[0];
      if (file) {
        onaddfiles([file]);
      }
      event.currentTarget.value = "";
    }}
  />
</form>
