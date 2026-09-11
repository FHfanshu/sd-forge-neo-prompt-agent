<script lang="ts">
  import type { Action } from "svelte/action";
  import { History, Settings2, SquarePen, X } from "lucide-svelte";
  import type { HistoryRow } from "../../contracts";
  import { useChatStore } from "../../stores/chat";
  import { useI18nStore } from "../../stores/i18n";
  import { useUiStore } from "../../stores/ui";
  import ChatHistoryPanel from "./ChatHistoryPanel.svelte";

  let {
    filteredHistory,
    runtimeUnavailable,
    dragAction,
    dragParams,
    ontogglehistory,
    onselecthistory,
    onnewsession,
    onopensettings,
    onclose,
  }: {
    filteredHistory: HistoryRow[];
    runtimeUnavailable: boolean;
    dragAction?: Action<HTMLElement, any>;
    dragParams?: any;
    ontogglehistory: () => void;
    onselecthistory: (row: HistoryRow) => void;
    onnewsession: () => void;
    onopensettings: () => void;
    onclose: () => void;
  } = $props();

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  function useDrag(node: HTMLElement) {
    if (dragAction && dragParams) {
      return dragAction(node, dragParams);
    }
  }
</script>

<header class="pa-window-header" use:useDrag>
  <div class="pa-chat-title"><strong>{t("assistant.title", "Prompt Agent")}</strong></div>
  <div class="pa-header-controls">
    <div class="pa-history-anchor">
      <button
        type="button"
        class="pa-header-icon"
        aria-label={t("history.open", "Open chat history")}
        aria-expanded={$useUiStore.historyOpen}
        onclick={ontogglehistory}
      >
        <History size={16} />
      </button>
      {#if $useUiStore.historyOpen}
        <ChatHistoryPanel
          {filteredHistory}
          {runtimeUnavailable}
          {onselecthistory}
        />
      {/if}
    </div>
    <button
      type="button"
      class="pa-header-icon"
      onclick={onnewsession}
      aria-label={t("assistant.new_chat", "Start a new chat")}
      title={t("assistant.new_chat", "Start a new chat")}
      disabled={Boolean($useChatStore.activeRequestId)}
    >
      <SquarePen size={16} />
    </button>
    <button
      type="button"
      class="pa-header-icon"
      onclick={onopensettings}
      aria-label={t("assistant.open_settings", "Open settings")}
    >
      <Settings2 size={16} />
    </button>
    <button
      type="button"
      class="pa-header-icon pa-header-close"
      onclick={onclose}
      aria-label={t("assistant.close_window", "Close Prompt Agent")}
    >
      <X size={16} />
    </button>
  </div>
</header>
