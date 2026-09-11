<script lang="ts">
  import { Clock3, Search } from "lucide-svelte";
  import type { HistoryRow } from "../../contracts";
  import { useI18nStore } from "../../stores/i18n";
  import { useRuntimeStore } from "../../stores/runtime";
  import { useUiStore } from "../../stores/ui";

  let {
    filteredHistory,
    runtimeUnavailable,
    onselecthistory,
  }: {
    filteredHistory: HistoryRow[];
    runtimeUnavailable: boolean;
    onselecthistory: (row: HistoryRow) => void;
  } = $props();

  let historySearch = $state("");

  const searchedHistory = $derived(filteredHistory.filter((row) => {
    const query = historySearch.trim().toLowerCase();
    return !query || `${row.title} ${row.preview}`.toLowerCase().includes(query);
  }));

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

<div
  class="pa-history-popover"
  role="dialog"
  tabindex="-1"
  aria-label={t("history.title", "Chat history")}
  onkeydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); $useUiStore.setHistoryOpen(false); } }}
>
  <div class="pa-history-heading">
    <div>
      <span class="pa-eyebrow">{t("history.archive", "Archive")}</span>
      <strong>{t("history.title", "Chat history")}</strong>
    </div>
    <span class="pa-history-count">{searchedHistory.length}</span>
  </div>
  <label class="pa-history-search">
    <Search size={14} />
    <input bind:value={historySearch} placeholder={t("history.search", "Search sessions")} aria-label={t("history.search_label", "Search chat history")} />
  </label>
  <div class="pa-history-list" role="listbox" aria-label={t("history.sessions", "Chat history sessions")}>
    {#if runtimeUnavailable}
      <p class="pa-history-empty" role="status">{t("assistant.runtime.disconnected", "The Prompt Agent runtime is not connected. Open Model profiles and retry the connection.")}</p>
    {:else}
      {#if $useRuntimeStore.loading}
        <p class="pa-history-empty" role="status">{t("history.loading", "Loading chat history…")}</p>
      {/if}
      {#each searchedHistory as row (row.id)}
        <button
          type="button"
          class="pa-history-row"
          aria-label={row.title}
          role="option"
          aria-selected="false"
          onclick={() => { onselecthistory(row); $useUiStore.setHistoryOpen(false); }}
        >
          <span class="pa-history-source pa-history-source-{row.source.toLowerCase()}"><Clock3 size={12} />{row.source}</span>
          <span class="pa-history-row-main"><strong>{row.title}</strong><small>{row.preview || t("history.no_preview", "No preview")}</small></span>
          <span class="pa-history-row-meta"><time>{row.updatedAt}</time><small>{tf("history.message_count", "{count} messages", { count: row.messageCount })}</small></span>
        </button>
      {:else}
        <p class="pa-history-empty">{t("history.empty_search", "No sessions match that search.")}</p>
      {/each}
    {/if}
  </div>
</div>
