<script lang="ts">
  import { api } from "../api";
  import { errorText } from "../agent/loop";
  import { refreshProfiles } from "../controller";
  import { app } from "../state.svelte";
  import { EFFORTS, type ModelEntry, type Profile } from "../types";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";

  type Form = { id: string | null; name: string; base_url: string; models: ModelEntry[]; api_key: string; clear_key: boolean; reasoning_effort: string; temperature: string; max_tokens: string; has_api_key: boolean };

  let form = $state<Form | null>(null);
  let models = $state<string[]>([]);
  let status = $state("");
  let civitaiKey = $state("");
  let newModel = $state("");

  function addModel(id = newModel.trim()) {
    if (!form || !id || form.models.some((m) => m.id === id)) return;
    form.models = [...form.models, { id, vision: false }];
    newModel = "";
  }

  function edit(profile: Profile | null) {
    status = "";
    models = [];
    form = profile
      ? { ...profile, models: profile.models.map((m) => ({ ...m })), api_key: "", clear_key: false, temperature: profile.temperature?.toString() ?? "", max_tokens: profile.max_tokens?.toString() ?? "" }
      : { id: null, name: "", base_url: "https://api.openai.com/v1", models: [], api_key: "", clear_key: false, reasoning_effort: "", temperature: "", max_tokens: "", has_api_key: false };
  }

  async function save() {
    if (!form) return;
    const body: Record<string, unknown> = {
      name: form.name,
      base_url: form.base_url,
      models: form.models,
      reasoning_effort: form.reasoning_effort,
      temperature: form.temperature === "" ? null : Number(form.temperature),
      max_tokens: form.max_tokens === "" ? null : Number(form.max_tokens),
    };
    if (form.api_key) body.api_key = form.api_key;
    else if (form.clear_key) body.api_key = "";
    try {
      const saved = await api.saveProfile(form.id, body);
      await refreshProfiles();
      form = { ...form, id: saved.id, api_key: "", clear_key: false, has_api_key: saved.has_api_key };
      status = zh.saved;
    } catch (error) {
      status = errorText(error);
    }
  }

  async function fetchModels() {
    if (!form?.id) return;
    status = "";
    try {
      models = (await api.listModels(form.id)).models;
      if (!models.length) status = "模型列表为空";
    } catch (error) {
      status = errorText(error);
    }
  }

  async function remove() {
    if (!form?.id || !confirm(zh.confirmDeleteProfile)) return;
    await api.deleteProfile(form.id);
    form = null;
    await refreshProfiles();
  }

  async function makeDefault(id: string) {
    await api.setDefaultProfile(id);
    await refreshProfiles();
  }

  async function saveCivitai(patch: Record<string, unknown>) {
    try {
      app.settings = await api.saveSettings(patch);
      civitaiKey = "";
    } catch (error) {
      status = errorText(error);
    }
  }
</script>

