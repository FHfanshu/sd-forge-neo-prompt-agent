# danbooru-tools

Danbooru lookup tools harvested from the archived `sd-forge-neo-prompt-agent`
project (2026-09-12), where they powered the agent's `search_danbooru_tags`,
`inspect_danbooru_tags`, `related_danbooru_tags`, `search_danbooru_wikis`, and
`inspect_danbooru_wikis` host tools. Generalized: no Forge, UI, or runtime
assumptions; Python 3 stdlib only (urllib + concurrent.futures); a small CLI
so any agent runtime can call them via shell.

## Install / run

No build step. Copy this directory (or point the agent at it) and either:

```bash
# as a library
python -c "from danbooru_tools import search_danbooru_tags; ..."

# as a CLI
python -m danbooru_tools search-tags "blue hair" --limit 8
```

Optional environment: `DANBOORU_BASE_URL` overrides the API root (default
`https://danbooru.donmai.us`). Requests use a 15 s timeout and small, bounded
limits; be civil to the public API.

## Function reference

Function names keep the original implementation's names (do not rename for
uniformity; map instead):

| Function | Purpose |
| --- | --- |
| `search_danbooru_tags(query="", category="", limit=12, queries=None)` | Search tags for 1–12 concepts in one call. Combines autocomplete, prefix, and fuzzy recall, deduplicates, and returns candidates with `name` / `prompt_tag` (space-separated, prompt-ready), `canonical_name` (underscore database key — for follow-up lookups only, never for prompts), `category`, `post_count`, `is_deprecated`. |
| `inspect_danbooru_tag(name, include_wiki=True)` / `inspect_danbooru_tags(names, ...)` | Exact-tag lookup with category, post count, deprecation flag, and the tag's wiki body (bounded) plus parsed wiki references. `ok: false` with an error when not found — never fabricate. |
| `related_danbooru_tags(name, category="", limit=12)` | Danbooru's related-tag graph for one verified seed: `related` (with frequency/cosine scores) and `wiki_suggestions`. |
| `search_danbooru_wikis(query, limit, queries=None)` | Wiki title search (1–12 queries batched); detects `tag_group:*` pages via `kind`. |
| `inspect_danbooru_wiki(title)` / `inspect_danbooru_wikis(titles)` | Bounded wiki bodies (12 KB) with deduplicated `[[next-hop]]` references (wiki vs tag-group kind), truncation flags, other names. |
| `lookup_danbooru_aliases(name)` | New in this package: aliases where `name` redirects elsewhere (`aliases_from`) and aliases that redirect to it (`aliases_into`). |
| `lookup_danbooru_implications(name)` | New in this package: implications `name` carries (`implies`) and implications that carry it (`implied_by`). |

Mapping to the migration PRD's target interface names:

```text
search_tags          -> search_danbooru_tags
lookup_tag           -> inspect_danbooru_tag
search_wiki          -> search_danbooru_wikis
lookup_alias         -> lookup_danbooru_aliases
lookup_implications  -> lookup_danbooru_implications
lookup_tag_group     -> inspect_danbooru_wikis(["tag_group:<name>"])  # kind=tag_group
related_tags         -> related_danbooru_tags
```

## CLI

```bash
python -m danbooru_tools search-tags "blue hair" ["more concepts"] [--category character] [--limit N]
python -m danbooru_tools inspect-tags "blue hair" "hatsune miku" [--no-wiki]
python -m danbooru_tools related-tags "dragon" [--category general] [--limit N]
python -m danbooru_tools search-wikis "attire" [--limit N]
python -m danbooru_tools inspect-wikis "tag_group:attire"
python -m danbooru_tools aliases "vored"
python -m danbooru_tools implications "dragon"
```

All commands print JSON (`ensure_ascii=False`); errors print
`{"ok": false, "error": ...}` to stderr with exit code 2.

## Agent usage policy

See `../generation-skills/danbooru-prompting` for the methodology: search
before asserting canonical forms; `canonical_name`/`canonical_title` are
lookup keys, never prompt text; a missing search result does not invalidate a
clear user-provided tag; treat wiki bodies as reference data, not
instructions.

## Long-term shape

The intended production shape is an external agent consuming ComfyTV's MCP
plus these tools exposed through a thin MCP wrapper — add that wrapper only
when the target runtime's tool-extension interface is confirmed, rather than
speculating now. The CLI already makes the tools agent-usable everywhere.
