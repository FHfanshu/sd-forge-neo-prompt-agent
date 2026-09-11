<script lang="ts">
  import { onMount } from "svelte";
  import { ChevronDown, Sparkles } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { floatingPopover } from "../floating-popover";
  import { supportsAgentChat } from "../providers/profile-capabilities";
  import { useI18nStore } from "../stores/i18n";
  import { useProfileStore } from "../stores/profiles";
  import {
    LEGACY_STORAGE_KEYS,
    PROMPT_AGENT_STORAGE_KEYS,
    readMigratedStorageValue,
    writePromptAgentStorageValue,
  } from "../storage-migrations";
  import ModelPickerContent from "./chat/ModelPickerContent.svelte";

  const FAVORITES_KEY = PROMPT_AGENT_STORAGE_KEYS.modelPickerFavorites;
  const RECENTS_KEY = PROMPT_AGENT_STORAGE_KEYS.modelPickerRecents;

  let open = $state(false);
  let anchor = $state<HTMLDivElement>();
  let popover = $state<HTMLDivElement>();
  let favoriteIds = $state<string[]>([]);
  let recentIds = $state<string[]>([]);

  const activeProfile = $derived($useProfileStore.profiles.find((profile) => profile.id === $useProfileStore.activeProfileId));
  const enabledProfiles = $derived($useProfileStore.profiles.filter((profile) => profile.enabled));

  function t(key: string, fallback: string): string {
    const translated = $useI18nStore.t(key);
    return translated === key ? fallback : translated;
  }

  function legacyKeyFor(key: string): string {
    return key === FAVORITES_KEY ? LEGACY_STORAGE_KEYS.modelPickerFavorites : LEGACY_STORAGE_KEYS.modelPickerRecents;
  }

  function readIds(key: string): string[] {
    try {
      const value = JSON.parse(readMigratedStorageValue(localStorage, key, legacyKeyFor(key)) ?? "[]");
      return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveIds(key: string, values: string[]): void {
    try { writePromptAgentStorageValue(localStorage, key, legacyKeyFor(key), JSON.stringify(values)); } catch { /* Storage can be unavailable in private contexts. */ }
  }

  function toggleFavorite(profileId: string): void {
    favoriteIds = favoriteIds.includes(profileId)
      ? favoriteIds.filter((id) => id !== profileId)
      : [...favoriteIds, profileId];
    saveIds(FAVORITES_KEY, favoriteIds);
  }

  function selectProfile(profileId: string): void {
    const profile = enabledProfiles.find((item) => item.id === profileId);
    if (!profile || !supportsAgentChat(profile)) return;
    $useProfileStore.activateProfile(profileId);
    recentIds = [profileId, ...recentIds.filter((id) => id !== profileId)].slice(0, 8);
    saveIds(RECENTS_KEY, recentIds);
    open = false;
  }

  onMount(() => {
    const available = new Set(enabledProfiles.map((profile) => profile.id));
    favoriteIds = readIds(FAVORITES_KEY).filter((id) => available.has(id));
    recentIds = readIds(RECENTS_KEY).filter((id) => available.has(id));
    if (!favoriteIds.length && activeProfile) favoriteIds = [activeProfile.id];

    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor && !anchor.contains(target) && !popover?.contains(target)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  });
</script>

<div class="pa-model-picker" bind:this={anchor}>
  <Button
    variant="ghost"
    class="pa-model-picker-trigger pa-h-8 pa-max-w-44 pa-rounded-md pa-px-1.5"
    aria-label={t("model_picker.active", "Active model")}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => open = !open}
  >
    <Sparkles size={15} />
    <span>{activeProfile?.displayName ?? t("model_picker.select", "Select model")}</span>
    <ChevronDown size={13} aria-hidden="true" />
  </Button>

  {#if open}
    <div bind:this={popover} use:floatingPopover={() => anchor} class="pa-model-picker-popover" role="dialog" tabindex="-1" aria-label={t("model_picker.select", "Select model")}>
      <ModelPickerContent
        {favoriteIds}
        {recentIds}
        ontogglefavorite={toggleFavorite}
        onselectprofile={selectProfile}
      />
    </div>
  {/if}
</div>
