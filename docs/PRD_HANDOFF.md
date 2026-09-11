# PRD Handoff

Governing spec: `Forge-Prompt-Agent-PRD-v1.md` (repo root, v1.0 2026-09-11).
This document is the entry point for continuing the PRD work in a fresh session.

## State

- Branch `main`, clean tree, ahead of `origin/main` by this increment (previous HEAD `085e2ee`).
- All PRD work so far is committed and pushed.
- Do not hand-edit `javascript/prompt_agent_90_ui.js`; regenerate from `frontend/`.

## Done (each a small commit, affected gate green)

| Area | Commit | Notes |
| --- | --- | --- |
| Baseline | `a86874b` | `docs/EXPERIENCE_BASELINE.md`: settings field migration table, Forge version + completion hooks, image source map |
| Settings IA | `60714c0` | Four disclosure sections; container-query single column <560px |
| Motion | `13b5158` | `frontend/src/motion.ts` window open/close + reduced-motion |
| PNGInfo parse | `2d76389` | `prompt_agent/pnginfo.py` `extract_image_metadata` / `parse_a1111_parameters` |
| Metadata route | `765c126` | `POST /prompt-agent/api/images/metadata` (restricted extraction) |
| Attachment capture | `1f22c31` | Metadata read from original bytes before WebP transcode |
| Image index | `183d900` | `prompt_agent/image_index.py` + `on_image_saved` hook in `scripts/prompt_agent.py` |
| Recent route | `f85b66e` | `POST /prompt-agent/api/images/recent` |
| Live verify | `44c1e57` | Real Forge 2.29 run confirmed the hook populates the index |
| `list_recent_generations` | `0747298` | Schema + Python validation + host executor |
| `read_pnginfo` | `7b9bd8e` | `POST /prompt-agent/api/images/pnginfo` |
| `read_image` | `c8f8527` | `POST /prompt-agent/api/images/content`; image content block |
| PRD in repo | `e89c131` | The spec itself |
| `read_pnginfo` fields | `f24a58e` | Optional `fields`, `source`, `requested_fields`, `truncated`, reserved `result_id` |
| `read_image` closure | `b4a742d` | `detail` (`preview` default / `standard`), original vs transfer size + `scaled`, `vision_unsupported` gate; PNGInfo unaffected |
| Reasoning dedup | `085e2ee` | Removed the duplicate streaming reasoning excerpt (working indicator vs process trace) |
| Chat refactor | this commit | Split `Surface.svelte` into `components/chat/*`; removed duplicated tab headings, model-picker chevrons/thinking badge, reasoning readout, flattened settings card borders, dead CSS |
| Attachment PNGInfo | this commit | Attachments addressed as `attachment-N`; `read_pnginfo`/`read_image` resolve current-turn attachments locally (no host/vision needed for metadata); metadata disclosure rule; `AGENT-TOOLS-001` r12 |

Declared Forge tool surface (15, order is contract-tested):
`read_prompt`, `edit_prompt`, `read_generation_parameters`,
`apply_generation_parameters`, `generate_image`, `list_recent_generations`,
`read_pnginfo`, `read_image`, `search_resources`, `inspect_resource`,
`search_danbooru_tags`, `inspect_danbooru_tags`, `related_danbooru_tags`,
`search_danbooru_wikis`, `inspect_danbooru_wikis`.

## Remaining (PRD section 14)

1. Step 4 closure — tool contract gaps:
   - `list_recent_generations` (PRD 9.1): add `scope` (`session` default |
     `host_recent`) and optional `cursor`; per-item short description. Session
     scope needs an agent-session -> generation link, which does not exist yet.
   - `read_pnginfo` (9.2): `result_id` is returned as `null` until the result
     store exists.
2. Step 3 leftover (PRD 8.2): persist the bounded extracted metadata and image
   reference; the generation index is currently in-memory only. Also
   `generate_image` stable image/batch ids (9.1 / 11). Attachment metadata stays
   browser-local by design; only a durable host-side store would need new routes.
3. Step 5 (PRD 9.4 + 10 + 5): bounded tool-result store + `read_tool_result`,
   unified search projection fields, and the UI summary/detail layering.
4. Step 6 (PRD 7): P1 style-preset category/cover/favorite and edit-conflict
   protection.

## Architecture pointers

- Tool path: `frontend/src/tools/forge-tools.ts` (TypeBox schema, timeout,
  read/write permission, `IMAGE_RESULT_TOOLS`) ->
  `backend/prompt_agent/forge_tools.py` (`FORGE_TOOL_NAMES`,
  `validate_forge_tool_request`) ->
  `javascript/prompt_agent_02_resources.js` (`RESOURCE_TOOLS`,
  `resourcePost`) -> route in `backend/prompt_agent/app.py`
  (`register_prompt_agent_api`, `_image_id_request`, `_read_indexed_image`).
- Image data: `prompt_agent/image_index.py` (`DEFAULT_IMAGE_INDEX`),
  `prompt_agent/pnginfo.py`, `scripts/prompt_agent.py` (`on_image_saved`).
- Attachment metadata path: browser extracts PNGInfo from the original bytes
  (`frontend/src/attachments.ts`, `image-metadata.ts`) and `WireAttachment.metadata`
  carries it; `frontend/src/tools/forge-tools.ts` resolves `attachment-N`
  locally, so there is intentionally no backend attachment store. Generation
  ids still go through the host (`gen-N-M`).
- Acceptance: `quality/acceptance.json`; `AGENT-TOOLS-001` is at revision 12.
  Behavior changes need `python tools/test_gate.py behavior-change <ID> --bump`
  then refresh every stale mapped test (decorators live in
  `tests/test_forge_tools.py`, `tests/test_resources.py`,
  `frontend/tests/agent-runtime.test.ts`, `frontend/tests/context-pruning.test.ts`).

## Verification status

- `python tools/test_gate.py affected` green after every increment.
- Real Forge Neo 2.29 (`76586f6a`, local `--fp32-vae --disable-sage
  --force-upcast-attention`) confirmed: extension loads, `/prompt-agent/api/health`
  ok, one real txt2img generation recorded as `gen-1` / `gen-1-0` and returned by
  `/images/recent`.
- The `full` gate (`python tools/test_gate.py full`) is green as of the
  `read_image` closure (68.6s); rerun it before any delivery claim.

## Environment

- Pinned frontend toolchain: Node 22.17.0 + pnpm 10.12.4, e.g.
  `npx.cmd --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run <check|build|test>`.
  Global Node 24 / pnpm 11 are wrong. `python` is Windows Store Python 3.13.
- Forge output dir is `D:\AI\sd-webui-forge-neo\output` (singular).
- `list_recent_generations` can be verified live only after a Forge restart
  (extension code loads at startup).
