# Active Audit Log

Historical migration implementation remains available on branch `kt` and tag
`kt-final`. The concise archive index is in
`docs/archive/audit-archive-2026-07-19.md`; detailed working notes are
local-only under `docs/archive/`. Recent completed increments through the
Launcher recovery are in `docs/archive/audit-archive-2026-07-28-29.md`.
Entries from 2026-07-19 through 2026-07-30 moved to
`docs/archive/audit-archive-2026-07-19-to-30.md` to keep this file under the
1000-line source limit.

## 2026-08-04 Asynchronous Post-Turn Session Work
- Root cause: terminal agent output became visible before the controller released
  its submission latch because IndexedDB persistence, history refresh, and server
  synchronization were awaited in the send path; initial mount also awaited a
  slow server sync, so remote recovery could remain on Connecting indefinitely.
- Changed `frontend/src/agent/controller.ts` and `frontend/src/stores/runtime.ts`
  to release the composer after terminal runtime work, serialize persistence and
  synchronization in a background queue, preserve in-memory messages for the
  next turn, and expose persisting/syncing/error phases. Initial local recovery
  now finishes before sync; the top-of-chat progress bar shows the phase, and a
  new turn aborts the old initial sync.
- Advanced `UI-FEEDBACK-001` to revision 9 with `post-turn` and `connection`
  scenarios; updated session sync, UI, tests, acceptance, and the generated
  bundle.
- Verification: affected and full gates passed; full passed 106 Python tests,
  198 frontend tests, 13 host contracts, Svelte 0/0, build/budget, 7 Playwright
  scenarios, browser syntax, and acceptance 18 requirements / 61 mappings.

## 2026-08-06 Danbooru Tag Provenance Policy
- Root cause: the Anima and Danbooru skill instructions treated a live Danbooru
  match as the default validity gate, so clear user-provided, existing Forge,
  autocomplete/auto-fill, or model/extension-specific tags could be refused as
  “non-standard” even when they were usable prompt input.
- Updated the Danbooru guide, Anima guide, Agent system prompt, and load-skill
  description to reserve strict canonical verification for explicitly requested
  Danbooru catalog/upload/normalization work; ordinary prompt editing now
  preserves clear tags when the current index has no match. Advanced
  `PROMPT-SKILL-001` to revision 3 and added the tag-provenance regression.
- Rebuilt `javascript/prompt_agent_90_ui.js` from the frontend source.
- Verification: `python tools/test_gate.py affected` passed 44 Python tests,
  Svelte 0/0, 128 frontend tests, and 7 browser scenarios. `python
  tools/test_gate.py full` passed 107 Python tests, 13 host contracts, 198
  frontend tests, build/budget, 7 browser scenarios, and browser syntax checks.

## 2026-08-09 Stage A: AICSS working indicator restyle
- Root cause: none (visual refresh). Working indicator used a linear progress
  thread that read as a progress bar, unlike the AICSS agent-state language.
- Replaced `.pa-working-thread` with a CSS-only ring orb (8 phase-staggered
  accent dots forming one comet, `pa-orb-orbit`) and a shimmering label
  (`pa-shimmer-sweep`, gradient clipped to text inside `@supports` with a
  plain-color fallback). Tested text labels, `role="status"`, and `<details>`
  toggle behavior are unchanged; reduced-motion and forced-colors overrides
  updated for both new elements.
- Changed: `frontend/src/components/WorkingIndicator.svelte`,
  `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 198 passed,
  `pnpm run build` ok, mock-host browser acceptance 7 passed.

## 2026-08-09 Stage B: AICSS tool-state restyle
- Root cause: none (visual refresh). Tool cards rendered a plain uppercase
  text status without resolving-state semantics.
- ToolCard now carries a per-kind tinted glyph tile (search/inspect/toolkit/
  prompt/generation/load_skill icons) and a status pill: complete shows a
  check glyph with a pop-in keyframe (AICSS globe-to-check resolution),
  error shows an alert glyph in destructive tint, running reuses the ring
  orb with the shimmering label. `.pa-tool-status-error` text and all
  collapse/undo/result behavior are unchanged; dark-mode pill variant added.
- Changed: `frontend/src/components/ToolCard.svelte`,
  `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 198 passed,
  `pnpm run build` ok, mock-host browser acceptance 7 passed.

