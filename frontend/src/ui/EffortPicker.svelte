<script lang="ts">
  import { chooseEffort } from "../controller";
  import { app } from "../state.svelte";
  import { zh } from "../zh";

  // OpenAI-compatible reasoning_effort values; which ones a model accepts depends on its chat template
  const LEVELS = [
    { label: "关", effort: "none" },
    { label: "低", effort: "low" },
    { label: "中等", effort: "medium" },
    { label: "高", effort: "high" },
    { label: "很高", effort: "xhigh" },
  ];
  const RECOMMENDED = 2;
  const PAD = 18; // first/last tick distance from the track ends

  let open = $state(false);
  let dragging = $state(false);
  let width = $state(0);
  let root: HTMLDivElement;
  let slider = $state<HTMLDivElement>();

  const index = $derived(LEVELS.findIndex((level) => level.effort === app.effort));
  const label = $derived(index >= 0 ? LEVELS[index].label : zh.reasoningDefault);
  const xOf = (i: number) => PAD + ((width - PAD * 2) * i) / (LEVELS.length - 1);

  function set(i: number) {
    const next = Math.max(0, Math.min(LEVELS.length - 1, i));
    if (next !== index) chooseEffort(LEVELS[next].effort);
  }

  function fromPointer(event: PointerEvent) {
    const rect = slider!.getBoundingClientRect();
    set(Math.round(((event.clientX - rect.left - PAD) / (rect.width - PAD * 2)) * (LEVELS.length - 1)));
  }

  function onKey(event: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 } as Record<string, number>)[event.key];
    const from = index >= 0 ? index : RECOMMENDED;
    if (step) {
      event.preventDefault();
      set(index >= 0 ? from + step : from);
    } else if (event.key === "Home") set(0);
    else if (event.key === "End") set(LEVELS.length - 1);
  }

  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => slider?.focus());
  }

  function onWindowPointer(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="pa-picker" bind:this={root}>
  <button type="button" class="pa-picker-btn" class:pa-effort-set={index >= 0} disabled={app.busy || !app.model} aria-haspopup="dialog" aria-expanded={open} title={zh.reasoning} onclick={toggle}>
    {label}
  </button>
  {#if open}
    <div class="pa-effort-pop" role="dialog" aria-label={zh.reasoning}>
      <div class="pa-effort-head">
        <span class="pa-effort-title">{zh.reasoning}</span>
        <span class="pa-effort-value">{label}</span>
        <span class="pa-spacer"></span>
        {#if index >= 0}<button type="button" class="pa-text-btn" onclick={() => chooseEffort("")}>{zh.reasoningReset}</button>{/if}
        <span class="pa-effort-help" title={zh.reasoningHelp}>?</span>
      </div>
      <div class="pa-effort-ends"><span>{zh.reasoningFast}</span><span>{zh.reasoningSmart}</span></div>
      <div
        class="pa-slider"
        class:pa-dragging={dragging}
        bind:this={slider}
        bind:clientWidth={width}
        tabindex="0"
        role="slider"
        aria-label={zh.reasoning}
        aria-valuemin={0}
        aria-valuemax={LEVELS.length - 1}
        aria-valuenow={index >= 0 ? index : undefined}
        aria-valuetext={label}
        onkeydown={onKey}
        onpointerdown={(e) => { slider!.setPointerCapture(e.pointerId); dragging = true; fromPointer(e); }}
        onpointermove={(e) => slider!.hasPointerCapture(e.pointerId) && fromPointer(e)}
        onpointerup={() => (dragging = false)}
        onpointercancel={() => (dragging = false)}
      >
        <div class="pa-slider-track">
          {#if index >= 0}<div class="pa-slider-fill" style:width="{xOf(index)}px"></div>{/if}
        </div>
        {#each LEVELS as _, i}
          <div class="pa-slider-dot" class:pa-slider-tick={i === RECOMMENDED} style:left="{xOf(i)}px" style:opacity={i === index ? 0 : 1}></div>
        {/each}
        {#if index >= 0}<div class="pa-slider-thumb" style:left="{xOf(index)}px"></div>{/if}
      </div>
      <div class="pa-slider-marks"><span class="pa-slider-rec" style:left="{xOf(RECOMMENDED)}px">{zh.reasoningRecommended}</span></div>
    </div>
  {/if}
</div>
