# Active Audit Log

## 2026-09-12 Sunset/Harvest: generation-skills, danbooru-tools, character-definitions
- Goal: execute the Sunset/Harvest PRD. The extension enters maintenance-end;
  the long-lived assets (generation skills, Danbooru tools, minimal character
  definitions) are extracted and generalized; ComfyTV becomes the production
  workspace.
- Harvest sources: `prompt_agent/prompt_skills.py` (Anima DiT guide, Forge
  Couple guide, Krea 2 guide), `docs/DANBOORU_TAGS_AGENT.md`,
  `docs/PROMPT_TOOLKIT_DESIGN.md` (pool/sort/dedup methodology), the agent
  system prompt's NL/style-transfer rules, the Sunset/Harvest PRD's OC
  methodology and failure cases, and `prompt_agent/danbooru.py`.
- Added `generation-skills/`: eight skills with progressive disclosure
  (`SKILL.md` + `references/`): anima-image-generation, anime-image-generation,
  anime-oc-design, anthro-oc-design, character-reference-sheet,
  character-consistency, image-generation-debugging, danbooru-prompting.
  Forge/UI/runtime assumptions removed: the "256 tokens absolute ceiling"
  Anima rule was intentionally deleted per the PRD (current Anima builds
  expose about 512 token positions; length discipline is now prune-not-cap),
  tool names now point at `danbooru-tools`, and the Krea 2 guide is kept as a
  model-grammar reference under anime-image-generation.
- Added `danbooru-tools/`: the harvested stdlib-only Danbooru client
  (`danbooru_tools/client.py`, function names preserved from the original
  implementation), plus new `lookup_danbooru_aliases` /
  `lookup_danbooru_implications` following the same conventions, a JSON CLI
  (`python -m danbooru_tools ...`) so any runtime can call the tools via
  shell, and 13 offline unit tests.
- Added `character-definitions/`: the minimal four-field schema
  (name, reference_images, trigger_words, short_description), asset tag
  conventions, the explicit no-LoRA-fields policy, and the first entry
  (Xiuran).
- Verification: `python -m unittest discover -s tests` inside
  `danbooru-tools/` 13/13 OK; live smoke tests against the real Danbooru API
  passed (search-tags "blue hair", implications "dragon",
  inspect-wikis "tag_group:attire" with bounded 12k body + 80 references);
  `python tools/test_gate.py fast` exit 0 with the new directories present.
- Housekeeping: entries 2026-08-04 through 2026-09-04 moved to
  `docs/archive/audit-archive-2026-08-to-09.md` (registered in
  `tests/test_architecture.py` HISTORICAL_FILES) to keep this file under the
  1000-line limit; README now carries the maintenance-ended notice pointing
  at the successors and ComfyTV.

## 2026-09-11 Session Sync Lost `this` Binding (Always-Failing Cross-Device Sync)
- Reported symptom: a multi-hour stretch of apparent non-stop agent activity after
  returning to the WebUI tab; asked to find where the frontend listens for
  visibility/focus and re-initiates generation, then stop the repeat.
- Finding (the asked-for answer): no `visibilitychange` / `document.hidden` /
  `visibilityState` / `pageshow` / `pagehide` handler exists in this extension or
  in Forge Neo's built JS; the only focus handlers (`Surface.svelte`,
  `ProfileSettings.svelte`) recompute viewport geometry only. No client or backend
  path re-initiates a model request on focus/visibility. All client loops are
  bounded (`generate_image` polls cap at 5 min; proxy retries exclude HTTP 400 and
  are attempt-bounded) and the backend `stream_profile` is a single `async for`
  over `httpx` with a mandatory positive timeout.
- Concrete defect found while auditing: session sync always failed.
  `PromptAgentController.syncSessionsBestEffort` detached the repository method
  (`const syncWithServer = this.sessions.syncWithServer;`) and called it with
  `this === undefined`, so `synchronizePromptAgentSessions` ran on `undefined` and
  `store.getPreference(...)` threw `TypeError: Cannot read properties of undefined
  (reading 'getPreference')`; the browser logged `Prompt Agent session sync is
  temporarily unavailable` on every mount.
- Fix: bind the receiver (`this.sessions.syncWithServer?.bind(this.sessions)`),
  `frontend/src/agent/controller.ts`.
- Regression test: `frontend/tests/prompt-agent-controller.test.ts` "runs server
  sync with the repository as receiver instead of a detached method" (fails before,
  passes after). Existing sync tests could not catch it because the shared
  repository mock uses arrow-function `vi.fn` methods that never need a receiver.
- Verification: `python tools/test_gate.py fast` exit 0 (Svelte/type check 0 errors;
  139 frontend tests including 24 controller; 43 affected Python tests).
  `node --check javascript/prompt_agent*.js` all OK; bundle rebuilt.
- Residual/unproven: the multi-hour run is not explained by any loop in this code
  (no file/API writes during the window; the last server-persisted request ended in
  a provider HTTP 400). Most plausible remaining mechanism is a single provider
  request hanging with no client-side timeout; no timeout guard was added because it
  was not reproduced.

## 2026-09-11 Defer Markdown Parsing During Streaming
- Reported symptom: severe UI slowness while the agent streams a response.
- Evidence: a Chrome performance trace (`Trace-20260911T184932.json.gz`) attributed
  ~5.4% of the renderer main-thread JS samples to
  `javascript/prompt_agent_90_ui.js`; the hottest self function was
  `DOMPurify.parseFromString` reached from a Svelte `$derived` flush in the
  Markdown component.
- Root cause: `frontend/src/components/Markdown.svelte` read `html` before the
  `if (streaming || !markdownElement) return;` guard, forcing the lazy
  `$derived(DOMPurify.sanitize(marked.parse(content)))` to recompute on every
  streamed `content` update even though the streaming branch renders raw text —
  a repeated `marked.parse` + `DOMPurify.sanitize` per token.
