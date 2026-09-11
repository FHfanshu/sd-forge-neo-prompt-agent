# Experience Baseline (PRD Step 1)

Baseline evidence for the "前端体验与按需信息工具 PRD" (v1.0, 2026-09-11).
Read alongside `Forge-Prompt-Agent-PRD-v1.md`, `ROADMAP.md`, and `AGENTS.md`.
This document is discovery only; it changes no product behavior.

## 1. Forge host baseline

- Host: SD WebUI Forge Neo at `D:\AI\sd-webui-forge-neo`.
  Commit `e9c2847171c622cbcc8cef6b8ec90251f57c595a`
  (tag `2.27-22-ge9c28471`, 2026-07-21).
- Per-image completion hook (verified):
  - `modules/images.py:780` calls
    `script_callbacks.image_saved_callback(params)` at the end of `save_image`.
  - `modules/images.py:717` also calls `before_image_saved_callback(params)`
    before the file is written.
  - Callback payload `ImageSaveParams` (`modules/script_callbacks.py:18`):
    `image` (PIL image), `p` (processing params), `filename` (path the image
    is saved to), `pnginfo` (dict; key `parameters` holds the infotext string).
  - Register from Python with
    `script_callbacks.on_image_saved(callback, name="...")`.
- Metadata parsing interfaces (verified):
  - `modules/images.py:804` `read_info_from_image(image: PIL.Image) ->
    (geninfo: str | None, items: dict)` reads standard PNG `parameters`/EXIF
    first, then stealth metadata.
  - `modules/infotext_utils.py:356`
    `parse_generation_parameters(x: str, skip_fields=None) -> dict` turns the
    infotext string into named parameters (steps, sampler, CFG, seed, size,
    checkpoint, ...).
- Implication: `list_recent_generations` can index `filename` + `p.batch_index`
  from `on_image_saved`; `read_pnginfo` can parse the original file with
  `read_info_from_image` + `parse_generation_parameters` without re-decoding
  the visual copy used by the model. Pre-existing outputs saved before startup
  are not indexed (matches the PRD P0 scope).

## 2. Settings field inventory

Authoritative profile shape: `frontend/src/profile-adapter.ts` (`Profile` in
`frontend/src/contracts.ts`). UI: `frontend/src/components/ProfileSettings.svelte`
(346 lines; tabs `model`/`connection`/`generation`/`local`/`routes`) plus
`settings/Field.svelte`, `CommitInput.svelte`, `CommitTextarea.svelte`,
`ToggleField.svelte`, `RouteField.svelte`, `SectionHeading.svelte`.

Defaults (`profile-adapter.ts`):
- capabilities: all `true`.
- parameters: temperature `0.25`, topP `0.9`, maxTokens `8192`,
  reasoningEffort `low`, timeout `180`, sanitizeSensitive `true`.
- modelInfo: source/providerId/matchedModelId/syncedAt empty,
  contextLimit `0`, outputLimit `0`, temperatureSupported `true`,
  reasoningToggle `false`, reasoningEfforts `[]`.
- seeds: `gemini` (enabled, gemini-native, remote-http), `openai-compatible`
  (disabled, vision false). Built-in preset `deepseek-v4.1-flash`.
- state: `activeProfileId`.

Save behavior (must be preserved, not simplified):
- Field edits autosave: `update(patch)` -> `$useProfileStore.updateProfile`
  (local state + remote PATCH) and set a status string.
- The header **Save** button flushes API-key drafts and local-path drafts via
  `updateRemoteProfile`, then re-submits the whole visible profile as an
  ordering barrier, re-reads `listProfiles`, and reports saved/failed.
- API key and local paths are held in local drafts until **Save** (secrets never
  persist in browser state).
- `testConnection` and `syncModel` are separate actions with their own busy
  state, timeout, and status text.
- No stale-response overwrite when switching profiles quickly is already the
  intent of the ordering barrier.

Migration table (current -> target IA §5.2). "On-demand" = collapsed behind an
expand action; "Default" = visible in the section's summary view.