## 2026-08-09 Stage C: AICSS composer and streaming-text polish
- Root cause: none (visual refresh). Send control was a square filled button
  with a generic Send glyph; streaming replies had no in-progress cue.
- Send button is now a round AICSS ArrowUp control: filled primary only when
  enabled, muted secondary when empty/disabled, keeping the position-stable
  queue/stop behavior and all aria-labels used by acceptance tests. Streaming
  assistant replies show a pulsing accent caret (`pa-cursor-blink`) after the
  text. Enhance-prompt pill intentionally not added: it would need new backend
  capability, out of scope for a visual pass.
- Changed: `frontend/src/components/Surface.svelte`,
  `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 198 passed,
  `pnpm run build` ok, mock-host browser acceptance 7 passed.

## 2026-08-09 Stage D: AICSS shell token refinements
- Root cause: none (visual refresh). Floating windows used tight fallback
  radius/shadow values and the empty-state icon had no presence.
- Softened the default fallback window shadow (18px/44px blur) and large
  radius (8px); Forge theme values still win when provided. Added a soft
  accent halo behind the empty-state icon via drop-shadow. No layout logic
  touched.
- Changed: `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm test` 198 passed, `pnpm run build` ok.

## 2026-08-09 Stage C-2: attach control and bubble geometry
- Root cause: none (visual refresh). The attach control was a plain 28px icon
  button and user bubbles kept the theme's 6px radius.
- Renamed `pa-composer-icon` (only one usage) to `pa-attach-button`: a
  round, hairline-bordered control that tints on hover/focus (AICSS "+"
  treatment), 34px on mobile. User bubbles now use a soft 14px radius with a
  3px tail corner. aria-labels and behavior unchanged.
- Changed: `frontend/src/components/Surface.svelte`,
  `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 198 passed,
  build ok, mock-host browser acceptance 7 passed. NOTE: Forge Neo embeds
  extension JS at startup; a full Forge restart plus browser hard refresh is
  required to see any of the Stage A-C visual changes.

## 2026-08-09 Unified chat visual language (AICSS alignment)
- Root cause: none (visual refresh). Window title, process drawer summary,
  and semantic diff header each used plain text, while tool cards already
  carried accent glyph tiles and status pills.
- Unified the accent-tile language across chat surfaces: window title now
  has a focus-tinted Sparkles mark; the process drawer summary gained a
  Workflow tile (turns destructive red on terminal failure) and the
  reasoning-trace row a BrainCircuit icon; the prompt-diff header gained a
  FileDiff tile and its +/- counts are now soft pills (green/red, dark-mode
  variants). Chevron rotation scoped to the first direct svg so tiles never
  spin with the disclosure arrow. Borderless transcript invariants
  (style-tokens test) and all class/text anchors are preserved; the
  accidentally dropped `.pa-process-intermediate .pa-markdown` rule was
  restored during the pass.
