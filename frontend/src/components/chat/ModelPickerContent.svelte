<script lang="ts">
  import { Check, ChevronDown, Clock3, GripVertical, Plus, Search, Sparkles, Star } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import type { Profile } from "../../contracts";
  import { supportsAgentChat } from "../../providers/profile-capabilities";
  import { useI18nStore } from "../../stores/i18n";
  import { useProfileStore } from "../../stores/profiles";
  import { useUiStore } from "../../stores/ui";

  let {
    favoriteIds,
    recentIds,
    ontogglefavorite,
    onselectprofile,
  }: {
    favoriteIds: string[];
    recentIds: string[];
    ontogglefavorite: (profileId: string) => void;
    onselectprofile: (profileId: string) => void;
  } = $props();

  let search = $state("");

  const enabledProfiles = $derived($useProfileStore.profiles.filter((profile) => profile.enabled));
  const filteredProfiles = $derived(enabledProfiles.filter((profile) => matches(profile, search)));
  const favoriteProfiles = $derived(filteredProfiles.filter((profile) => favoriteIds.includes(profile.id)));
  const recentProfiles = $derived(filteredProfiles.filter((profile) => recentIds.includes(profile.id) && !favoriteIds.includes(profile.id)));
  const providerGroups = $derived.by(() => {
    const groups = new Map<string, Profile[]>();
    for (const profile of filteredProfiles.filter((item) => !favoriteIds.includes(item.id) && !recentIds.includes(item.id))) {
      const provider = providerLabel(profile);
      groups.set(provider, [...(groups.get(provider) ?? []), profile]);
    }
    return [...groups.entries()];
  });

  function t(key: string, fallback: string): string {
    const translated = $useI18nStore.t(key);
    return translated === key ? fallback : translated;
  }

  function tf(key: string, fallback: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      t(key, fallback),
    );
  }

  function matches(profile: Profile, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    return !normalized || `${profile.displayName} ${profile.modelId} ${providerLabel(profile)}`.toLowerCase().includes(normalized);
  }

  function providerLabel(profile: Profile): string {
    if (profile.modelInfo.providerId) return profile.modelInfo.providerId.toUpperCase();
    try {
      return new URL(profile.endpoint).hostname.split(".")[0]?.toUpperCase() || "CUSTOM";
    } catch {
      return "CUSTOM";
    }
  }

  function contextLabel(profile: Profile): string {
    const limit = profile.modelInfo.contextLimit;
    if (!limit) return t("model_picker.remote", "Remote");
    if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(1)}m ctx`;
    if (limit >= 1_000) return `${Math.round(limit / 1_000)}k ctx`;
    return `${limit} ctx`;
  }

  function openProfiles(): void {
    $useUiStore.setProfileSettingsOpen(true);
    $useUiStore.bringToFront("profiles");
  }
</script>

<div class="pa-model-picker-popover-inner">
  <button type="button" class="pa-model-picker-add" onclick={openProfiles}><Plus size={15} /> {t("model_picker.add_provider", "Add provider")}</button>
  <label class="pa-model-picker-search">
    <Search size={16} aria-hidden="true" />
    <Input bind:value={search} placeholder={t("model_picker.search", "Search models")} aria-label={t("model_picker.search", "Search models")} />
  </label>

  {#if favoriteProfiles.length}
    <section class="pa-model-picker-section">
      <div class="pa-model-picker-section-heading"><span><Star size={15} /> {t("model_picker.favorites", "Favorites")}</span></div>
      <div class="pa-model-picker-list" role="listbox" aria-label={t("model_picker.favorite_models", "Favorite models")}>
        {#each favoriteProfiles as profile (profile.id)}{@render modelRow(profile)}{/each}
      </div>
    </section>
  {/if}

  {#if recentProfiles.length}
    <section class="pa-model-picker-section">
      <div class="pa-model-picker-section-heading"><span><Clock3 size={15} /> {t("model_picker.recent", "Recent")}</span></div>
      <div class="pa-model-picker-list" role="listbox" aria-label={t("model_picker.recent_models", "Recent models")}>
        {#each recentProfiles as profile (profile.id)}{@render modelRow(profile)}{/each}
      </div>
    </section>
  {/if}

  {#if providerGroups.length}
    {#each providerGroups as [provider, profiles] (provider)}
      <section class="pa-model-picker-section">
        <div class="pa-model-picker-section-heading"><span class="pa-model-picker-provider"><i>{provider.slice(0, 1)}</i>{provider}</span></div>
        <div class="pa-model-picker-list" role="listbox" aria-label={tf("model_picker.provider_models", "{provider} models", { provider })}>
          {#each profiles as profile (profile.id)}{@render modelRow(profile)}{/each}
        </div>
      </section>
    {/each}
  {:else if !favoriteProfiles.length && !recentProfiles.length}
    <p class="pa-model-picker-empty">{t("model_picker.empty", "No models match this search.")}</p>
  {/if}
</div>

{#snippet modelRow(profile: Profile)}
  <div class:is-active={profile.id === $useProfileStore.activeProfileId} class="pa-model-picker-row" role="option" aria-selected={profile.id === $useProfileStore.activeProfileId}>
    <button type="button" class="pa-model-picker-row-main" disabled={!supportsAgentChat(profile)} onclick={() => onselectprofile(profile.id)}>
      <GripVertical size={14} class="pa-model-picker-grip" aria-hidden="true" />
      <Sparkles size={15} aria-hidden="true" />
      <span class="pa-model-picker-row-copy"><strong>{profile.displayName}</strong><small>{supportsAgentChat(profile) ? contextLabel(profile) : t("model_picker.agent_unavailable", "Agent chat unavailable")}</small></span>
    </button>
    <button type="button" class:is-favorite={favoriteIds.includes(profile.id)} class="pa-model-picker-star" aria-label={tf(favoriteIds.includes(profile.id) ? "model_picker.remove_favorite" : "model_picker.add_favorite", favoriteIds.includes(profile.id) ? "Remove {name} favorite" : "Add {name} favorite", { name: profile.displayName })} onclick={(event) => { event.stopPropagation(); ontogglefavorite(profile.id); }}>
      {#if profile.id === $useProfileStore.activeProfileId}<Check size={15} class="pa-model-picker-check" aria-hidden="true" />{/if}
      <Star size={16} fill={favoriteIds.includes(profile.id) ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  </div>
{/snippet}
