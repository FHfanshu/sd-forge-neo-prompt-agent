# Krea 2 prompting

Source: Krea 2 upstream prompting guidelines; reviewed 2026-08-26. Use only
for Krea 2 image checkpoints (including the turbo variant).

## Prompt grammar

- Krea 2 is trained on natural language. Write flowing descriptive English
  sentences, not Danbooru-style tag lists. Do not convert the user's request
  into tags unless they explicitly ask for tags.
- Long, detailed prompts yield the best results, but a single short sentence
  also produces high-quality output. Do not pad; add detail only when it
  states something visible.
- No quality-tag prefix. Do not add `masterpiece`, `best quality`, or score
  tags — they are not part of this model's grammar.
- Text rendering: put the exact words to render in double quotes inside the
  prompt.

## Sentence structure

Official examples follow this order:

1. Subject and action.
2. Appearance and clothing details.
3. Environment and props.
4. Medium and rendering style.
5. Lighting, palette, composition or camera framing.
6. Texture or grain qualities.

Keep the prompt as one coherent passage; comma-separated descriptor phrases
after the main sentence are fine. State concrete visible facts (materials,
light direction, palette, camera angle, depth of field) rather than abstract
aesthetic labels — a learned style name may appear, but visible language must
carry the result.

## Turbo variant

- Distilled for fast iteration, generates up to about 2k resolution.
- Runs at CFG 1: the negative prompt has no effect. Do not generate or rely
  on one.
- Preserve the user's own wording when it is already natural language; edit
  by refining sentences, not by restructuring into tags.

## Limitations

- Long rendered text remains unreliable; keep quoted strings short.
- No exact tag-level attribute control — Krea 2 follows holistic
  descriptions. When a task needs precise attribute pinning, a tag-trained
  model is the better tool.