- Fix: moved the `html;` read after the guard so the derivation stays lazy while
  streaming and runs once the final content is rendered. Svelte re-collects
  effect dependencies each run, so `streaming` flipping false re-runs the effect
  and the code-block enhancement still executes.
- Regression test: `frontend/tests/markdown-streaming.test.ts` spies on
  `DOMPurify.sanitize` and asserts 0 calls during streamed updates and 1 call at
  completion. Verified failing before the fix (sanitize called 3x) and passing
  after.
- Rebuilt `javascript/prompt_agent_90_ui.js` from frontend source.
- Verification: `node --check javascript/prompt_agent_90_ui.js` exit 0;
  `python tools/test_gate.py fast` exit 0 (138 frontend tests, Svelte/type check,
  affected Python tests).
- Scope: this fixes only the prompt-agent share of the trace. The same trace also
  attributes roughly 15% to Gradio assets (`Index-DkaKPSWq.js`,
  `Blocks-B7cNA3Pj.js`) and ~6.6% to the third-party `sd-webui-prompt-all-in-one`
  bundle, plus a ~440MB heap / 277ms MajorGC — all outside this repository.
- Residual risk: `ProcessDrawer` reasoning renders with
  `renderStreamingMarkdown={true}`, so its Markdown is still parsed per token
  while the drawer is open; left unchanged because that is an explicit feature.

## 2026-09-11 Runtime Persistence Coalescing and Context Meter Redesign
- Reported symptoms: the composer stayed on "Sending request" after the agent
  finished, and Stop showed "Cancelling" then froze.
- Root cause: the runtime subscriber called `queueRuntimePersistence` on every
  streaming emit (one per token), and `persistRuntimeState` rewrites the whole
  session with `Promise.all(records.map(putMessage))` while `repository.putMessage`
  opens and awaits a separate IndexedDB transaction per message. On a long session
  this produced hundreds of full-session rewrite batches per turn; `sendMessage`
  awaited the whole backlog in its teardown, so the composer stayed disabled long
  after completion. Stop could not recover because the runtime was already idle
  (`runtime.abort()` no-ops when not streaming), leaving the UI stuck on
  "cancelling".
- Changed `frontend/src/agent/controller.ts`: coalesce runtime persistence to the
  latest state and debounce intermediate writes (`RUNTIME_PERSIST_DEBOUNCE_MS` =
  400ms) via a drain loop, while terminal `completed`/`failed` states flush
  immediately; the debounce timer is cleared on destroy. The terminal write is
  still awaited inline in `sendMessage`.
- Single-session guarantee: `sendMessage` no longer awaits the whole persistence
  backlog in its teardown, so the composer always releases once the terminal batch
  is durable. Added an abort watchdog (`ABORT_WATCHDOG_MS` = 6s) armed when
  `stopRequest` aborts an active run: if the run never settles (for example a
  Forge tool that ignores the abort signal), it bumps a request generation, clears
  the active request to idle, and rebuilds the runtime from durable history so the
  user is never trapped on "cancelling". The abandoned send's teardown is
  generation-guarded so it cannot clobber a newer request.
- Changed `stopRequest` to always arm `stopRequested` (so a send still in
  preparation cancels) and to abort + show "cancelling" only when a run is active;
  otherwise it clears to idle so the composer cannot strand.
- Redesigned `frontend/src/components/ContextMeter.svelte` from a cramped
  conic-gradient badge (8px label in a 23px cut-out) to a crisper SVG donut
  (30px, 3px stroke, rounded progress arc, track, 9.5px tabular numeral, warning
  >=70% and critical >=90%). `role="meter"`, aria values, `title`,
  `data-prompt-agent-context-meter`, and the props API are preserved.
- Tests: added a streaming-persistence coalescing case, a post-turn
  stop-does-not-strand case, and a fake-timer force-recovery case for a stopped
  request that ignores the abort signal to
  `frontend/tests/prompt-agent-controller.test.ts`, and updated the runtime-write
  serialization case to the coalesced semantics (23/23).
- Verification: full gate exit 0 (68.6s): Python 2.6s, Svelte 0/0, frontend tests
  27.6s, build/budget, 7 mock-host browser acceptance, browser syntax. Bundle
  `javascript/prompt_agent_90_ui.js` rebuilt.

## 2026-09-11 Provider Tool-Result Image Ordering and Orphan Tool Calls
- Root cause of two consecutive provider HTTP 400s: the OpenAI-compatible and
  Gemini adapters appended a `role:"user"` image message immediately after each
  tool result. When one assistant turn issued multiple tool calls whose results
  carried images, the transcript became
  `assistant(tool_calls=[A,B]) -> tool(A) -> user(image) -> tool(B) -> user(image)`,
  and strict OpenAI-compatible endpoints reject a non-tool message while a
  `tool_call` is still unanswered. Historical completed turns already strip tool
  calls, so the same invalid active-turn batch was rebuilt and re-sent on the
  follow-up ("继续"), producing the second 400. A single image-bearing tool
  result is safe, which is why earlier single-result turns succeeded.
- Changed `backend/prompt_agent/provider_adapters/openai_compatible.py` to buffer
  images across consecutive tool results and emit one trailing `user` message
  after all `tool` messages; changed `gemini.py` to fold consecutive tool results
  into a single user turn (`functionResponse` + `inlineData`). Single-result and
  text-only behavior is unchanged.
- Hardened `frontend/src/agent/context-pruning.ts`: the active-turn projection
  now synthesizes an interrupted `toolResult` (`orphanToolResultPlaceholder`,
  `isError`) for any assistant `toolCall` without a matching result, so an
  interrupted run can never forward an unmatched `tool_calls` to the provider.
  Durable history may still contain the orphan; it is repaired on projection
  rather than rewritten on disk.
- Tests: `tests/test_prompt_agent_provider_adapters.py` batch-ordering and
  text-only cases (10/10); `frontend/tests/context-pruning.test.ts` failed-turn
  boundary and orphan-repair cases (8/8).
