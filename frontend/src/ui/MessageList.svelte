<script lang="ts">
  import { PAGE_SIZE, app } from "../state.svelte";
  import type { Message } from "../types";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";
  import MessageItem from "./MessageItem.svelte";

  let scroller: HTMLDivElement;
  let follow = $state(true);
  let frame = 0;

  // Rebuilt only when the message array is replaced (discrete events), never per streamed token.
  const view = $derived.by(() => {
    const all = app.messages;
    const results = new Map<string, Message>();
    for (const message of all) if (message.role === "tool" && message.tool_call_id) results.set(message.tool_call_id, message);
    const lastUser = all.map((m) => m.role).lastIndexOf("user");
    const start = Math.max(0, all.length - app.visibleCount);
    const rows = [];
    for (let index = start; index < all.length; index++) {
      const message = all[index];
      if (message.role === "tool") continue;
      rows.push({
        message,
        results: (message.tool_calls ?? []).map((call) => results.get(call.id)),
        last: index === all.length - 1 || all.slice(index + 1).every((m) => m.role === "tool"),
        current: index > lastUser,
      });
    }
    return { rows, hasOlder: start > 0 };
  });

  function nearBottom(): boolean {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  function scheduleFollow() {
    if (!follow || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (follow && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  $effect(() => {
    // track changes that grow the content
    void app.messages;
    void app.live.content;
    void app.live.reasoning;
    scheduleFollow();
  });

  $effect(() => {
    void app.sessionId;
    follow = true;
  });

  function onScroll() {
    follow = nearBottom();
  }

  function showOlder() {
    const before = scroller.scrollHeight;
    app.visibleCount += PAGE_SIZE;
    requestAnimationFrame(() => (scroller.scrollTop += scroller.scrollHeight - before));
  }

  function toBottom() {
    follow = true;
    scroller.scrollTop = scroller.scrollHeight;
  }
</script>

<div class="pa-scroll" bind:this={scroller} onscroll={onScroll}>
  {#if view.hasOlder}
    <button type="button" class="pa-older" onclick={showOlder}>{zh.loadOlder}</button>
  {/if}
  {#if !view.rows.length}
    <div class="pa-empty">
      <Icon name="message" size={28} />
      <div class="pa-empty-title">{zh.emptyTitle}</div>
      <div class="pa-empty-body">{zh.emptyBody}</div>
    </div>
  {/if}
  {#each view.rows as row (row.message.id)}
    <MessageItem message={row.message} results={row.results} last={row.last} current={row.current} />
  {/each}
</div>
{#if !follow}
  <button type="button" class="pa-to-bottom" onclick={toBottom}><Icon name="arrow-down" size={13} />{zh.toBottom}</button>
{/if}