- Changed: `frontend/src/components/Surface.svelte`,
  `frontend/src/components/ProcessDrawer.svelte`,
  `frontend/src/components/PromptChangeCard.svelte`,
  `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 198 passed,
  build ok, mock-host browser acceptance 7 passed.

## 2026-08-09 S1: thinking panel with streamed reasoning reveal
- Root cause: none (new visual). Reasoning was compressed to a single
  180-char line in the working indicator.
- WorkingIndicator now auto-opens while reasoning streams and reveals
  sentences one by one (fade + slide-up on mount, top fade mask, auto-scroll
  to latest), then folds to a `Thought for Ns` line once generation starts.
  Sentence splitting is lookbehind-free (compatible with all browsers).
  Tested text labels, `role="status"`, and detail rows are unchanged;
  new surface regression covers auto-open, sentence stream, and fold.
- Changed: `frontend/src/components/WorkingIndicator.svelte`,
  `frontend/src/styles.css`, `frontend/tests/surface.test.ts`,
  rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 199 passed,
  build ok.

## 2026-08-09 S2: token count-up usage ticker
- Root cause: none (new motion). Usage appeared only as final text after a
  turn, with no in-flight presence or landing animation.
- New UsageCounter component replaces the footer usage text: values that
  arrive after mount count up with an eased rAF animation and a one-shot
  scale settle; values present at mount render directly (keeps sync test
  and exact e2e text `12 in · 4 out · 0 cache` intact); while a turn is
  active without usage it shows a `0 in · 0 out` pulse placeholder.
  Reduced-motion jumps straight to the final values.
- Changed: `frontend/src/components/UsageCounter.svelte` (new),
  `frontend/src/components/Surface.svelte`, `frontend/src/styles.css`,
  `frontend/tests/usage-counter.test.ts` (new),
  rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 202 passed,
  build ok, mock-host browser acceptance 7 passed.

## 2026-08-09 S3: typography breathing room
- Root cause: none (visual refresh). Body type was 13px with tight line
  spacing, reading small and cramped.
- Raised base body token to 14px; message cards and markdown to .95rem with
  1.7 line height; message scroll gap 1.9rem with wider padding; composer
  textarea to .95rem/1.55. No layout or behavior changes.
- Changed: `frontend/src/styles.css`, rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 202 passed, build ok.

## 2026-08-09 S4: unified composer pill controls
- Root cause: none (visual refresh). Model trigger, reasoning trigger, and
  attach button each had different shapes and hover languages.
- All three now share one pill style (2rem tall, 999px radius, hairline
  border, focus-tint hover, icon tinted with the theme accent). Attach
  gained a text label (`Image`, hidden below 419px); model/reasoning
  triggers switched from the shadcn Button ghost to plain buttons.
  aria-labels, picker behavior, and e2e anchors (`Active model` /
  `Change reasoning effort`) unchanged.
- Changed: `frontend/src/components/ModelPicker.svelte`,
  `frontend/src/components/Surface.svelte`,
  `frontend/src/selector-styles.css`, `frontend/src/styles.css`,
  rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 202 passed,
  build ok, mock-host browser acceptance 7 passed.

## 2026-08-09 S5: icon restraint pass
- Root cause: none (visual refresh). Decorative accent tiles and redundant
  glyphs cluttered surfaces that already carry text labels.
- Removed: window-title Sparkles, process-drawer Workflow tile, reasoning
  trace Brain, prompt-diff FileDiff tile, model/reasoning trigger glyphs
  (labels + chevron remain), usage Clipboard, and all working-indicator
  phase icons (the ring orb is now the single deliberate glyph). Kept:
  launcher Sparkles, tool-card glyph tiles and status pills (function in
  the process narrative), message role icons, chevrons, and the orb.
  Dead CSS (glyph tiles, working-icon, svg:first-child tint) removed.
- Changed: `frontend/src/components/Surface.svelte`,
  `frontend/src/components/WorkingIndicator.svelte`,
  `frontend/src/components/ProcessDrawer.svelte`,
  `frontend/src/components/PromptChangeCard.svelte`,
  `frontend/src/components/ModelPicker.svelte`,
  `frontend/src/components/ReasoningPicker.svelte`,
  `frontend/src/components/UsageCounter.svelte`,
  `frontend/src/styles.css`, `frontend/src/selector-styles.css`,
  rebuilt `javascript/prompt_agent_90_ui.js`.
- Verification: `pnpm run check` 0/0, `pnpm test` 202 passed,
  build ok, mock-host browser acceptance 7 passed, affected gate 0 warnings.
## 2026-08-11 Buffered Streaming Text Reveal

- Root cause: the streaming message style added a blinking `::after` cursor,
  but `Surface.svelte` still rendered each provider `message.content` snapshot
  directly. Coarse provider deltas therefore appeared as whole blocks with a
  blinking cursor rather than as progressive text.
- Changed `frontend/src/components/Markdown.svelte` to keep authoritative
  runtime content separate from a view-only grapheme buffer. The buffer drains
  every 24 ms with bounded catch-up for large deltas, preserves the visible
  prefix as new deltas arrive, flushes on terminal status, and bypasses the
  animation for `prefers-reduced-motion`. `Surface.svelte` enables this only for
  final assistant text; reasoning and tool rendering keep their existing paths.
- Added focused tests for progressive reveal, appended stream chunks, terminal
  flush, reduced-motion fallback, and unparsed Markdown during streaming.
  Advanced `UI-FEEDBACK-001` to revision 10 with the new `streaming` scenario
  and reviewed all existing mappings at the new revision.
- Regression-first evidence: the new focused test initially failed because the
  complete provider block rendered immediately. After implementation, the
  focused Markdown and surface suites passed 48 tests.
- `python tools/test_gate.py affected`: passed 44 Python tests, Svelte check with
  0 errors and 0 warnings, 129 affected frontend tests, all 7 Playwright
  scenarios, and acceptance preflight with 18 requirements / 63 mappings.
- `python tools/test_gate.py full`: passed 107 Python tests, 13 browser-host
  contracts, Svelte check with 0 errors and 0 warnings, 204 frontend tests, the
  production build and bundle budget, all 7 Playwright scenarios, browser-script
  syntax checks, and acceptance preflight with 18 requirements / 63 mappings.
- Rebuilt `javascript/prompt_agent_90_ui.js`. Residual verification is limited
  to a hard refresh and a live provider response in the running Forge UI; no
  Forge restart is required.
- Verification: python tools/test_gate.py affected - 78 OK (incl. new regression test), svelte-check 0 errors/0 warnings, vitest 129/129 passed, Playwright mock-host acceptance 7/7 passed; exit code 0. Environment-only fixes: git safe.directory config, pip --user install of requirements.txt and requirements-test.txt, pnpm --frozen-lockfile install with pinned node@22.17.0/pnpm@10.12.4, playwright install chromium.
- Verification: python tools/test_gate.py affected - tests OK (incl. catalog probe and missing-model regression), svelte-check 0/0, vitest 129/129, Playwright mock-host acceptance 7/7; exit code 0.
- Verification: python tools/test_gate.py full - 111 OK, browser host contracts 13 OK, svelte-check 0 errors/0 warnings, vitest 205/205 (26 files), vite build OK with bundle budget met (824539 raw / 240319 gzip bytes), Playwright mock-host acceptance 7/7 passed, node --check passed for all javascript/prompt_agent*.js; exit code 0. generateImageTool moved from prompt_agent.js to new javascript/prompt_agent_03_generate_image.js to satisfy the 1000-line source limit (test_architecture); call site late-binds via promptAgent.generateImageTool.

## 2026-08-26 Reset recovery, request-size fix, and generation switch
- Environment incident: the Forge Neo extension updater reset the branch to
  origin/codex/prompt-agent-roadmap, discarding local commits (affcdad, ef23907)
  and uncommitted UI fixes. Restored both commits by cherry-pick (b6b5063,
  a9c4725) onto the rewritten origin lineage and reconciled old-lineage test
  code with the new-lineage runtime (removed tests for dropped features:
  session-work progress bar, clipboard paste-attach, thinking-panel fold,
  launcher viewport clamping, local persistence fallback; regenerated
  quality/ACCEPTANCE.md).
- Root cause of "request body is too large": generate_image returned full-res
  base64 renders into history, re-sent every turn until the 16 MB request cap
  rejected the call. javascript/prompt_agent_03_generate_image.js now downscales
  the captured render to max 1024 px JPEG (quality 0.85) via canvas before
  returning it, and only clicks generate (busy-waits while the interrupt control
  is visible) so it can no longer interrupt a running Forge generation.
- New switch: agent-triggered image generation can be toggled from the profile
  settings overflow menu; persisted in localStorage, enforced in forge-tools
  invokeForgeTool as a non-retryable permission_denied error, and explained to
  the model in the system prompt. The system prompt also requires one short
  plain sentence between tool steps so tool chains are no longer silent.
- Verification: python tools/test_gate.py affected - exit 0, svelte-check 0/0,
  vitest 124/124 (9 files), Playwright 7/7, acceptance preflight 18
  requirements / 60 mappings / 0 errors. python tools/test_gate.py full -
  exit 0, 111 Python tests OK, 13 host contracts, svelte-check 0/0, vitest
  196/196 (25 files), vite build within budget (812779 raw / 237125 gzip),
  Playwright 7/7, node --check all host scripts. AUDIT.md was 1231 lines over
  the 1000-line limit; July entries moved to
  docs/archive/audit-archive-2026-07-19-to-30.md, added to HISTORICAL_FILES in
  tests/test_architecture.py.

## 2026-08-26 Krea 2 skill with automatic agent skill selection
- Root cause: none (new capability). The agent had per-model load_skill
  instructions only for Anima, and no Krea 2 guidance; model-specific skill
  selection relied on static prompt text instead of the live Forge state.
- Added a krea2 prompt skill (natural-language prompting, text rendering,
  Turbo guidance) to prompt_skills.py and the load_skill tool schema, and made
  the browser host report the active Forge UI preset, checkpoint, and a
  recommended_skill (anima_dit or krea2) inside read_generation_parameters
  results via a new forgeSkillHint helper in prompt_agent_03_generate_image.js.
  The system prompt now tells the agent to load the recommended skill before
  prompt work and re-check it when the checkpoint changes, replacing the
  per-model sentences. prompt_agent.js stayed under the 1000-line limit by
  hosting the helper in the _03 generation-tools script with late binding.
- Verification: python tools/test_gate.py affected - exit 0. python
  tools/test_gate.py full - exit 0, 111 Python tests OK, 13 host contracts,
  svelte-check 0/0, vitest 196/196 (25 files), vite build within budget
  (813061 raw / 237246 gzip), Playwright 7/7, node --check all host scripts.

## 2026-09-04 Chronological single-entry agent process timeline
- Root cause: the chat surface grouped assistant messages and tool results into
  separate arrays, and ProcessDrawer rendered all intermediate text, then all
  reasoning, then all tools. This discarded the runtime message order. During
  active work the response collapse, process drawer, and expandable working
  indicator also exposed competing disclosure controls.
- Changed frontend/src/components/Surface.svelte to retain each turn's original
  assistant/tool message sequence, hide response-level collapse while streaming,
  and place the live phase inside the active process drawer. Changed
  ProcessDrawer.svelte to render that sequence directly, auto-open only during
  active work, and return to a collapsed completed summary. Changed
  WorkingIndicator.svelte and styles.css so live status is visible without its
  own disclosure arrow. Regenerated javascript/prompt_agent_90_ui.js.
- Bumped UI-FEEDBACK-001 to revision 11 in quality/acceptance.json and
  quality/ACCEPTANCE.md, refreshed mapped tests, and added regression assertions
  for reasoning/intermediate/tool/reasoning DOM order, single-entry active work,
  automatic open/close behavior, and tool-only nested disclosure.
- Verification: pinned Svelte check passed with 0 errors and 0 warnings; focused
  surface tests passed 41/41; `tools/test_gate.py affected` passed 46 Python,
  124 frontend, and 7 browser tests; `tools/test_gate.py full` passed 112 Python,
  13 browser-host contract, 196 frontend, and 7 Playwright tests. Production
  build and bundle budget passed at 814155 raw / 237602 gzip bytes, and all
  generated/browser JavaScript syntax checks passed. The first sandboxed
  affected-gate attempt could not fetch the pinned pnpm package (EACCES); the
  approved rerun used the required pinned toolchain and passed.

## 2026-09-04 Provider-facing context pruning and composer usage meter
- Root cause: completed-turn tool chatter, search URLs, skill/prompt payloads,
  and generate_image base64 were re-sent every request, while the composer
  usage ring summed per-request inputs instead of the latest assistant
  `usage.inputTokens`. Control follow-ups projected as `user` after a
  `toolResult` would also look like a new turn and drop the current results.
- Added `frontend/src/agent/context-pruning.ts` as a provider-facing copy:
  completed turns keep user intent plus final assistant text; the active turn
  keeps the last 6 tool results plus errors and `load_skill`/`edit_prompt`/
  `apply_generation_parameters`. Compacted `search_danbooru_tags` /
  `search_danbooru_wikis` to 8 candidates without URLs, dropped model-facing
  `image_base64`/`prompt`/`document`/`changes`, and stripped UI `details` from
  the provider copy. `lastUserTurnIndex()` walks back past control follow-ups.
  Composer `ContextMeter` now uses latest `usage.inputTokens` vs
  `contextLimit || nCtx || 131072`. Session history is still stored unpruned.
- Verification: `tools/test_gate.py affected` passed 46 Python, 130 frontend
  (10 files), and 7 Playwright tests. `tools/test_gate.py full` passed 112
  Python, 13 browser-host contract, svelte-check 0/0, vitest 203/203 (26
  files), Playwright 7/7. Production build and bundle budget passed at 818704
  raw / 239126 gzip bytes, and all generated/browser JavaScript syntax checks
  passed.