- Verification: full gate exit 0 (67.1s): Python 2.6s, Svelte 0/0, frontend
  tests 27.1s, build/budget, 7 mock-host browser acceptance, browser syntax.

## 2026-09-11 Fast Inner-Loop Test Gate
- Root cause: the developer inner loop paid for Playwright, build, and the full
  frontend vitest suite even when only a mapped test file changed.
- Added `python tools/test_gate.py fast` (preflight + affected Python + mapped
  or changed frontend vitest; svelte-check only for `frontend/src/**` or
  frontend type/config). `full`/`release` are unchanged. Test-only frontend
  diffs now run the changed test files plus mapped acceptance tests instead of
  the entire vitest suite; source/config still falls back to the full suite.
- Verification: `python -m unittest tests.test_test_gate` 15/15 OK (0.163s).
  `python tools/test_gate.py fast` exit 0 (35.3s): 43 Python, svelte-check 0/0,
  132 frontend across 10 mapped files; no build/bundle/e2e. `run_full()` left
  untouched. `affected` still uses mapped vitest plus Playwright.

Historical migration implementation remains available on branch `kt` and tag
`kt-final`. The concise archive index is in
`docs/archive/audit-archive-2026-07-19.md`; detailed working notes are
local-only under `docs/archive/`. Recent completed increments through the
Launcher recovery are in `docs/archive/audit-archive-2026-07-28-29.md`.
Entries from 2026-07-19 through 2026-07-30 moved to
`docs/archive/audit-archive-2026-07-19-to-30.md`, and entries from
2026-08-04 through 2026-09-04 moved to
`docs/archive/audit-archive-2026-08-to-09.md`, to keep this file under the
1000-line source limit.

## 2026-09-11 Built-in DeepSeek V4.1 Flash profile preset
- Added `PROFILE_PRESETS` in `frontend/src/profile-adapter.ts` and a preset
  dropdown on the profile "+" button in `ProfileSettings.svelte`. The preset
  seeds model `deepseek-v4.1-flash` at `https://api.deepseek.com` over the
  OpenAI chat-completions adapter, with reasoning and vision enabled, 32768
  max output tokens, `reasoning_effort=high`, and model info of 1M context /
  384K output. `openai_chat_url` already maps that endpoint to
  `/chat/completions`.
- Added `profiles.add.empty` to `prompt_agent/i18n.py`, regenerated
  `javascript/prompt_agent_90_ui.js` via `pnpm --dir frontend run build`, and
  added a `profile-adapter` regression test covering the preset.
- Verification: `python tools/test_gate.py affected` passed (exit 0).

## 2026-09-11 Faster delivery gate (pruned tree scan, threaded vitest, pinned-node reuse)
- The full gate only looked stalled: Vitest's TTY reporter increments the passed
  count as files drain, so the last few files sit at `[queued]` while it finishes.
  Timing every stage showed the real cost elsewhere. `source_files()` used
  `ROOT.rglob("*")` and filtered afterwards, enumerating `frontend/node_modules`
  once per architecture test (~27s for three tests alone), and each frontend/JS
  step paid a fresh `npx --yes --package node@22.17.0 ...` startup (~1.4s, 13x).
- `tools/test_gate.py`: resolve pinned Node 22.17.0 once and reuse it; check all
  `javascript/prompt_agent*.js` in a single process via `vm.Script` instead of one
  `npx node --check` per file; print per-stage seconds and a sorted summary.
- `tests/test_architecture.py`: `source_files()` now uses `os.walk` with directory
  pruning (never descends into `node_modules`, `.git`, `data`, ...) and caches the
  result, so the three tests share one scan.
- `frontend/vitest.config.ts`: `pool: "threads"` (identical isolation semantics;
  child-process fork startup dominated the suite).
- Verification: `python tools/test_gate.py full` passed (exit 0). Total stage time
  fell 126.7s -> 65.1s: Python tests 29.9s -> 2.5s, frontend tests 59.9s -> 26.2s,
  generated-script syntax ~10s of npx spawns -> 0.1s.

## 2026-09-11 Launcher off-screen recovery and info-level load logging
- Root cause: the floating launcher persisted `launcherPosition` in localStorage
  but was never clamped on load or on viewport change, so a position saved on a
  larger monitor or higher browser zoom could land fully off-screen and become
  unreachable. The extension also logged nothing on a healthy load, making a
  successful mount indistinguishable from a silent no-op.
- Changed `frontend/src/window-interactions.ts` to add `clampLauncherPosition`
  and use it while dragging, and `frontend/src/components/Surface.svelte` to
  clamp the stored launcher position on mount and on every viewport change.
- Added info-level load logging: `scripts/prompt_agent.py` logs extension load
  and API registration at INFO on the `prompt_agent` logger; the browser scripts
  log `[prompt-agent] Forge adapter ready`, `host bridge ready`, and `boot script
  loaded...`; `frontend/src/bootstrap.ts` logs `UI bundle ready` and `Svelte UI
  mounted`; boot failures log via `console.error`.
- Added a `window-interactions` regression for off-screen recovery and taught
  `tests/test_host_bridge.py` to ignore the new `[prompt-agent]` console lines
  when parsing host stdout; kept `javascript/prompt_agent.js` under the
  1000-line limit. Rebuilt `javascript/prompt_agent_90_ui.js` via
  `pnpm --dir frontend run build`.
- Verification: `python tools/test_gate.py full` passed (exit 0), total stage
  time 63.9s.

## 2026-09-11 Settings experience baseline and information architecture
- Goal: the profile editor was a flat five-tab form (Model / Connection /
  Generation / Local / Routes) that mixed common and rare fields and sized its
  columns from the browser width, so the common path was noisy and fragile.
