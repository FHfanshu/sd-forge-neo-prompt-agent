# SD Forge Neo Prompt Agent

Single-agent prompt assistant for Forge Neo. The browser owns the Pi agent loop
and keeps an IndexedDB session cache; Python owns durable synchronized chat
history, profiles, secrets, provider streaming, and privileged Forge tools.

Image reverse prompting is a separate sibling extension:
`sd_forge_reverse_prompt`.

## Features

- Floating assistant for composition, layout, and prompt rewriting
- Frontend Pi runtime: stream, reason, tool calls, abort, terminal recovery
- FIFO follow-ups while a response is active, with visible pause/resume recovery
- Python-authoritative Model Profiles (HTTP)
- Server-owned secrets; browser never receives plaintext keys or local paths
- Cross-browser sessions with a server-side SQLite authority and IndexedDB cache
- Interrupted-message recovery after refresh without request or tool replay
- Hash-guarded positive/negative prompt reads and edits
- Forge resource discovery: styles, wildcards, LoRAs, checkpoints, embeddings

## Architecture

API prefix: `/prompt-agent/api`.

| Layer | Owns |
| --- | --- |
| Browser | `PromptAgentRuntime`, UI, IndexedDB session cache, profile selection |
| Python | Durable session snapshots, profiles, secrets, provider proxy, Forge tools |

The server stores history but never owns or resumes agent execution. There is no
managed sidecar, execution lease, or refresh-time tool replay. Refresh keeps
partial content, marks unfinished messages `interrupted`, and never re-runs an
old request. Concurrent stale edits are retained as conflict-copy sessions.

Anyone who can use the Forge web UI can access synchronized Prompt Agent
history. Do not expose Forge to an untrusted network without authentication.

### Layout

```text
backend/prompt_agent/   # API, profiles, provider proxy, Forge tool validation
prompt_agent/           # shared leaf modules (i18n, resources, images)
scripts/                # Forge extension entry
frontend/               # Svelte 5 source (build only)
javascript/             # Forge-loaded browser scripts (incl. generated UI)
tests/                  # Python + small host-script checks; tests/run_suite.py
docs/                   # active product docs
docs/archive/           # KT migration history (not product surface)
data/                   # local runtime state (gitignored)
```

## Agent tools

The agent always has a small core surface plus a `load_tools` meta-tool; grouped
lookups stay hidden until the model requests them, so a request does not pay
schema and selection cost for tools it will not use.

Always available: `read_prompt`, `edit_prompt`, `read_generation_parameters`,
`apply_generation_parameters`, `generate_image`, `prompt_toolkit`, `load_skill`,
and `load_tools`.

Revealed on demand through `load_tools`:

| Group | Tools |
| --- | --- |
| `image` | `list_recent_generations`, `read_pnginfo`, `read_image` |
| `forge_resources` | `search_resources`, `inspect_resource` |
| `danbooru` | `search_danbooru_tags`, `inspect_danbooru_tags`, `related_danbooru_tags`, `search_danbooru_wikis`, `inspect_danbooru_wikis` |

Attachment turns reveal `image`, and background-lookup turns reveal
`forge_resources` and `danbooru`, automatically. Every revealed tool is
revalidated by Python, and Forge DOM access is host-gated. Write tools require a
fresh hash from a prior read. Non-empty prompt fields must use `patches` or
`diff`; a full `prompt` body is accepted only when the current field is empty.
`ask_teacher` is removed.

## Model profiles

Profiles define model ID, protocol, runtime (`remote-http`), endpoint,
capabilities, and generation parameters. Public APIs only expose safe status
flags (for example “has API key”). Browser requests cannot inject provider
endpoints, credentials, model identifiers, or paths into generation endpoints.

## License

[MIT License](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Historical KT/Terrarium runtime remains only on branch `kt` / tag `kt-final`.

## Verification

Pinned frontend toolchain: Node `22.17.0`, pnpm `10.12.4`.

Critical user behavior and cross-layer contracts are versioned in
`quality/acceptance.json`. Ordinary unit tests stay lightweight. The acceptance
gate detects stale high-level tests before they can force production code back
to an older design.

### Fast local loop

```powershell
python tools/test_gate.py affected
```

`affected` first checks acceptance versions and then runs tests mapped to the
changed boundaries. A stale acceptance test is reported and skipped during this
development loop instead of forcing an immediate production-code rollback.

### Frontend (when UI/source changes)

```powershell
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend install --frozen-lockfile
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run check
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run test
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run build
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run bundle:size
```

### Full / CI-equivalent

```powershell
python tools/test_gate.py full
```

The full gate blocks stale acceptance mappings, expired flaky-test waivers,
implementation regressions, generated-bundle drift, browser acceptance failures,
and bundle-budget failures. CI keeps its path-filtered jobs for parallel speed
but runs the same acceptance preflight before dispatching them.

When product behavior intentionally changes, review the current acceptance first:

```powershell
python tools/test_gate.py behavior-change UI-WINDOW-001
python tools/test_gate.py behavior-change UI-WINDOW-001 --bump
```

The bump intentionally makes mapped high-level tests stale until their assertions
are reviewed. Do not bump revisions for a bugfix that restores already-documented
behavior.

### Real Forge (local only)

Requires an already-running Forge Neo instance:

```powershell
npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm --dir frontend run test:e2e:forge
```

Or run the release gate, which adds coverage and real-Forge evidence:

```powershell
python tools/test_gate.py release
```

Optional: `FORGE_BASE_URL`, HTTP basic-auth vars, `FORGE_MODEL_PROFILE_ID`.
