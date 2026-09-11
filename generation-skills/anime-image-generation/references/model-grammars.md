# Model prompt grammars

Before writing any prompt, identify which grammar the model was trained on.
Writing tags into a natural-language model (or prose into a tag model) wastes
the model's strengths. `read_generation_parameters`-style metadata, the
checkpoint name, or the workflow's model loader usually answers this.

| Model family | Grammar | Quality tags | Artist tags | Weighting | Negatives |
| --- | --- | --- | --- | --- | --- |
| Anima (Base) | hybrid: Danbooru tags + NL | useful, don't stack | `@artist` prefix required | yes, stronger than SDXL, e.g. `(chibi:2)` | effective (CFG > 1) |
| Anima (Aesthetic) | hybrid | optional, prune if noisy | `@artist` | yes | effective |
| Anima (Turbo) | hybrid | — | `@artist` | yes | **dead at CFG 1** |
| Krea 2 | pure natural language | **none — not part of the grammar** | not tag-based | holistic only | dead at turbo CFG 1 |
| SD1.5 / SDXL anime merges | Danbooru tags | commonly useful | tag-form (no `@`) | `(tag:1.2)` | effective |

Rules of thumb:

- If the model is tag-trained, don't pad with prose. If it is NL-trained
  (Krea 2), don't convert the request into tags — refine sentences instead.
- "Turbo/distilled" variants usually run at CFG 1: no negative prompt, no
  exclusion claims.
- The full Anima grammar lives in `anima-image-generation`; the full Krea 2
  grammar lives in `references/krea2-prompting.md`.
- When switching checkpoints mid-task, re-check the grammar before editing
  prompts — do not carry habits from the previous model.
