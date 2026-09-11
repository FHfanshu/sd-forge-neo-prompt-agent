<script lang="ts">
  let { tokens = 0, limit = 0, label = "Context" }: { tokens?: number; limit?: number; label?: string } = $props();

  const safeTokens = $derived(Math.max(0, Math.round(tokens)));
  const safeLimit = $derived(Math.max(0, Math.round(limit)));
  const percent = $derived(safeLimit > 0 ? Math.min(100, (safeTokens / safeLimit) * 100) : 0);
  const roundedPercent = $derived(Math.round(percent));
  const description = $derived(`${label}: ${safeTokens.toLocaleString()} / ${safeLimit.toLocaleString()} tokens (${roundedPercent}%)`);
</script>

<span
  class:pa-context-warning={percent >= 70 && percent < 90}
  class:pa-context-critical={percent >= 90}
  class="pa-context-meter"
  style={`--pa-context-angle: ${percent * 3.6}deg`}
  role="meter"
  aria-label={description}
  aria-valuemin="0"
  aria-valuemax={safeLimit}
  aria-valuenow={Math.min(safeTokens, safeLimit || safeTokens)}
  title={description}
  data-prompt-agent-context-meter="true"
><span>{roundedPercent}</span></span>

<style>
  .pa-context-meter {
    --pa-context-color: var(--pa-primary);
    display: grid;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 999px;
    background: conic-gradient(var(--pa-context-color) var(--pa-context-angle), color-mix(in srgb, var(--pa-ink) 12%, transparent) 0);
  }
  .pa-context-meter > span {
    display: grid;
    width: 23px;
    height: 23px;
    place-items: center;
    border-radius: inherit;
    color: var(--pa-ink-soft);
    background: var(--pa-panel);
    font-size: 8px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .pa-context-warning { --pa-context-color: #d97706; }
  .pa-context-critical { --pa-context-color: var(--pa-destructive); }
</style>
