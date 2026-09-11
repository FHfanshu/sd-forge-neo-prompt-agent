---
name: anima-image-generation
description: Prompting guide for Anima image checkpoints (Base / Aesthetic / Turbo) — hybrid Danbooru-tag + natural-language grammar, artist tags, prompt weighting, wildcards and LoRA triggers, multi-character scenes, abstract-aesthetic translation, and prompt length discipline. Use whenever writing, editing, reviewing, or debugging a prompt for an Anima checkpoint, even if the user just says "make the prompt better".
---

# Anima Image Generation

Source: the upstream Anima guide (huggingface.co/circlestone-labs/Anima,
reviewed 2026-07-20) plus accumulated personal generation experience.
Use this skill only for Anima checkpoints. For what the picture itself should
look like, use `anime-image-generation`; this skill is about how Anima hears
you.

## First: which variant?

Identify the variant before writing anything — the three variants want
different handling:

- **Base** — flexible and neutral. Benefits most from explicit quality, style,
  subject, and composition guidance.
- **Aesthetic** — already quality-tuned. `masterpiece, best quality` is safe,
  but score tags are optional; if the result gets noisy or over-detailed,
  remove score tags and lower CFG.
- **Turbo** — distilled for fast iteration, normally CFG 1 and 8–12 steps. At
  CFG 1 the negative prompt has **no effect**. Do not write or rely on a
  negative prompt for the normal Turbo setup.

Variant details and defaults: `references/model-variants.md`.

## Prompt grammar

- Anima understands Danbooru/Gelbooru-style tags, natural language, and any
  mix of both. Choose whichever form states the scene most clearly; see
  `references/hybrid-prompting.md` for the mix rules.
- Ordinary tags: lowercase, spaces not underscores (`blue hair`, never
  `blue_hair`). Score tags keep underscores (`score_7`).
- Preferred tag order: quality/meta/year/safety → subject count → character →
  series → artist → general appearance/action/composition.
- Artist tags need the `@` prefix (`@artist name`); without it the artist
  effect is weak.
- Prompt weighting works but usually needs stronger values than SDXL, e.g.
  `(chibi:2)`.
- Preserve wildcard references (`__artist_names__`), dynamic-prompt choices,
  and LoRA tags (`<lora:name:1>`) exactly. Never expand, translate, rename, or
  reformat them.
- Anima uses a small Qwen3 0.6B text encoder. Assume limited comprehension:
  simple tags and short, direct English clauses beat sophisticated prose.

## Length discipline

There is no 256-token ceiling. Current Anima builds typically work with about
512 token positions — but more room does not mean longer prompts are better.
A shorter prompt with clear subject, action, composition, and style is more
reliable. Before growing a prompt, prune, in this order:

1. Repeated synonyms ("smiling, grin, happy expression" → one).
2. Meaningless quality stacking (Aesthetic especially; don't stack every
   score tag).
3. Mutually conflicting descriptions.
4. Over-microscopic details the model cannot render anyway.
5. Complex relations the 0.6B encoder will not parse (nested clauses,
   "the X that the Y who once Z" constructions).

For complex requests keep only the highest-priority visible details; do not
try to preserve every instruction by compressing it into a dense paragraph.

## Translating abstract aesthetics into visible instructions

Do not assume the encoder understands the name of an aesthetic movement, era,
design trend, or mood. Treat labels like `Frutiger Aero` as brainstorming
seeds, not prompt content.

1. Brainstorm a broad candidate inventory first: scene objects, setting,
   shapes, materials, lighting, palette, atmosphere, composition. Produce more
   options than the final prompt uses.
2. Select the strongest **compatible** details for the actual scene.
3. State them explicitly: `Frutiger Aero elements` becomes translucent aqua
   bubbles, glossy white plastic, saturated green grass, a clear cyan sky,
   soft sunbeams, water droplets, clean rounded forms — when those fit.
4. Never use stand-ins like `style elements`, `aesthetic atmosphere`,
   `retro-futuristic feeling`, or the movement name alone. A learned style
   name may remain as a secondary hint, but concrete visible language must
   carry the result.
5. Keep brainstorming and final writing separate: explore freely, then deliver
   a selective, coherent, model-facing prompt — not a dump of every
   association.

## Multi-character scenes

State the exact count, then give each character a position, appearance, pose,
gaze, and interaction — never just a list of names. Use concrete spatial
wording: left, center, right, foreground, behind, facing the viewer, looking
at each other. For regional conditioning (per-region prompts), read
`references/multi-character.md` before building it.

## Useful defaults

- Base positive prefix: `masterpiece, best quality, score_7, safe, `.
- Base/Aesthetic negative: `worst quality, low quality, score_1, score_2,
  score_3, artist name, blurry, jpeg artifacts, chromatic aberration`.
- Turbo: no negative prompt (dead at CFG 1). To make negatives matter you must
  raise CFG above 1, which departs from the distilled setup and can degrade it.
- Quality tags optional on Aesthetic — never mechanically stack all score tags.
- Rating tags (`safe`, `sensitive`, `nsfw`, `explicit`) only when they match
  the requested rating. Short or underspecified prompts can produce unwanted
  content — always cover subject, appearance, composition, and an appropriate
  safety tag.

## Limitations

- Anima targets anime, illustration, and other non-photorealistic art. Do not
  promise photorealism.
- Long rendered text is unreliable.
- When a generation fails, classify it with `image-generation-debugging`
  before editing the prompt.

## References

- `references/model-variants.md` — Base / Aesthetic / Turbo differences,
  negative-prompt behavior, defaults.
- `references/hybrid-prompting.md` — tags vs natural language vs mixed, NL
  weight behavior, editing hygiene (dedupe, sort, pool preservation).
- `references/multi-character.md` — multi-character prompting and
  regional-conditioning principles.
