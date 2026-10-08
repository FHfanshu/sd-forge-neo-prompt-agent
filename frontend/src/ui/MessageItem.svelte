<script lang="ts">
  import { api } from "../api";
  import { editAndResend, retry } from "../controller";
  import { renderMarkdown } from "../lib/markdown";
  import { app } from "../state.svelte";
  import type { Message } from "../types";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";
  import ToolChip from "./ToolChip.svelte";

  let { message, results, last, current }: { message: Message; results: (Message | undefined)[]; last: boolean; current: boolean } = $props();

  let thinkingOpen = $state(false);
  let editing = $state(false);
  let draft = $state("");
  let copied = $state(false);

  const isLive = $derived(message.status === "streaming");
  const text = $derived(isLive && app.live.id === message.id ? app.live.content : message.content);
  const reasoning = $derived(isLive && app.live.id === message.id ? app.live.reasoning : message.reasoning);
  const html = $derived(!isLive && message.role === "assistant" && message.content ? renderMarkdown(message.content) : "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // clipboard may be unavailable on plain-http origins
    }
  }

  function startEdit() {
    draft = message.content;
    editing = true;
  }

  async function submitEdit() {
    editing = false;
    await editAndResend(message.id, draft);
  }

  function onMarkdownClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest(".pa-code-copy");
    const code = button?.parentElement?.querySelector("code");
    if (code) void navigator.clipboard?.writeText(code.textContent ?? "").catch(() => {});
  }
</script>

{#if message.role === "user"}
  <div class="pa-user">
    {#if message.attachments?.length}
      <div class="pa-thumbs">
        {#each message.attachments as attachment (attachment.id)}
          <a href={api.attachmentUrl(attachment.id)} target="_blank" rel="noreferrer"><img src={api.modelImageUrl(attachment.id)} alt="" loading="lazy" /></a>
        {/each}
      </div>
    {/if}
    {#if editing}
      <div class="pa-edit">
        <textarea bind:value={draft} rows="3"></textarea>
        <div class="pa-edit-actions">
          <button type="button" class="pa-text-btn" onclick={() => (editing = false)}>{zh.cancel}</button>
          <button type="button" class="pa-text-btn pa-strong" onclick={submitEdit}>{zh.send}</button>
        </div>
      </div>
    {:else if message.content}
      <div class="pa-bubble">{message.content}</div>
    {/if}
    {#if !editing}
      <div class="pa-actions">
        <button type="button" class="pa-icon-btn pa-sm" title={copied ? zh.copied : zh.copy} onclick={copy}><Icon name={copied ? "check" : "copy"} size={13} /></button>
        <button type="button" class="pa-icon-btn pa-sm" title={zh.edit} disabled={app.busy} onclick={startEdit}><Icon name="pencil" size={13} /></button>
      </div>
    {/if}
  </div>
{:else if message.role === "assistant"}
  <div class="pa-assistant">
    {#if reasoning || message.tool_calls?.length}
      <div class="pa-chips">
        {#if reasoning}
          <button type="button" class="pa-chip" class:pa-chip-live={isLive && !text} aria-expanded={thinkingOpen} onclick={() => (thinkingOpen = !thinkingOpen)}>
            <Icon name={isLive && !text ? "loader" : "sparkles"} size={13} spin={isLive && !text} />
            <span>{isLive && !text ? zh.thinking : zh.thought(reasoning.length)}</span>
          </button>
          {#if thinkingOpen}<div class="pa-chip-detail"><div class="pa-reasoning">{reasoning}</div></div>{/if}
        {/if}
        {#each message.tool_calls ?? [] as call, index (call.id)}
          <ToolChip {call} result={results[index]} running={app.busy && current} />
        {/each}
      </div>
    {/if}
    {#if isLive}
      {#if text}
        <div class="pa-text pa-plain">{text}<span class="pa-cursor"></span></div>
      {:else if !reasoning}
        <div class="pa-text pa-muted">{zh.requesting}<span class="pa-cursor"></span></div>
      {/if}
    {:else if html}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="pa-text pa-md" onclick={onMarkdownClick}>{@html html}</div>
    {/if}
    {#if message.status === "error" && message.error}
      <div class="pa-error"><Icon name="alert" size={13} /><span>{message.error}</span>
        {#if last && !app.busy}<button type="button" class="pa-text-btn" onclick={() => retry()}>{zh.retry}</button>{/if}
      </div>
    {:else if message.status === "stopped"}
      <span class="pa-tag">{zh.stopped}</span>
    {:else if message.status === "interrupted"}
      <span class="pa-tag pa-tag-warn">{zh.interrupted}</span>
    {/if}
    {#if !isLive && message.content}
      <div class="pa-actions pa-actions-left">
        <button type="button" class="pa-icon-btn pa-sm" title={copied ? zh.copied : zh.copy} onclick={copy}><Icon name={copied ? "check" : "copy"} size={13} /></button>
      </div>
    {/if}
  </div>
{/if}
