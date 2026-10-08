<script lang="ts">
  import { onPanelFocus, openSession } from "../controller";
  import { app, savePanel } from "../state.svelte";
  import { zh } from "../zh";
  import Composer from "./Composer.svelte";
  import Icon from "./Icon.svelte";
  import MessageList from "./MessageList.svelte";
  import SessionMenu from "./SessionMenu.svelte";
  import Settings from "./Settings.svelte";

  const RAIL = 28;
  let viewport = $state(window.innerWidth);
  // height covered by an on-screen keyboard; iPad Safari does not shrink the layout viewport for it
  let keyboard = $state(0);

  $effect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    // pinch zoom also shrinks the visual viewport; only an unzoomed shrink is a keyboard
    const update = () => (keyboard = Math.abs(visual.scale - 1) > 0.01 ? 0 : Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop)));
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  });
  let menuOpen = $state(false);
  let dragging = $state(false);
  let noticeTimer = 0;
  let dark = $state(document.body.classList.contains("dark"));

  // follow Gradio's light/dark switch (it toggles the "dark" class on <body>)
  $effect(() => {
    const observer = new MutationObserver(() => (dark = document.body.classList.contains("dark")));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  });

  const overlay = $derived(app.panel.mode === "overlay" || viewport < 900);
  const width = $derived(app.panel.open ? Math.min(app.panel.width, Math.max(320, viewport - 40)) : RAIL);

  // squeeze mode: narrow Forge's <gradio-app> (its width is pinned to the viewport, so body padding
  // would only add horizontal scroll); restore on teardown
  $effect(() => {
    const host = document.querySelector<HTMLElement>("gradio-app") ?? document.body;
    const original = { width: host.style.width, maxWidth: host.style.maxWidth };
    if (!overlay) {
      host.style.width = `calc(100% - ${width}px)`;
      host.style.maxWidth = `calc(100% - ${width}px)`;
    }
    return () => {
      host.style.width = original.width;
      host.style.maxWidth = original.maxWidth;
    };
  });

  $effect(() => {
    if (!app.notice) return;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (app.notice = ""), 4000);
  });

  function update(patch: Partial<typeof app.panel>) {
    app.panel = { ...app.panel, ...patch };
    savePanel(app.panel);
  }

  function startResize(event: PointerEvent) {
    if (!app.panel.open) return;
    event.preventDefault();
    dragging = true;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    let next = app.panel.width;
    const move = (e: PointerEvent) => {
      next = Math.min(720, Math.max(320, window.innerWidth - e.clientX));
      app.panel.width = next;
    };
    const up = () => {
      dragging = false;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      update({ width: next });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  function onWindowClick(event: MouseEvent) {
    if (menuOpen && !(event.target as HTMLElement).closest(".pa-menu, .pa-title-btn")) menuOpen = false;
  }
</script>

<svelte:window onresize={() => (viewport = window.innerWidth)} onclick={onWindowClick} />

<aside class="pa-root" class:pa-light={!dark} class:pa-overlay={overlay} class:pa-dragging={dragging} style:width="{width}px" style:bottom="{keyboard}px" onfocusin={onPanelFocus}>
  {#if !app.panel.open}
    <button type="button" class="pa-rail" title={zh.expand} aria-label={zh.expand} onclick={() => update({ open: true })}>
      <Icon name="message" />
      {#if app.busy}<span class="pa-rail-dot"></span>{/if}
    </button>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pa-resize" onpointerdown={startResize}></div>
    <header class="pa-header">
      {#if app.view === "settings"}
        <button type="button" class="pa-icon-btn" aria-label={zh.back} onclick={() => (app.view = "chat")}><Icon name="chevron-left" /></button>
        <span class="pa-title">{zh.settings}</span>
      {:else}
        <button type="button" class="pa-title-btn" onclick={() => (menuOpen = !menuOpen)}>
          <span class="pa-title">{app.session?.title || zh.newSession}</span><Icon name="chevron-down" size={14} />
        </button>
      {/if}
      <span class="pa-spacer"></span>
      {#if app.view === "chat"}
        <button type="button" class="pa-icon-btn" title={zh.newSession} aria-label={zh.newSession} disabled={app.busy} onclick={() => openSession(null)}><Icon name="plus" /></button>
      {/if}
      <button type="button" class="pa-icon-btn" title={overlay ? zh.modeOverlay : zh.modeSqueeze} aria-label={overlay ? zh.modeOverlay : zh.modeSqueeze}
        onclick={() => update({ mode: app.panel.mode === "overlay" ? "squeeze" : "overlay" })}>
        <Icon name={overlay ? "layers" : "sidebar"} />
      </button>
      {#if app.view === "chat"}
        <button type="button" class="pa-icon-btn" title={zh.settings} aria-label={zh.settings} onclick={() => (app.view = "settings")}><Icon name="settings" /></button>
      {/if}
      <button type="button" class="pa-icon-btn" title={zh.collapse} aria-label={zh.collapse} onclick={() => update({ open: false })}><Icon name="chevron-right" /></button>
    </header>
    {#if menuOpen && app.view === "chat"}<SessionMenu close={() => (menuOpen = false)} />{/if}

    {#if app.view === "settings"}
      <Settings />
    {:else}
      <MessageList />
      <Composer />
    {/if}
    {#if app.notice}<div class="pa-notice" role="status">{app.notice}</div>{/if}
  {/if}
</aside>
