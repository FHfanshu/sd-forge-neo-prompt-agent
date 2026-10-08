# Hybrid prompting: tags, natural language, and the mix

Anima accepts Danbooru-style tags, natural-language captions, and any
combination. Free form is intentional — do not force every request into pure
tags or pure prose.

## When to use which

- **Tags** for countable, discrete visual facts: hair, eyes, clothes, props,
  medium, framing, franchise identity. When a concept maps cleanly to a
  Danbooru tag, use the tag rather than a long descriptive clause.
- **Natural language** for structure tags express poorly: spatial layout,
  multi-character positions, gaze and interaction, short action chains,
  scene intent, atmosphere.
- **Mixed** when both kinds of information are present. Lead with
  quality/meta/safety and core subject tags, then one or two short NL clauses
  for layout or relationship, then remaining detail tags.

## NL weight behavior

Natural language steers the image more strongly than an equal-looking tag
list, because it spends many more tokens on the same idea. Treat long NL as
high-weight, not neutral flavor text:

- If NL starts to drown the tags, shorten the sentences or convert repeated
  descriptors back into tags.
- Never pad with synonym-heavy prose to "make it stronger" — that is the
  fastest way to break a working prompt.
- Do not restate the same fact in both tag and NL form.

## NL requests are authoritative

If the user asks for NL, natural language, prose, or complete sentences, the
actual prompt must contain a real English NL block. Answering with prose in
chat while writing only tags into the prompt does not satisfy the request.

For an attached-image style transfer, normally write two to four short,
direct sentences covering the most important subject/scene relationship,
style, and composition — unless the user explicitly asked for tags only.

Each NL sentence should stay simple and concrete. Quality and artist tags may
precede natural language. For named characters, state the name first, then
describe the visible appearance.

## Editing hygiene

- Keep NL blocks, tags, special syntax (LoRA, wildcards, `BREAK`, weights),
  and unknown fragments independent while editing. Never split coherent prose
  at every comma, and never convert between pools unless the user asks.
- Deduplicate only exact/canonical duplicates within the same group. Never
  delete an NL block because it is semantically similar to another; report
  cross-pool repetition instead of silently removing it.
- Sorting normally affects only the tag pool. Stable order:
  identity/subject → composition/camera → pose/action → appearance/clothing
  → environment → lighting/color → style/quality → other. Preserve source
  order within a category, and never reorder NL blocks implicitly.
- Exclusions belong in a negative prompt, not as `no ...` prose in the
  positive prompt. And at CFG 1 (Turbo), remember the negative prompt is dead
  weight — see `model-variants.md`.

## Danbooru provenance

Danbooru canonical status and prompt compatibility are different things.
User-provided tags, existing prompt tags, autocomplete/auto-fill tags, and
model/extension/LoRA/wildcard-specific tokens are valid prompt input when
clear and intentional — preserve them even when a Danbooru lookup has no
match. Strict canonical verification is required only for explicitly
requested Danbooru cataloging, upload-ready output, or normalization. See
`danbooru-prompting` for the full methodology.
