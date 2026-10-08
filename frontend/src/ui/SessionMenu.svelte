<script lang="ts">
  import { deleteSession, openSession, renameSession } from "../controller";
  import { app } from "../state.svelte";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";

  let { close }: { close: () => void } = $props();
  let renaming = $state<string | null>(null);
  let title = $state("");

  function relative(ms: number): string {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
  }

  async function choose(id: string) {
    close();
    await openSession(id);
  }

  async function commitRename(id: string) {
    renaming = null;
    if (title.trim()) await renameSession(id, title.trim());
  }

  async function remove(id: string) {
    if (confirm(zh.confirmDelete)) await deleteSession(id);
  }
</script>

<div class="pa-menu" role="menu">
  {#if !app.sessions.length}<div class="pa-menu-empty">{zh.noSessions}</div>{/if}
  {#each app.sessions as session (session.id)}
    <div class="pa-menu-row" class:pa-menu-current={session.id === app.sessionId}>
      {#if renaming === session.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="pa-input" bind:value={title} autofocus onkeydown={(e) => e.key === "Enter" && commitRename(session.id)} onblur={() => commitRename(session.id)} />
      {:else}
        <button type="button" class="pa-menu-main" disabled={app.busy} onclick={() => choose(session.id)}>
          <span class="pa-menu-title">{session.title || zh.untitled}</span>
          <span class="pa-menu-time">{relative(session.updated_at)}</span>
        </button>
        <button type="button" class="pa-icon-btn pa-sm" title={zh.rename} onclick={() => { renaming = session.id; title = session.title; }}><Icon name="pencil" size={13} /></button>
        <button type="button" class="pa-icon-btn pa-sm" title={zh.delete} disabled={app.busy && session.id === app.sessionId} onclick={() => remove(session.id)}><Icon name="trash" size={13} /></button>
      {/if}
    </div>
  {/each}
</div>