- Baseline: `docs/EXPERIENCE_BASELINE.md` records the field migration table
  (every existing field mapped to a new section, nothing dropped), the Forge
  host version and completion/metadata hooks, and the image source map
  (attachments transcode to WebP before any metadata extraction; `generate_image`
  trusts the first new gallery image; the `on_image_saved` hook has no consumer).
- Changed `frontend/src/components/ProfileSettings.svelte` and added
  `frontend/src/components/settings/More.svelte`: the five tabs became four
  sections - Connection & model / Response preferences / Local runtime /
  Advanced - each showing its common fields with a `<details>` disclosure for
  on-demand fields; routes moved into Advanced; added an advanced summary line.
- Changed `frontend/src/styles.css`: `.pa-profile-tab-content` is now an
  inline-size container, single column under 560px via `@container`, with
  section/disclosure animations that fall back under `prefers-reduced-motion`.
- Added the new-IA keys to `prompt_agent/i18n.py` and the offline fallback table
  in `frontend/src/i18n/runtime.ts`; updated `frontend/tests/profile-settings.test.ts`
  and `frontend/tests/e2e/mock-host.spec.ts` to the new section labels.
- Verification: `python tools/test_gate.py affected` passed (exit 0, 46.9s);
  svelte-check reported 0 errors / 0 warnings; rebuilt
  `javascript/prompt_agent_90_ui.js` from the frontend sources.

## 2026-09-11 Unified window motion and reduced-motion
- Goal: the floating chat and settings windows appeared with no transition, so
  position and layer changes were hard to read; the PRD asks for one shared
  motion vocabulary instead of ad-hoc per-component animations.
- Added `frontend/src/motion.ts` with `windowIn` (fade + scale 0.98 -> 1, 180ms)
  and `windowOut` (fade, 120ms), both honoring `prefers-reduced-motion`, and
  applied them to `.pa-window` and `.pa-profile-window`.
- Added a fade to the history popover and disabled the window, section,
  disclosure, and popover animations under `prefers-reduced-motion`. No
  `transition: all` was introduced (none existed).
- Added an `Element.prototype.animate` polyfill to `frontend/tests/setup.ts`
  because Svelte 5 runs `css` transitions through WAAPI, which jsdom lacks
  (41 `element.animate is not a function` failures before the polyfill).
- Verification: `python tools/test_gate.py affected` passed (exit 0, 49.6s);
  svelte-check reported 0 errors / 0 warnings; rebuilt
  `javascript/prompt_agent_90_ui.js` from the frontend sources.

## 2026-09-11 PNGInfo extraction for the image foundation
- Goal: PNGInfo must be read from original image bytes before any WebP/JPEG
  transcode (PRD IMG-01); no Python metadata parser existed.
- Added `prompt_agent/pnginfo.py` with `extract_image_metadata(binary)` and
  `parse_a1111_parameters(text)`: reads the PNG `parameters`/EXIF infotext,
  parses A1111/Forge positive and negative prompts and generation parameters,
  keeps seeds beyond the JS safe-integer range as decimal strings, and returns
  absent / unsupported / error statuses without fabricating defaults.
- Added `tests/test_pnginfo.py`.
- Verification: `python -m unittest tests.test_pnginfo` passed (4 tests).

## 2026-09-11 Restricted image-metadata endpoint
- Goal: give the frontend a way to read PNGInfo from the original attachment
  bytes before the WebP transcode discards them (PRD IMG-01), reusing the
  existing attachment size limits and image MIME validation.
- Added `POST /prompt-agent/api/images/metadata` in
  `backend/prompt_agent/app.py`: rejects a missing `data_url` and non-image
  payloads with 422 `invalid_image`, decodes through the shared
  `_decode_image_data` limits (24 MiB / 16 MP), and returns
  `extract_image_metadata(binary)`.
- Added route tests to `tests/test_prompt_agent_api.py`.
- Verification: both image-metadata route tests passed.

## 2026-09-11 Capture attachment PNGInfo before transcode
- Goal: image attachments were re-encoded to WebP before any metadata read, so
  PNGInfo was lost before the model copy (PRD IMG-01).
- Added `frontend/src/image-metadata.ts`: turns a Blob into a data URL without
  FileReader and POSTs it to the restricted `/prompt-agent/api/images/metadata`
  endpoint, returning the parsed metadata or null on any failure.
- Changed `frontend/src/attachments.ts`: `createImageAttachment` now reads the
  original file's metadata in parallel with the visual optimization and stores
  it on `LocalImageAttachment.metadata`; the visual copy itself is unchanged.
- Added `frontend/tests/image-metadata.test.ts`, extended the attachment test,
  and added a guarded `Blob.prototype.arrayBuffer` polyfill to
  `frontend/tests/setup.ts` for jsdom.
- Verification: `python tools/test_gate.py affected` passed (exit 0, 16.8s);
  svelte-check reported 0 errors / 0 warnings; rebuilt
  `javascript/prompt_agent_90_ui.js` from the frontend sources.

## 2026-09-11 Recent-generation image index
- Goal: the extension kept no stable record of completed generations, so a
  recent-image tool had no identity or ordering to build on (PRD step 3).
- Added `prompt_agent/image_index.py`: `ImageIndex` keeps the last 200 completed
  batches, assigns `gen-N-i` image ids, groups images by the Forge processing
  object, infers the grid as the image past `batch_size * n_iter`, and exposes
  `find`, `coverage`, `list_recent`, and a `DEFAULT_IMAGE_INDEX` singleton; it
  stores summaries only and never copies outputs.
- Registered Forge's `on_image_saved` hook in `scripts/prompt_agent.py` to
  record each saved image's filename, size, and infotext-derived metadata status.
- Added `tests/test_image_index.py`.
- Verification: `python -m unittest tests.test_image_index` passed (3 tests);
  `scripts/prompt_agent.py` compiles.

## 2026-09-11 Read-only recent-images route
- Goal: the generation index had no consumer, and no way to verify live hook
  data (PRD step 4 backend half).
