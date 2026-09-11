# Context Pruning Handoff

Status: implemented in this working tree, not committed.
Prompt/JSON anti-filter work was explicitly stopped and is not in this change.

## Problem

The UI “100K+” number was mostly a display bug: `ProcessDrawer` used to sum every internal model request’s `input` for the turn. A 4-user-message session could show ~136K–143K while the latest real request was ~25K–37K.

The real context still grew too fast:

- Durable history, UI, and provider messages were the same objects.
- Every tool result stored `content = JSON.stringify(result)` plus `details = result`.
- Completed-turn tool chatter, reasoning, and old image base64 were replayed forever.
- `prompt_toolkit` returned the full parse `document` and `changes`.
- `edit_prompt` sent `before_prompt` / `after_prompt` back to the model.
- Danbooru search could dump 12+ candidates plus URLs.
- `generate_image` duplicated base64 in `content` and `details`.

Borrowed from [OpenCode DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning): never mutate session history; project a provider-facing copy; replace dropped tool output with a placeholder; keep errors and write evidence.

Not copied: DCP compress tool, cache-aware dedupe, config surface, or prompt-injection “anti-filter” text.

## Behavior now

Provider path: `agent-runtime.ts` `convertToLlm` → `pruneContextForModel`.

1. Completed turns keep the user text and the final assistant text only. Old images become a placeholder. Tool calls, tool results, and reasoning are dropped.
2. The active turn stays protocol-complete. Only older non-critical tool results become placeholders; matching tool-call arguments shrink to `{ context_pruned: true }`.
3. Always kept in the active turn: last 6 tool results, errors, `load_skill`, `edit_prompt`, `apply_generation_parameters`.
4. Control follow-ups (`promptAgentControl` projected as `user`) after a `toolResult` do not start a new turn. A new user message after a completed assistant answer does.
5. Tool `content` is the compact model payload. `details` stays for UI/runtime. Persistence strips `details` except `edit_prompt`, which still needs `before_prompt` / `after_prompt` for the mutation card.

Compact tool payloads:

- `edit_prompt`: drop `before_prompt`, `after_prompt`, `prompt`
- `generate_image`: image block + metadata; no base64 in `details`
- `prompt_toolkit`: drop `document` and `changes`; keep `output`, `summary`, `recommended_patch`
- `load_skill`: model still gets the guide in `content`; UI `details` is `{ok,name,title}`
- Danbooru search: first 8 candidates, no `wiki_url` / `tag_url` / `url`

Composer meter: latest assistant `usage.inputTokens` / `modelInfo.contextLimit || nCtx || 131072`. Process drawer uses the same latest-request usage, not a sum.

## Files

- `frontend/src/agent/context-pruning.ts`
- `frontend/src/agent/agent-runtime.ts`
- `frontend/src/agent/controller.ts`
- `frontend/src/tools/forge-tools.ts`
- `frontend/src/tools/prompt-toolkit.ts`
- `frontend/src/tools/load-skill.ts`
- `frontend/src/components/ContextMeter.svelte`
- `frontend/src/components/Surface.svelte`
- `frontend/src/components/ProcessDrawer.svelte`
- `quality/acceptance.json` `UI-FEEDBACK-001@12`, `AGENT-TOOLS-001@12`
- tests: `context-pruning.test.ts`, `surface.test.ts`, `forge-tools.test.ts`, `prompt-toolkit.test.ts`, `load-skill.test.ts`

Unrelated dirty files already in this tree: Krea skill, process-timeline UI, `javascript/prompt_agent_90_ui.js` (must be rebuilt, never edited by hand).

## Review these

1. Dropping completed-turn tool results is aggressive. Re-read `read_prompt` / `load_skill` if a later turn needs them.
2. `edit_prompt` `details` still persist the full before/after text. Needed for the diff card; still storage-heavy.
3. Current-turn `generate_image` still sends the JPEG to the model. Old-turn images are omitted.
4. Session sync is still a full snapshot round-trip. Not changed.
5. No system-prompt anti-filter text was added.

## Verify

From `extensions/sd-forge-neo-prompt-agent`:

```text
python tools/test_gate.py affected
python tools/test_gate.py full
```

Frontend toolchain is Node 22.17.0 / pnpm 10.12.4. Rebuild `javascript/prompt_agent_90_ui.js` via `pnpm run build` in `frontend/`.
