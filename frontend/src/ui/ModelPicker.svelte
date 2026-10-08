<script lang="ts">
  import { chooseEffort, chooseModel } from "../controller";
  import { EFFORTS } from "../types";
  import { app } from "../state.svelte";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";

  let open = $state(false);
  let root: HTMLDivElement;

  const status = $derived(app.lastError || !app.model ? "bad" : app.turnNote ? "warn" : "ok");

  async function pick(profileId: string, model: string) {
    open = false;
    await chooseModel(profileId, model);
  }

  function onWindowPointer(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="pa-picker" bind:this={root}>
  <button type="button" class="pa-picker-btn" disabled={app.busy} aria-haspopup="listbox" aria-expanded={open} title={app.profile ? `${app.profile.name} / ${app.model?.id}` : zh.noProfile} onclick={() => (open = !open)}>
    <span class="pa-dot pa-dot-{status}"></span>
    <span class="pa-picker-label">{app.model?.id ?? zh.noModel}</span>
    {#if app.effort}<span class="pa-picker-effort">{app.effort}</span>{/if}
    <Icon name="chevron-up" size={11} />
  </button>
  {#if open}
    <div class="pa-picker-menu" role="listbox">
      {#if !app.profiles.length}
        <button type="button" class="pa-picker-empty" onclick={() => { open = false; app.view = "settings"; }}>{zh.noProfile}</button>
      {/if}
      {#each app.profiles as profile (profile.id)}
        <div class="pa-picker-group">
          <span>{profile.name}</span>
          {#if !profile.has_api_key}<span class="pa-picker-warn">{zh.noKey}</span>{/if}
        </div>
        {#each profile.models as model (model.id)}
          {@const current = profile.id === app.profileId && model.id === app.model?.id}
          <button type="button" class="pa-picker-item" class:pa-picker-current={current} role="option" aria-selected={current} onclick={() => pick(profile.id, model.id)}>
            <span class="pa-picker-check">{#if current}<Icon name="check" size={13} />{/if}</span>
            <span class="pa-picker-name">{model.id}</span>
            {#if model.vision}<span class="pa-picker-badge"><Icon name="photo" size={11} />{zh.visionShort}</span>{/if}
          </button>
        {/each}
      {/each}
      {#if app.model}
        <div class="pa-picker-group"><span>{zh.reasoning}</span></div>
        <div class="pa-effort" role="radiogroup" aria-label={zh.reasoning}>
          {#each ["", ...EFFORTS] as effort}
            <button type="button" role="radio" aria-checked={app.effort === effort} class:pa-effort-on={app.effort === effort} onclick={() => chooseEffort(effort)}>{effort || zh.reasoningDefault}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