- Added `POST /prompt-agent/api/images/recent` in `backend/prompt_agent/app.py`,
  delegating to `DEFAULT_IMAGE_INDEX.list_recent` and validating `limit`,
  `target`, and `include_grids` (`_recent_images_request`), returning 422 on bad
  input. Responses reuse `ImageRef.to_summary`, so filenames stay server-side.
- Added route tests to `tests/test_prompt_agent_api.py`.
- Verification: `python -m unittest tests.test_prompt_agent_api` passed (27
  tests, includes 2 new); `python tools/test_gate.py affected` exit 0 (5.8s).

## 2026-09-11 Live verification of the recent-images route on Forge 2.29
- Goal: prove the `on_image_saved` hook actually populates the index under real
  Forge, not just in unit tests.
- Restarted the updated Forge Neo 2.29 to load the new route, drove one real
  txt2img generation through the Gradio UI, then queried
  `POST /prompt-agent/api/images/recent`.
- Result: the route returned generation `gen-1` with image `gen-1-0`
  (1024x1024, target `txt2img`, `metadata_status` available, `is_grid` false),
  confirming the hook records saved images with no runtime errors.

## 2026-09-11 Read-only list_recent_generations tool
- Goal: let the agent reference earlier renders by stable id before inspecting
  their metadata or pixels (PRD step 4).
- Declared `list_recent_generations` across the tool surface: a TypeBox schema
  and tool entry in `frontend/src/tools/forge-tools.ts`, argument validation in
  `backend/prompt_agent/forge_tools.py`, and a host executor in
  `javascript/prompt_agent_02_resources.js` that POSTs bounded filters to
  `/prompt-agent/api/images/recent` (dropping an `active` target, which cannot
  filter the index).
- Extended acceptance `AGENT-TOOLS-001` (revision 7) and updated the stale
  mapped tests to the new revision.
- Updated tests: `tests/test_forge_tools.py`, `tests/test_frontend_resources.js`,
  `frontend/tests/forge-tools.test.ts`, `frontend/tests/prompt-agent-controller.test.ts`;
  rebuilt `javascript/prompt_agent_90_ui.js` from the frontend sources.
- Verification: `python tools/test_gate.py affected` exit 0 (52.9s); frontend
  127 tests and 7 e2e tests passed; svelte-check reported no errors;
  `node --check javascript/prompt_agent_02_resources.js` passed.

## 2026-09-11 Read-only read_pnginfo tool
- Goal: the agent could list recent generations but not read their saved
  metadata (PRD step 4).
- Added `POST /prompt-agent/api/images/pnginfo` in `backend/prompt_agent/app.py`:
  validates a strict `image_id` (`gen-N-i`, rejecting extra fields), looks it up
  in `DEFAULT_IMAGE_INDEX`, reads the indexed file and parses it with
  `extract_image_metadata`, and reports `image_file_unavailable` when the file is
  gone. Responses carry image_id, target, size, and parsed metadata and never a
  filename or path.
- Declared `read_pnginfo` across the Forge tool surface: TypeBox schema
  (`frontend/src/tools/forge-tools.ts`), Python validation
  (`backend/prompt_agent/forge_tools.py`), and the host executor
  (`javascript/prompt_agent_02_resources.js`).
- `ImageIndex.clear()` now resets the generation counter so a cleared index
  restarts at `gen-1`.
- Tests: `tests/test_prompt_agent_api.py` (file present, file missing, bad
  input/unknown id), `tests/test_forge_tools.py` (validation),
  `tests/test_frontend_resources.js` (POST body).
- Extended acceptance `AGENT-TOOLS-001` (revision 8) with a `read_pnginfo` bullet
  and updated the stale mapped tests.
- Verification: `python tools/test_gate.py affected` exit 0 (50.3s); frontend
  suite and mock-host e2e passed.

## 2026-09-11 Read-only read_image tool
- Goal: the agent could read a generation's metadata but not its pixels, so it
  could not visually inspect an earlier render (PRD step 4).
- Added `POST /prompt-agent/api/images/content` in `backend/prompt_agent/app.py`:
  validates a strict `image_id`, looks it up in `DEFAULT_IMAGE_INDEX`, reads the
  indexed file, and returns base64 pixels with a guessed MIME type, bounded to
  12 MiB (413 when exceeded, 404 when the id or file is unavailable). Responses
  never include a filename or path; the shared image-id validator is now used by
  both the pnginfo and content routes.
- Declared `read_image` across the Forge tool surface: TypeBox schema and tool
  entry (`frontend/src/tools/forge-tools.ts`), Python validation
  (`backend/prompt_agent/forge_tools.py`), and host executor
  (`javascript/prompt_agent_02_resources.js`). The frontend now emits an image
  content block for any read tool in an `IMAGE_RESULT_TOOLS` set (generate_image,
  read_image).
- Tests: `tests/test_prompt_agent_api.py` (base64 round-trip, bad input, missing
  file/id), `tests/test_forge_tools.py` (validation, 15-name surface),
  `tests/test_frontend_resources.js` (POST body), `frontend/tests/forge-tools.test.ts`
  (image block), `frontend/tests/prompt-agent-controller.test.ts` (surface).
- Extended acceptance `AGENT-TOOLS-001` (revision 9) with a `read_image` bullet
  and updated the stale mapped tests.
- Verification: `python -m unittest tests.test_forge_tools tests.test_prompt_agent_api
  tests.test_image_index` passed (48 tests); rebuilt
  `javascript/prompt_agent_90_ui.js`; `node --check
  javascript/prompt_agent_02_resources.js` passed.

## 2026-09-11 read_pnginfo field selection
- Goal: `read_pnginfo` always returned the whole metadata block, with no way to
  ask for a specific field, so bounded context reads were not possible
  (PRD section 9.2).
- Added an optional `fields` input (summary, positive_prompt, negative_prompt,
  generation_parameters, extra_metadata; default summary) declared in the
  TypeBox schema and validated in Python (`PNGINFO_FIELDS`, `_pnginfo_fields`,
  `_pnginfo_fields_request`).
