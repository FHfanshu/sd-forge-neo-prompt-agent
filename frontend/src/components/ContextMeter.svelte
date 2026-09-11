<script lang="ts">
  let { tokens = 0, limit = 0, label = "Context" }: { tokens?: number; limit?: number; label?: string } = $props();

  const RADIUS = 12;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const safeTokens = $derived(Math.max(0, Math.round(tokens)));
  const safeLimit = $derived(Math.max(0, Math.round(limit)));
  const percent = $derived(safeLimit > 0 ? Math.min(100, (safeTokens / safeLimit) * 100) : 0);
  const roundedPercent = $derived(Math.round(percent));
  const dash = $derived((percent / 100) * CIRCUMFERENCE);
  const level = $derived(percent >= 90 ? "critical" : percent >= 70 ? "warning" : "normal");
  const description = $derived(`${label}: ${safeTokens.toLocaleString()} / ${safeLimit.toLocaleString()} tokens (${roundedPercent}%)`);
</script>

<span
  class:pa-context-warning={level === "warning"}
  class:pa-context-critical={level === "critical"}
  class="pa-context-meter"
  role="meter"
  aria-label={description}
  aria-valuemin="0"
  aria-valuemax={safeLimit || safeTokens}
  aria-valuenow={Math.min(safeTokens, safeLimit || safeTokens)}
  title={description}
  data-prompt-agent-context-meter="true"
>
  <svg viewBox="0 0 30 30" aria-hidden="true">
    <circle class="pa-context-track" cx="15" cy="15" r={RADIUS} />
    <circle
      class="pa-context-value"
      cx="15"
      cy="15"
      r={RADIUS}
      stroke-dasharray={`${dash} ${CIRCUMFERENCE}`}
      stroke-linecap={dash > 0 ? "round" : "butt"}
    />
  </svg>
  <span aria-hidden="true">{safeLimit > 0 ? roundedPercent : "–"}</span>
</span>

<style>
  .pa-context-meter {
    --pa-context-color: var(--pa-primary);
    position: relative;
    display: grid;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    place-items: center;
  }
  .pa-context-meter svg {
    position: absolute;
    inset: 0;
    width: 30px;
    height: 30px;
    transform: rotate(-90deg);
  }
  .pa-context-meter circle {
    fill: none;
    stroke-width: 3;
  }
  .pa-context-track {
    stroke: color-mix(in srgb, var(--pa-ink) 14%, transparent);
  }
  .pa-context-value {
    stroke: var(--pa-context-color);
    transition: stroke-dasharray 200ms ease, stroke 200ms ease;
  }
  .pa-context-meter > span {
    position: relative;
    color: var(--pa-ink-soft);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .pa-context-warning { --pa-context-color: #d97706; }
  .pa-context-critical { --pa-context-color: var(--pa-destructive); }
</style>
