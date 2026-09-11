# Anima model variants

Source: upstream Anima guide (huggingface.co/circlestone-labs/Anima), reviewed
2026-07-20, extended with personal experience.

## Base

- Flexible and neutral starting point.
- Benefits most from explicit guidance: quality prefix, style direction,
  subject detail, and composition all need to be stated.
- Use the standard positive prefix and the standard negative prompt
  (see SKILL.md defaults).

## Aesthetic

- Already quality-tuned; quality tags are optional.
- `masterpiece, best quality` is safe to keep, but score tags are optional.
- If output becomes noisy or over-detailed: remove score tags and lower CFG
  before touching anything else. Over-stacked quality tags are a common cause
  of crunchy, over-sharpened results.

## Turbo

- Distilled for fast iteration. Normal setup: CFG 1, 8–12 steps.
- At CFG 1, classifier-free guidance reduces to the positive prediction, so
  the negative prompt has no effect at all.
- Therefore: do not generate, write, or "fix" a negative prompt for Turbo.
  Writing one wastes effort and misleads whoever reads the prompt into
  thinking exclusions are active.
- If a task genuinely needs exclusions, raise CFG above 1 — but understand
  this departs from the recommended Turbo setup and may change or degrade the
  distilled behavior. Prefer moving to Base/Aesthetic for that generation
  instead.

This is the same mechanism behind the general rule: a negative-prompt change
at CFG ≤ 1 is "changed but not effective". Never claim exclusions are active
without checking that CFG is actually above 1 in the current workflow.

## Rating and safety

- Use `safe`, `sensitive`, `nsfw`, or `explicit` only when it matches the
  user's requested rating.
- Short or underspecified prompts can drift into unwanted content. Cover
  subject, appearance, composition, and the safety tag explicitly.

## Checklist before blaming the prompt

When a Turbo generation ignores an exclusion, the first check is CFG, not the
negative text. When an Aesthetic generation is over-detailed, the first check
is quality-tag stacking, not the subject tags.