- The route now returns `source`, `parser_format`, `metadata_status`,
  `requested_fields`, projected `data`, `missing_fields`, `warnings`,
  `truncated`, and `result_id` (null until the result-detail store lands), while
  keeping the full `metadata` block for compatibility.
- Tests: Python validation and route projection, host POST body; extended
  acceptance `AGENT-TOOLS-001` (revision 10) and refreshed the stale mapped
  tests.
- Verification: `python -m unittest tests.test_forge_tools tests.test_prompt_agent_api`
  passed (46 tests); rebuilt `javascript/prompt_agent_90_ui.js`;
  `node --check javascript/prompt_agent_02_resources.js` passed;
  `python tools/test_gate.py affected` exit 0 (32.0s).

## 2026-09-11 read_image detail, scaling, and vision gate
- Goal: `read_image` returned full-size pixels with no `detail` mode, no
  size/scaling reporting, and no model-vision check, so a non-vision model could
  still request pixels and a large render wasted context (PRD 9.3, TOOL-03).
- Added `detail` (`preview` default | `standard`) across the TypeBox schema, Python
  validation (`backend/prompt_agent/forge_tools.py`), and the host executor
  (`javascript/prompt_agent_02_resources.js`). `/images/content`
  (`backend/prompt_agent/app.py`) now reports original `width`/`height`,
  `transfer_width`/`transfer_height`, `scaled`, and `detail`: `preview` transcodes
  to a bounded 768px JPEG via new `_image_dimensions` / `_image_preview` helpers in
  `prompt_agent/image_payloads.py`, while `standard` (and any already-small image)
  returns the stored original bytes and MIME unchanged.
- Added a `supportsVision` factory gate in `frontend/src/tools/forge-tools.ts`,
  wired from the active profile's effective capabilities in
  `frontend/src/agent/controller.ts`: a non-vision model gets `vision_unsupported`
  before any host call, while `read_pnginfo` still works.
- Tests: `tests/test_forge_tools.py` (detail valid/invalid),
  `tests/test_prompt_agent_api.py` (large-image preview vs standard original,
  invalid detail), `frontend/tests/forge-tools.test.ts` (`vision_unsupported`,
  `read_pnginfo` unaffected); extended acceptance `AGENT-TOOLS-001` to revision 11
  and refreshed all stale mapped tests.
- Fixed `tests/test_architecture.py` to skip the gitignored `.playwright-mcp/` MCP
  output directory, which had accumulated a >1000-line page snapshot and broke the
  source-line-limit check.
- Verification: `python -m unittest tests.test_forge_tools tests.test_prompt_agent_api`
  exit 0; `python tools/test_gate.py affected` exit 0 (53.7s);
  `python tools/test_gate.py full` exit 0 (68.6s); frontend `svelte-check` no errors;
  rebuilt `javascript/prompt_agent_90_ui.js`; `node --check
  javascript/prompt_agent_02_resources.js` passed. One surface preview test was
  flaky under load; it passed on isolated rerun both with and without this change.

## 2026-09-11 Chat refactor and attachment PNGInfo
- Goal: the agent could not read an attached image's PNGInfo. The browser already
  extracted it (`frontend/src/image-metadata.ts`) but `materializeImageAttachment`
  dropped the result and no tool could address an upload, so a "restore this
  image's parameters" request was silently pixel-only; the chat page also repeated
  status and control visuals that an audit itemized.
- Attachment path (browser-local, no backend store): `WireAttachment` now carries
  optional `metadata` (`frontend/src/contracts.ts`, `frontend/src/attachments.ts`).
  `frontend/src/tools/forge-tools.ts` addresses a current-turn attachment as
  `attachment-N` and resolves `read_pnginfo`/`read_image` for it without a host
  call; `read_pnginfo` works without vision, `read_image` keeps the
  `vision_unsupported` gate, and an unknown id raises `unknown_attachment`.
  `frontend/src/agent/controller.ts` holds the active turn's attachments and adds a
  system-prompt rule: when an attachment's PNG metadata could not be read, say so
  and never present pixel reconstruction as the original parameters.
  `backend/prompt_agent/forge_tools.py` accepts the `attachment-N` id shape at the
  Python boundary.
- Chat and settings refactor: split `frontend/src/components/Surface.svelte` (810
  to 650 lines) into
  `components/chat/{ChatHeader,ChatHistoryPanel,ChatTranscript,MessageCard,ChatComposer,ModelPickerContent}.svelte`;
  removed duplicated tab headings, model-picker noninteractive chevrons and
  active-row thinking badge, the repeated reasoning readout, per-field settings
  card borders, and dead `.pa-profile-sidebar-actions` / `.pa-brand-lockup h1` CSS.
  DOM hooks, ARIA, and the `prompt-agent-message` textarea name are unchanged.
- Tests: `frontend/tests/forge-tools.test.ts` (attachment PNGInfo without a host
  call, attachment read_image vision gate, unknown id, attachment image block),
  `frontend/tests/attachments.test.ts` (metadata passthrough),
  `tests/test_forge_tools.py` (attachment id accepted). Advanced `AGENT-TOOLS-001`
  to revision 12 and refreshed every stale mapping.
- Verification: `python tools/test_gate.py affected` exit 0 (53.0s);
  `python tools/test_gate.py full` exit 0 (70.9s); frontend `svelte-check` no
  errors; forge-tools and attachments vitest files pass; rebuilt
  `javascript/prompt_agent_90_ui.js`; `node --check
  javascript/prompt_agent_02_resources.js` passed.

## 2026-09-11 Progressive tool disclosure
- Problem: every provider request carried all 17 agent tools, so low-frequency
  lookups (image inspection, Forge resources, Danbooru tags/wikis) spent context
  on schemas and diluted tool selection.
