<script lang="ts">
  import { BrainCircuit, CircleStop, RefreshCw, Send, Sparkles, Wrench } from "lucide-svelte";
  import type { WorkingPhase } from "../stores/runtime";
  import { useI18nStore } from "../stores/i18n";

  let { phase, tool = null, statusDetail = null }: { phase: Exclude<WorkingPhase, "idle">; tool?: string | null; statusDetail?: string | null } = $props();

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  const label = $derived(phase === "submitting"
    ? t("assistant.working.submitting", "Sending request…")
    : phase === "cancelling"
      ? t("assistant.working.cancelling", "Stopping response…")
      : phase === "retrying"
        ? statusDetail?.startsWith("Provider request")
          ? t("assistant.working.provider_retrying", "Retrying provider request…")
          : t("assistant.working.retrying", "Retrying with tool feedback…")
      : phase === "tool"
        ? t("assistant.working.tool", "Running tool…")
        : phase === "generating"
          ? t("assistant.working.generating", "Generating response…")
          : t("assistant.working.thinking", "Thinking…"));
  const detail = $derived(phase === "retrying" && statusDetail
    ? statusDetail
    : phase === "tool" && tool
    ? `${t("assistant.working.tool_name", "Tool")}: ${tool}`
    : "");
</script>

<div class="pa-working-indicator pa-working-{phase}" role="status" aria-live="polite">
  <div class="pa-working-summary"><span class="pa-working-icon" aria-hidden="true">{#if phase === "submitting"}<Send size={14} />{:else if phase === "cancelling"}<CircleStop size={14} />{:else if phase === "retrying"}<RefreshCw size={14} />{:else if phase === "tool"}<Wrench size={14} />{:else if phase === "generating"}<Sparkles size={14} />{:else}<BrainCircuit size={14} />{/if}</span><strong><span>{label}</span>{#if phase === "tool" && tool} <code>{tool}</code>{/if}</strong><span class="pa-working-thread" aria-hidden="true"><i></i></span></div>
  {#if detail}<small class="pa-working-detail" title={detail}>{detail}</small>{/if}
</div>
