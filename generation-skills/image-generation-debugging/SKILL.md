---
name: image-generation-debugging
description: Base debugging method for any image-generation failure — a 14-category error taxonomy (identity, composition, anatomy, proportion, pose, interaction, style, color, lighting, background, reference conflict, prompt conflict, conditioning, model limitation) and the loop Observe → Classify → Locate the controlling layer → Change one important variable → Generate → Compare. Use whenever a generation result is wrong, in any image model, as the foundation under the specialized skills.
---

# Image Generation Debugging

This is the base method every generation agent should follow. Specialized
skills (`character-consistency`, `anthro-oc-design` failure cases,
`anima-image-generation`) provide domain-specific repairs; this skill defines
the loop they all plug into.

## The loop

```text
Observe
  ↓
Classify
  ↓
Locate the controlling layer
  ↓
Change one important variable
  ↓
Generate
  ↓
Compare
```

1. **Observe** — describe what is wrong in factual, visual terms. "The
   character's head is too large relative to the torso", not "it looks bad".
   Compare against the goal and, when iterating, against the previous round.
2. **Classify** — assign one primary category from the taxonomy below. If two
   categories genuinely apply, fix the one that causes the other first.
3. **Locate the controlling layer** — which input controls this failure:
   prompt wording, a reference image, negative prompt, LoRA/weights, seed,
   CFG/steps, resolution, or the model's own limits.
4. **Change one important variable** — one. Changing five things makes the
   next comparison meaningless.
5. **Generate** and **Compare** — against the previous round, not just the
   goal. Did the targeted layer move? Did anything else regress?
6. Repeat with bounded rounds. Stop when the goal is met; stop and change
   approach (different model, different composition, user consult) when the
   same category survives two targeted fixes — that is usually a model
   limitation, not a prompt bug.

## Error taxonomy

| Category | Looks like | Typical controlling layer |
| --- | --- | --- |
| identity | wrong face / wrong character | face descriptors, head reference, trigger word, LoRA |
| composition | bad framing, subject placement, crowding | shot/composition tags, aspect ratio |
| anatomy | extra/missing limbs, broken hands, merged bodies | pose complexity, model capability, resolution |
| proportion | head/body ratio off, oversized parts | proportion descriptors, body reference, style priors |
| pose | impossible or ambiguous pose | pose tags, simplify the pose |
| interaction | unclear who does what to whom | interaction wording, per-character blocks |
| style | wrong medium/rendering, style mixing | style tags, artist tags, checkpoint choice |
| color | palette drift, color bleed | palette descriptors, colored lighting, reference conflict |
| lighting | inconsistent direction/shadows | lighting descriptors, time-of-day tags |
| background | perspective mismatch, cluttered scene | background descriptors, cut elements |
| reference conflict | outputs average of two conflicting references | reduce to one reference per layer; resolve explicitly |
| prompt conflict | contradictory descriptors cancel or average | prune the contradicting term (e.g. `chibi` + `mature`) |
| conditioning | exclusion/weight not taking effect | CFG (dead negative at CFG 1), weight values, activation |
| model limitation | same failure across varied inputs | change approach, not the prompt again |

Classification hints:

- Present in every generation regardless of seed → prompt conflict,
  conditioning, or model limitation.
- Present sometimes → seed/variance around a weak descriptor; strengthen the
  controlling descriptor or add a reference.
- Appeared after a change → the change. Revert or repair it before hunting
  elsewhere.

## Specialized skill routing

- Character looks "off" between images → `character-consistency` (layer
  diagnosis + single-variable repair).
- Anthro proportion/posture failures (head-body collapse, thigh
  exaggeration, back-view bulk, side-view hunch) → `anthro-oc-design`
  failure cases.
- Prompt-side issues on Anima (weighting, NL weight, dead negatives) →
  `anima-image-generation`.
- Tag validity questions → `danbooru-prompting`.

## Bounds and honesty

- Keep iteration rounds bounded and say what each round changed. A silent
  chain of regenerations is not debugging.
- Do not claim a fix worked without comparing the output. "I adjusted the
  prompt" is not evidence.
- When declaring a model limitation, state the evidence: the same failure
  category survived which targeted fixes.