- Change: grouped on-demand reveal. `frontend/src/tools/tool-groups.ts` defines
  the always-on core (read_prompt, edit_prompt, read_generation_parameters,
  apply_generation_parameters, generate_image, prompt_toolkit, load_skill) plus
  the groups image, forge_resources, and danbooru.
  `frontend/src/tools/load-tools.ts` adds a `load_tools` meta-tool that returns
  the full definitions for the requested groups. `tool-registry.ts` registers it
  and exposes `core()`. `agent-runtime.ts` accepts `initialTools`, tracks
  revealed groups per session, reveals on a successful `load_tools` by updating
  the live loop context, auto-reveals image tools on attachment turns and
  forge_resources+danbooru on background-lookup turns, and reports the visible
  subset through getTools/state. `controller.ts` passes the core surface, and the
  system prompt now directs the model to `load_tools` before using a hidden tool.
  `context-pruning.ts` keeps `load_tools` guidance in the active turn.
- Tests: new `AGENT-TOOLS-001@13` `on-demand-reveal` test in
  `frontend/tests/agent-runtime.test.ts`; updated the controller surface
  expectation; advanced AGENT-TOOLS-001 to revision 13 and refreshed the stale
  Python and JS acceptance mappings.
- Verification: frontend vitest 213/213 pass; `python tools/test_gate.py
  affected` exit 0 (49.0s).
- Residual risk: same-run reveal mutates pi's live loop context because
  `AgentOptions.prepareNextTurn` only forwards a signal; the pinned pi 0.74.2
  behavior is covered by the new regression test.

## 2026-09-11 System prompt consolidation
- Problem: the per-request system prompt repeated image-handling and reply-style
  rules and restated tool mechanics that now belong to progressively loaded tool
  descriptions, spending tokens on every request.
- Change: consolidated `FORGE_AGENT_SYSTEM_PROMPT` in
  `frontend/src/agent/controller.ts` from 16 to 14 entries, merging the three
  image-inventory/attachment/pixel-reconstruction rules into two and tightening
  the caption, background-lookup, Danbooru-wiki, reply-style, and generate_image
  paragraphs. All distinct behavioral rules and the load_tools/load_skill
  guidance are preserved; only duplicated phrasing was removed.
- Tests: updated the changed canary substring in
  `frontend/tests/prompt-agent-controller.test.ts` and added a `load_tools`
  guidance assertion. No acceptance revision changed because the observable
  semantics are unchanged.
- Verification: svelte-check 0 errors; frontend vitest 213/213 pass; `python
  tools/test_gate.py affected` exit 0 (53.0s).
- Residual risk: prose changes are behaviorally load-bearing but unmeasured;
  the controller prompt-contract test and IMAGE-INPUT-001 scenario coverage are
  the current regression guard.

## 2026-09-11 Collapse frontend provider adapters
- Problem: `frontend/src/providers/{gemini,llama-cpp,openai-compatible}.ts`
  documented capability defaults and id normalization per provider, but every
  `createStream` resolved to the same proxy `StreamFn`, so three modules and a
  `ProviderRegistry` class had to track the Python provider registry by hand.
- Change: replaced them with a single row table in
  `frontend/src/providers/registry.ts` (id, shared `allProviderCapabilities()`
  defaults, and a `matches` predicate), built once through
  `createProviderAdapter`. Deleted `gemini.ts`, `llama-cpp.ts`, and
  `openai-compatible.ts`. The public surface (`providerRegistry.list/get/resolve`,
  `normalizeProviderId`, `createProviderStream`) is unchanged, including list
  order and alias normalization.
- Tests: no test edits required; `frontend/tests/provider-adapters.test.ts`
  still pins list order, explicit normalization, fallback matching, unknown-id
  rejection, proxy-only streaming, and abort propagation.
- Verification: svelte-check 0 errors; frontend vitest exit 0 (213/213);
  `python tools/test_gate.py affected` exit 0 (50.0s), 0 preflight warnings,
  0 errors. One initial full-suite run reported a single `surface.test.ts`
  preview-release failure that passed in isolation and on the immediate full
  rerun, identified as a load-sensitive flake rather than a regression.
- Residual risk: provider capability defaults remain hardcoded on both sides of
  the proxy; the table is now the only frontend copy, but Python stays
  authoritative for profiles.

## 2026-09-11 Remove local llama.cpp runtime
- Problem: local llama.cpp inference, the on-demand `llama-once` runtime, and
  local reference-image analysis were no longer needed, but their lifecycle,
  profile fields, routes, UI, and tests still spanned the backend, the root
  `prompt_agent/` package, the frontend, and the acceptance registry.
- Change: deleted the llama-only Python modules (`backend/prompt_agent/local_runtime.py`,
  `backend/prompt_agent/provider_adapters/llama_cpp.py`, `prompt_agent/llama_runtime.py`,
  `prompt_agent/reference_image.py`, `prompt_agent/model_paths.py`,
  `prompt_agent/constants.py`), the `/prompt-agent/api/local-runtime/*` and
  `/analyze-image` routes, and all llama branches in `app.py`, `contracts.py`,
  `forge_tools.py`, `migration.py`, `models.py`, `profile_contracts.py`,
  `profiles.py`, `providers.py`, and `provider_adapters/registry.py`. Frontend
  lost the local-runtime lifecycle, local profile fields and UI, the `llama-cpp`
  provider adapter, and the llama-once-only session/naming route feature. The
  session/naming route existed only for local profiles, so it was removed end to
  end. Legacy stored `llama-once`/`llama-endpoint` profiles now migrate to a
  disabled `remote-http`/`openai-compatible` profile instead of failing
  validation, covered by a new data-integrity test.
- Acceptance: removed `LOCAL-RUNTIME-001`; advanced `UI-FEEDBACK-001` to
  revision 13 (dropped the local-startup loading criterion, `loading` scenario,
  and local-runtime paths) and `PROVIDER-TOOLS-001` to revision 3 (dropped the
  llama.cpp forced-tool clause); removed the deleted test from the gate's
  managed-file set; regenerated `quality/ACCEPTANCE.md`.
