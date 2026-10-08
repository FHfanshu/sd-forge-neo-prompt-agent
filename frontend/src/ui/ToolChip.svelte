<script lang="ts">
  import { TOOL_LABELS } from "../agent/tool-defs";
  import { diffPrompt } from "../lib/diff";
  import type { Message, ToolCall } from "../types";
  import Icon from "./Icon.svelte";
  import { TOOL_ICONS } from "./icons";

  let { call, result, running, open = $bindable(false) }: { call: ToolCall; result?: Message; running: boolean; open?: boolean } = $props();

  const args = $derived.by(() => {
    try {
      return JSON.parse(call.arguments || "{}") as Record<string, any>;
    } catch {
      return {};
    }
  });
  const parsed = $derived.by(() => {
    if (!result) return null;
    try {
      return JSON.parse(result.content) as Record<string, any>;
    } catch {
      return { ok: false, error: { message: result.content } };
    }
  });
  const failed = $derived(parsed ? parsed.ok === false : false);
  const diff = $derived(call.name === "edit_prompt" && parsed?.ok ? diffPrompt(String(parsed.before ?? ""), String(parsed.text ?? "")) : null);
  const summary = $derived.by(() => {
    if (diff) return null;
    if (call.name === "set_generation_parameters" && args.values && typeof args.values === "object") {
      return Object.entries(args.values).map(([k, v]) => `${k} ${v}`).join(" · ").slice(0, 60);
    }
    const hint = args.query ?? args.name ?? (Array.isArray(args.names) ? args.names.join(", ") : "");
    return hint ? String(hint).slice(0, 32) : "";
  });
  const detail = $derived.by(() => {
    const text = JSON.stringify({ arguments: args, result: parsed }, null, 2);
    return text.length > 4000 ? text.slice(0, 4000) + "\n…" : text;
  });
</script>

<button
  type="button"
  class="pa-chip"
  class:pa-chip-accent={call.name === "edit_prompt" && !failed}
  class:pa-chip-bad={failed}
  class:pa-chip-live={running && !result}
  aria-expanded={open}
  onclick={() => (open = !open)}
>
  {#if running && !result}<Icon name="loader" size={13} spin />{:else if failed || !result}<Icon name="alert" size={13} />{:else}<Icon name={TOOL_ICONS[call.name] ?? "tool"} size={13} />{/if}
  <span>{TOOL_LABELS[call.name] ?? call.name}</span>
  {#if !running && !result}
    <span class="pa-chip-hint">未完成</span>
  {:else if diff}
    <span class="pa-add">+{diff.added}</span><span class="pa-del">−{diff.removed}</span>
  {:else if summary}
    <span class="pa-chip-hint">{summary}</span>
  {/if}
  <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
</button>

{#snippet details()}
  {#if diff}
    <div class="pa-diff">
      {#each diff.lines as line}
        <div class="pa-diff-{line.kind}">{line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}{line.text}</div>
      {/each}
      {#if parsed?.note}<div class="pa-diff-note">{parsed.note}</div>{/if}
    </div>
  {:else}
    <pre class="pa-json">{detail}</pre>
  {/if}
{/snippet}

{#if open}
  <div class="pa-chip-detail">{@render details()}</div>
{/if}