<div class="pa-settings">
  {#if app.importNote}<div class="pa-note">{app.importNote}</div>{/if}

  {#if form}
    <div class="pa-form">
      <label><span>{zh.profileName}</span><input class="pa-input" bind:value={form.name} maxlength="40" /></label>
      <label><span>{zh.baseUrl}</span><input class="pa-input" bind:value={form.base_url} placeholder="https://api.deepseek.com" /></label>
      <div class="pa-form-block">
        <span>{zh.models}</span>
        <div class="pa-models">
          {#each form.models as model, index (model.id)}
            <div class="pa-model-row">
              <span class="pa-picker-name">{model.id}</span>
              <label class="pa-check"><input type="checkbox" bind:checked={form.models[index].vision} />{zh.visionShort}</label>
              <button type="button" class="pa-icon-btn pa-sm" aria-label={zh.delete} onclick={() => form && (form.models = form.models.filter((m) => m.id !== model.id))}><Icon name="x" size={12} /></button>
            </div>
          {/each}
        </div>
        <div class="pa-inline">
          <input class="pa-input" bind:value={newModel} list="pa-model-list" placeholder={zh.modelPlaceholder} onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addModel())} />
          <button type="button" class="pa-text-btn" disabled={!newModel.trim()} onclick={() => addModel()}>{zh.addModel}</button>
          <button type="button" class="pa-text-btn" disabled={!form.id} title={form.id ? "" : "先保存再获取"} onclick={fetchModels}>{zh.fetchModels}</button>
        </div>
        <datalist id="pa-model-list">{#each models as model}<option value={model}></option>{/each}</datalist>
      </div>
      <label>
        <span>{zh.apiKey}</span>
        <input class="pa-input" type="password" autocomplete="off" bind:value={form.api_key} placeholder={form.has_api_key ? zh.apiKeySaved : ""} />
      </label>
      {#if form.has_api_key}
        <label class="pa-check"><input type="checkbox" bind:checked={form.clear_key} />{zh.apiKeyClear}</label>
      {/if}
      <div class="pa-grid">
        <label>
          <span>{zh.reasoning}</span>
          <select class="pa-input" bind:value={form.reasoning_effort}>
            <option value="">{zh.reasoningDefault}</option>{#each EFFORTS as effort}<option value={effort}>{effort}</option>{/each}
          </select>
        </label>
        <label><span>{zh.temperature}</span><input class="pa-input" bind:value={form.temperature} inputmode="decimal" /></label>
        <label><span>{zh.maxTokens}</span><input class="pa-input" bind:value={form.max_tokens} inputmode="numeric" /></label>
      </div>
      <div class="pa-form-actions">
        {#if form.id}<button type="button" class="pa-text-btn pa-danger" onclick={remove}><Icon name="trash" size={13} />{zh.delete}</button>{/if}
        <span class="pa-spacer"></span>
        {#if status}<span class="pa-status">{status}</span>{/if}
        <button type="button" class="pa-text-btn" onclick={() => (form = null)}>{zh.back}</button>
        <button type="button" class="pa-primary" onclick={save}>{zh.save}</button>
      </div>
    </div>
  {:else}
    <div class="pa-section-title">{zh.profiles}</div>
    <div class="pa-list">
      {#each app.profiles as profile (profile.id)}
        <div class="pa-list-row">
          <button type="button" class="pa-menu-main" onclick={() => edit(profile)}>
            <span class="pa-menu-title">{profile.name}</span>
            <span class="pa-menu-time">{profile.models.length} 个模型{profile.has_api_key ? "" : ` · ${zh.noKey}`}</span>
          </button>
          {#if profile.id === app.defaultProfileId}
            <span class="pa-tag">{zh.isDefault}</span>
          {:else}
            <button type="button" class="pa-text-btn" onclick={() => makeDefault(profile.id)}>{zh.setDefault}</button>
          {/if}
        </div>
      {/each}
    </div>
    <button type="button" class="pa-outline-chip" onclick={() => edit(null)}><Icon name="plus" size={14} />{zh.addProfile}</button>

    <div class="pa-section-title">{zh.civitai}</div>
    <label class="pa-check">
      <input type="checkbox" checked={app.settings.civitai_enabled} onchange={(e) => saveCivitai({ civitai_enabled: e.currentTarget.checked })} />
      {zh.civitaiEnabled}
    </label>
    <label class="pa-form">
      <span>{zh.civitaiKey}</span>
      <div class="pa-inline">
        <input class="pa-input" type="password" autocomplete="off" bind:value={civitaiKey} placeholder={app.settings.has_civitai_key ? zh.apiKeySaved : ""} />
        <button type="button" class="pa-text-btn" disabled={!civitaiKey} onclick={() => saveCivitai({ civitai_api_key: civitaiKey })}>{zh.save}</button>
      </div>
    </label>
    {#if status}<div class="pa-status">{status}</div>{/if}
  {/if}
</div>