- Docs: updated `README.md`, `AGENTS.md` (dependency direction and Local Models
  removal note), `ROADMAP.md` (Phase 5 supersede note), `docs/EXPERIENCE_BASELINE.md`,
  and `docs/PROMPT_TOOLKIT_DESIGN.md`; rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `python -m unittest discover -s tests` 120 tests OK;
  `python tools/test_gate.py preflight --mode full` 17 requirements / 60
  mappings / 0 warnings / 0 errors; frontend svelte-check 0 errors and vitest
  pass (206 tests); one full-suite run hit the pre-existing load-sensitive
  `surface.test.ts` preview-release flake, which passed in isolation and is not
  related to this removal. `python tools/test_gate.py full` exit 0 (see
  `quality/ACCEPTANCE.md` for the current revision table).
- Residual risk: remote providers are unaffected, but the removal is broad; the
  migration test guards upgrade safety for stored local profiles. Historical
  archive docs under `docs/archive/` still describe the old runtime by design.

## 2026-09-11 Stabilize attachment preview release test
- Problem: CI's frontend job (`pnpm run test:coverage`) intermittently failed
  `surface.test.ts > releases previews after removal, replacement, and unmount`
  with `TestingLibraryElementError` for the `Remove remove.png` / `Edit
  replace.png` buttons, and the same failure blocked the preceding commit. The
  test queried the attachment chip with `getByRole` immediately after
  `user.upload`, but attaching a file reads its PNG info asynchronously, so the
  chip is not in the DOM until that read resolves; under coverage/CI load the
  synchronous query ran too early.
- Change: `frontend/tests/surface.test.ts` waits with `findByRole` for the
  Remove/Edit controls and the Replace menu item before interacting. No product
  code changed.
- Verification: `pnpm run test:coverage` (the CI command) exit 0; the focused
  test passed five consecutive coverage runs; the full delivery gate was exit 0
  before this test-only change.
- Residual risk: attachment chip rendering stays asynchronous by design; the
  test now tolerates it instead of assuming an immediate render.

## 2026-09-11 Restore asynchronous post-turn release and incremental session sync
- Root cause: the terminal send path regressed to awaiting the history reload and
  the full server session sync before `Surface.svelte` cleared
  `submissionInFlight`, so the composer stayed disabled until every local session
  snapshot was uploaded and re-applied. The 2026-08-04 asynchronous post-turn
  work had already removed this wait; the sync also pushed and re-applied all
  local sessions on every turn regardless of change.
- Change: `frontend/src/agent/controller.ts` now fires the post-turn history
  reload and session sync after awaited local persistence, coalesces overlapping
  syncs, and skips applying a sync result once a newer request owns the runtime.
  `frontend/src/sessions/sync.ts` and `frontend/src/sessions/repository.ts` now
  upload only dirty or never-synced sessions and skip re-applying snapshots whose
  content hash already matches the local `syncHash`, with a full-sync fallback
  until the first successful sync (in-memory dirty set, so a server data reset
  still reconciles on the next full sync).
- Regression tests: `frontend/tests/prompt-agent-controller.test.ts` (terminal
  send resolves while sync is still pending; a rejected background history reload
  does not fail the send) and `frontend/tests/session-sync.test.ts` (dirty-only
  upload, never-synced upload, full-sync fallback, unchanged-snapshot skip).
- Rebuilt `javascript/prompt_agent_90_ui.js` from frontend source.
- Verification: `python tools/test_gate.py affected` exit 0 (43 Python, Svelte
  0/0, 132 frontend, 7 browser, acceptance 0 warnings/0 errors);
  `python tools/test_gate.py full` exit 0 (120 Python, 16 host contracts, Svelte
  0/0, 212 frontend, build/budget, 7 browser, browser syntax).
- Residual risk: only upload/apply is incremental; the response still returns
  every stored snapshot (JSON parse plus server hashing) and the changed session
  is echoed back and re-applied once. A local write racing the sync can be
  cleared as clean (marked with a `ponytail:` note in `sync.ts`); the next write
  re-dirties it. `UI-FEEDBACK-001` and `SESSION-SYNC-001` text and accepted
  semantics are unchanged, so no acceptance revision was bumped.

## 2026-09-24 Keep long reasoning and execution traces responsive
- Root cause: every reasoning delta reparsed, sanitized, and replaced the whole
  growing Markdown DOM, while each runtime event also reprojected and validated
  the entire prior session, including completed prompt diffs and attachments.
- Change: `frontend/src/components/Markdown.svelte`, `ToolCard.svelte`, and
  `styles.css` keep append-only live output as safe text and parse settled/final
  Markdown; `frontend/src/agent/controller.ts` caches completed projections,
  and `frontend/src/stores/chat.ts` reuses unchanged validated messages and
  attachment ownership. Rebuilt `javascript/prompt_agent_90_ui.js` from source.
- Regression tests: `frontend/tests/markdown-streaming.test.ts`,
  `surface.test.ts`, `prompt-agent-controller.test.ts`, and `stores.test.ts`
  cover growing traces, final formatting, stable completed history, and
  attachment reconciliation. Pinned Node 22.17.0 / pnpm 10.12.4 checks.
- Verification: `python tools/test_gate.py fast` passed; `affected` passed its
  Python, frontend, and type checks but one parallel mobile browser test hit
  its 30-second timeout; isolated retry passed. `python tools/test_gate.py full`
  passed (132 Python, 16 host contracts, 230 frontend, 7 browser, type check,
  build, bundle budget, and browser syntax). Acceptance preflight: 0 warnings.
- Residual risk: long-trace browser behavior was exercised in the mock-host
  frontend, not a live Forge instance. Final Markdown still requires one full
  parse; the repeated per-delta parse and whole-history validation are removed.
