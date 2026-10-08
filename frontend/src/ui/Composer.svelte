<script lang="ts">
  import { api } from "../api";
  import { addAttachment, attachLatestOutput, removeDraft, send, stop } from "../controller";
  import { app } from "../state.svelte";
  import { zh } from "../zh";
  import Icon from "./Icon.svelte";
  import EffortPicker from "./EffortPicker.svelte";
  import ModelPicker from "./ModelPicker.svelte";

  let text = $state("");
  let textarea: HTMLTextAreaElement;
  let fileInput: HTMLInputElement;
  let composing = false;

  function resize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 8 * 20 + 12) + "px";
  }

  async function submit() {
    if (app.busy) {
      stop();
      return;
    }
    const value = text;
    text = "";
    queueMicrotask(resize);
    if (!(await send(value))) text = value;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !composing && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function addFiles(files: FileList | File[] | null | undefined) {
    for (const file of Array.from(files ?? [])) {
      if (file.type.startsWith("image/")) void addAttachment(file);
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.items ?? [])].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean) as File[];
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  }
</script>

<div class="pa-composer">
  {#if app.drafts.length}
    <div class="pa-drafts">
      {#each app.drafts as draft (draft.id)}
        <div class="pa-draft">
          <img src={api.modelImageUrl(draft.id)} alt="" />
          <button type="button" class="pa-draft-x" aria-label={zh.delete} onclick={() => removeDraft(draft.id)}><Icon name="x" size={11} /></button>
        </div>
      {/each}
    </div>
  {/if}
  <textarea
    bind:this={textarea}
    bind:value={text}
    rows="1"
    placeholder={zh.placeholder}
    title={zh.hint}
    oninput={resize}
    onkeydown={onKeydown}
    onpaste={onPaste}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => (composing = false)}
  ></textarea>
  <div class="pa-composer-row">
    <button type="button" class="pa-icon-btn" title={zh.attach} aria-label={zh.attach} onclick={() => fileInput.click()}><Icon name="paperclip" /></button>
    <button type="button" class="pa-outline-chip" onclick={() => attachLatestOutput()}><Icon name="photo" size={14} />{zh.latestOutput}</button>
    <span class="pa-spacer"></span>
    {#if app.turnNote}<span class="pa-hint">{app.turnNote}</span>{/if}
    <ModelPicker />
    <EffortPicker />
    <button type="button" class="pa-send" aria-label={app.busy ? zh.stop : zh.send} title={app.busy ? zh.stop : zh.send} onclick={submit}>
      <Icon name={app.busy ? "stop" : "arrow-up"} size={15} />
    </button>
  </div>
  <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onchange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
</div>
