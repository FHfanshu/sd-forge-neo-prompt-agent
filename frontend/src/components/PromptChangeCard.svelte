<script lang="ts">
  import { Minus, Plus } from "lucide-svelte";
  import type { PromptMutationEvidence } from "../contracts";
  import { useI18nStore } from "../stores/i18n";

  let { evidence }: { evidence: PromptMutationEvidence } = $props();

  function t(key: string, fallback: string): string {
    const value = $useI18nStore.t(key);
    return value === key ? fallback : value;
  }

  function poolLabel(pool: PromptMutationEvidence["changes"][number]["pool"]): string {
    return t(`chat.prompt_diff.pool.${pool}`, {
      natural_language: "Natural language",
      tags: "Tags",
      special: "Special syntax",
      unknown: "Preserved unknown",
    }[pool]);
  }

  const pools = $derived.by(() => {
    const order = ["tags", "natural_language", "special", "unknown"] as const;
    const kindOrder = ["added", "removed"] as const;
    return order
      .map((pool) => ({
        pool,
        groups: kindOrder
          .map((kind) => ({ kind, changes: evidence.changes.filter((change) => change.pool === pool && change.kind === kind) }))
          .filter((group) => group.changes.length > 0),
      }))
      .filter((group) => group.groups.length > 0);
  });
  const title = $derived(evidence.field === "negative"
    ? t("chat.prompt_diff.negative_updated", "Negative prompt updated")
    : t("chat.prompt_diff.positive_updated", "Positive prompt updated"));
  const disabledNegative = $derived(evidence.field === "negative" && evidence.effective === false);
</script>

<section class="pa-prompt-change" data-prompt-change="true" aria-label={title}>
  <header>
    <span class="pa-prompt-change-title">
      <strong>{title}</strong>
      {#if disabledNegative}<span class="pa-prompt-inactive">{t("chat.prompt_diff.disabled", "disabled")}</span>{/if}
    </span>
    <span class="pa-prompt-change-counts" aria-label={t("chat.prompt_diff.change_summary", "Prompt change summary")}>
      {#if evidence.summary.added}<span class="pa-diff-count pa-diff-count-added"><Plus size={12} aria-hidden="true" />{evidence.summary.added}</span>{/if}
      {#if evidence.summary.removed}<span class="pa-diff-count pa-diff-count-removed"><Minus size={12} aria-hidden="true" />{evidence.summary.removed}</span>{/if}
    </span>
  </header>
  <div class="pa-prompt-change-body">
    {#if disabledNegative}
      <p class="pa-prompt-inactive-note" role="status">
        {t("chat.prompt_diff.negative_inactive_note", "Text changed, but the negative prompt is currently disabled and will not affect generation.")}
      </p>
    {/if}
    {#if evidence.changes.length}
      <div class="pa-prompt-diff-list">
         {#each pools as group (group.pool)}
           <section class="pa-prompt-diff-pool">
             <h4>{poolLabel(group.pool)}</h4>
             {#each group.groups as changeGroup (changeGroup.kind)}
               <div class={`pa-prompt-diff-row pa-prompt-diff-${changeGroup.kind}`}>
                 <span class="pa-prompt-diff-kind">
                   {#if changeGroup.kind === "added"}<Plus size={12} aria-hidden="true" />{t("chat.prompt_diff.kind.added", "Added")}{:else}<Minus size={12} aria-hidden="true" />{t("chat.prompt_diff.kind.removed", "Removed")}{/if}
                 </span>
                 <span class:pa-prompt-diff-tags={group.pool === "tags"} class="pa-prompt-diff-values">
                   {#each changeGroup.changes as change, index (`${change.kind}-${change.fromIndex ?? "x"}-${change.toIndex ?? "x"}-${index}`)}
                     <span class:pa-prompt-diff-tag={group.pool === "tags"} class="pa-prompt-diff-value">
                       {#if change.kind === "removed"}<del>{change.before ?? ""}</del>
                       {:else if change.kind === "added"}<ins>{change.after ?? ""}</ins>
                       {:else}<ins>{change.after ?? ""}</ins>{/if}
                     </span>{#if group.pool === "tags" && index < changeGroup.changes.length - 1}<span class="pa-prompt-diff-separator" aria-hidden="true">, </span>{/if}
                   {/each}
                 </span>
               </div>
             {/each}
          </section>
        {/each}
      </div>
    {:else}
      <p class="pa-prompt-no-diff">{t("chat.prompt_diff.no_semantic_changes", "No semantic prompt changes detected.")}</p>
    {/if}
    {#if evidence.truncated}<p class="pa-prompt-diff-truncated">{t("chat.prompt_diff.truncated", "Additional changes are hidden.")}</p>{/if}
  </div>
</section>
