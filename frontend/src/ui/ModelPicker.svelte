<script lang="ts">
  import { chooseModel, probeAll, probeDot } from "../controller";
  import { app } from "../state.svelte";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";

  let open = $state(false);
  let root: HTMLDivElement;

  const current = $derived(app.model ? app.probes[`${app.profileId}/${app.model.id}`] : undefined);
  const status = $derived(!app.model ? "bad" : app.turnNote ? "warn" : probeDot(current));

  function describe(probe: (typeof app.probes)[string] | undefined): string {
    if (!probe) return zh.probeUnknown;
    return probe.latency_ms != null && probe.state === "ok" ? `${probe.message} · ${probe.latency_ms} ms` : probe.message;
  }

  function toggle() {
    open = !open;
    if (open) probeAll();
  }

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
  <button type="button" class="pa-picker-btn" disabled={app.busy} aria-haspopup="listbox" aria-expanded={open} title={app.profile ? `${app.profile.name} / ${app.model?.id} · ${app.turnNote || describe(current)}` : zh.noProfile} onclick={toggle}>
    <span class="pa-dot pa-dot-{status}" class:pa-pulse={!!app.turnNote}></span>
    <span class="pa-picker-label">{app.model?.id ?? zh.noModel}</span>
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
        </div>
        {#each profile.models as model (model.id)}
          {@const current = profile.id === app.profileId && model.id === app.model?.id}
          {@const probe = app.probes[`${profile.id}/${model.id}`]}
          <button type="button" class="pa-picker-item" class:pa-picker-current={current} role="option" aria-selected={current} onclick={() => pick(profile.id, model.id)}>
            <span class="pa-picker-check">{#if current}<Icon name="check" size={13} />{/if}</span>
            <span class="pa-picker-name">{model.id}</span>
            <span class="pa-dot pa-dot-{probeDot(probe)}" title={describe(probe)}></span>
            {#if model.vision}<span class="pa-picker-badge"><Icon name="photo" size={11} />{zh.visionShort}</span>{/if}
          </button>
        {/each}
      {/each}
    </div>
  {/if}
</div>
