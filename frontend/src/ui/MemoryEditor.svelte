<script lang="ts">
  import { api } from "../api";
  import { errorText } from "../agent/loop";
  import { zh } from "../zh";

  let text = $state("");
  let saved = $state("");
  let path = $state("");
  let maxChars = $state(8000);
  let status = $state("");

  async function load() {
    try {
      const memory = await api.memory();
      text = saved = memory.text;
      path = memory.path;
      maxChars = memory.max_chars;
      status = "";
    } catch (error) {
      status = errorText(error);
    }
  }

  async function save() {
    try {
      await api.saveMemory(text);
      saved = text;
      status = zh.saved;
    } catch (error) {
      status = errorText(error);
    }
  }

  $effect(() => {
    load();
  });
</script>

<div class="pa-section-title">{zh.memory}</div>
<div class="pa-note">{zh.memoryHint}</div>
<textarea class="pa-input pa-memory" bind:value={text} spellcheck="false" placeholder={zh.memoryEmpty}></textarea>
<div class="pa-inline">
  <span class="pa-hint" title={path}>{text.length} / {maxChars}</span>
  <span class="pa-spacer"></span>
  {#if status}<span class="pa-status">{status}</span>{/if}
  <button type="button" class="pa-text-btn" onclick={load}>{zh.memoryReload}</button>
  <button type="button" class="pa-primary" disabled={text === saved || text.length > maxChars} onclick={save}>{zh.save}</button>
</div>