| Current field / control | Default | Provider applicability | Save path | Target section | Disclosure |
| --- | --- | --- | --- | --- | --- |
| `displayName` | "Model profile" | all | autosave | 连接与模型 | Default (config name) |
| `enabled` | true (preset) | all | autosave | 连接与模型 | Default (status) |
| `runtime` + `protocol` (connection type select) | remote-http / openai-chat-completions | all | autosave | 连接与模型 | Default |
| `endpoint` | seed | remote-http | autosave | 连接与模型 | Default (address) |
| `hasApiKey` + API key draft | false | remote-http | draft + Save | 连接与模型 | Default (credential status) |
| `modelId` | "model" | all | autosave | 连接与模型 | Default (model select) |
| test connection action | - | all | action | 连接与模型 | Default |
| `fallbackEndpoints` | [] | remote-http | autosave | 连接与模型 | On-demand |
| `capabilities.*` tools/vision/streaming | true | all | autosave | 连接与模型 | Default (short toggles) |
| `capabilities.*` attachments/systemPrompt/usage/abort | true | all | autosave | 高级 | On-demand (capability overrides) |
| `parameters.reasoningEffort` | low | reasoning capable | autosave | 回复偏好 | Default |
| `parameters.maxTokens` | 8192 | all | autosave | 回复偏好 | Default (output cap) |
| `parameters.temperature` | 0.25 | remote (temperatureSupported) | autosave | 回复偏好 | On-demand |
| `parameters.topP` | 0.9 | remote | autosave | 回复偏好 | On-demand |
| `parameters.timeout` | 180 | all | autosave | 高级 | On-demand |
| `parameters.sanitizeSensitive` | true | all | autosave | 高级 | On-demand |
| routes: active profile | seed | all | autosave | 高级 | On-demand |
| `modelInfo.*` (source/limits/efforts) | see defaults | all | sync + autosave | 高级 | On-demand (summary) |
| agentGeneration toggle | on | UI pref (`useUiStore`) | local pref | 高级 | On-demand |
| language, reset layouts, restore defaults | - | UI pref | local pref | 高级 | On-demand |

Local-model fields were removed with the llama.cpp runtime; every remaining
field is preserved. `modelInfo.temperatureSupported` continues to gate the
temperature control; `modelInfo.reasoningEfforts`/`reasoningToggle` continue to
drive the reasoning scale.

## 3. Image source map

Three distinct sources, each with a different identity and metadata story.

1. User attachment (browser upload)
   - `frontend/src/attachments.ts`: `createImageAttachment(file, id)` validates
     (`MAX_SOURCE_IMAGE_BYTES` 24MiB) then calls `optimizedBlob(file)`, which
     decodes, downscales to `MAX_IMAGE_EDGE` 1536, and re-encodes to
     **WebP** (quality 0.88) whenever the image is large or >2MiB.
   - The optimized `Blob` becomes the attachment; the original `File` is
     discarded. `materializeImageAttachment` later sends a data URL to the
     provider.
   - Metadata gap: PNGInfo lives in the original PNG chunks; WebP/canvas
     re-encode destroys it. PNGInfo must be extracted from the original bytes
     (or a labeled host snapshot) **before** `optimizedBlob`. This is exactly
     PRD IMG-01.
   - No stable image identity beyond the client-generated `attachmentId`.

2. Agent `generate_image` tool (browser DOM driven)
   - `javascript/prompt_agent_03_generate_image.js`: clicks
     `#{target}_generate`, polls `#{target}_gallery img` for a src not in the
     "before" set, then `fetch(src)` -> canvas downscale to <=1024 ->
     `toDataURL("image/jpeg", 0.85)`.
   - Returns `{ ok, target, duration_ms, image_mime_type: "image/jpeg",
     image_base64 }`. No `image_id`, no `batch_index`, no generation-parameter
     mapping, no grid distinction. Success evidence is "first new `img.src`",
     which the PRD §12 flags as insufficient.
   - The returned JPEG is what the model sees, so any metadata read from it is
     already gone; provenance must come from the original file / `on_image_saved`.
   - `forgeSkillHint()` (same file) reads `#forge_ui_preset` and
     `#setting_sd_model_checkpoint` to recommend a skill; it is a hint only.

3. Host saved output (Forge output dir)
   - `modules/images.py` `save_image` writes the original PNG (with PNGInfo) and
     fires `image_saved_callback(params)` per saved image, with `filename`,
     `p`, and `pnginfo["parameters"]`.
   - This is the authoritative, metadata-bearing source. A batch produces one
     callback per image; grids are separate saved images. `p` exposes
     `batch_index`/seeds and the generation-time parameters, which lets each
     image map to its own parameter snapshot (PRD IMG-03/IMG-04).
   - No index exists today; nothing consumes this hook in the extension.

## 4. Baseline gaps carried into implementation

- `createImageAttachment` loses PNGInfo (needs pre-transcode extraction).
- `generate_image` has no stable image identity, batch mapping, or params.
- No completion-record index and no on-demand image read tool.
- Settings are functional but flat (all sections equal weight, no progressive
  disclosure); this is the step-2 target.
- Style preset identity is the display name today (PRD §7 rename handling).
