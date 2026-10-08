# Repository Rules

Forge Neo extension: a docked Chinese agent panel that reads and edits prompts and
generation parameters. The agent never generates images. Keep changes small and auditable.

## Source of truth

- `docs/V2_SPEC.md` defines behavior, interfaces, data, security, performance and visual
  rules. `docs/V2_PLAN.md` records scope and decisions. Update the spec in the same change
  when behavior changes intentionally.
- Security invariants (spec §8) are hard rules: API keys only decrypted in Python for the
  request that needs them; the browser never chooses upstream URLs, file paths or the model;
  no tool replay after refresh; no image generation by the agent.

## Layout

- `scripts/prompt_agent.py`: Forge hook only (mounts routes on app start).
- `prompt_agent/`: Python package. Do not name anything `backend` or `scripts` (Forge owns
  those top-level names). Forge imports stay lazy inside `prompt_agent/forge.py` so tests run
  without Forge.
- `frontend/`: Svelte 5 + Vite source. `javascript/prompt_agent.js` is the generated bundle;
  never edit it by hand, rebuild it.
- Forge DOM selectors live only in `frontend/src/forge/dom.ts` and `frontend/src/forge/params.ts`.
- `generation-skills/`, `character-definitions/`, `danbooru-tools/` are content and a shared
  library used read-only.
- Source files: aim for ≤ 400 lines, hard limit 1000 (generated bundle excepted).

## Toolchain

- Python tests use Forge's venv: `..\..\venv\Scripts\python.exe -m unittest discover -s tests`.
- Frontend uses Node `22.17.0` and pnpm `10.12.4` (pinned in `frontend/`). Without a version
  manager run from `frontend/`:
  `npx --yes --package node@22.17.0 --package pnpm@10.12.4 pnpm <install --frozen-lockfile | run check | run test | run build>`.
- Keep the pnpm store in `frontend/.pnpm-store/`; never commit it or `node_modules/`.

## Verification

- Before committing: Python tests, `pnpm run check`, `pnpm run test`, `pnpm run build`.
- For UI or Forge-DOM changes, also check the real panel in a running Forge Neo.
- Every turn-ending path (done, stop, error, refresh) must leave the composer usable.
- Add a focused regression test for each bugfix where the boundary is testable.

## Git

- Small verified commits; inspect `git status --short` and `git diff --stat` first and stage
  only the files of the current change. Never commit `data/`.
