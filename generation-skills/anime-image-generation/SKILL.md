---
name: anime-image-generation
description: Model-agnostic craft for designing anime/illustration images — subject decomposition, shot and composition design, visual hierarchy, pose and interaction, lighting, color, background, style choice, reference use, and iterative generation. Use when planning, describing, or iterating any anime-style image regardless of the image model, especially when the user asks for a scene, composition, mood, or "make this picture better" rather than a tag fix.
---

# Anime Image Generation

This skill designs the picture. The model skill (e.g. `anima-image-generation`)
decides how the chosen model hears the instructions. For Anima work, load both;
write the design first, then translate it into the model's grammar.

## Workflow

```text
goal → subject decomposition → shot design → visual hierarchy
     → write (in the model's grammar) → generate → inspect → refine
```

One design pass before writing the prompt prevents the most common failure:
a technically valid prompt that describes no coherent picture.

## Subject decomposition

1. **Primary subject**: who/what the image is about — identity, pose core,
   expression, what they are doing. One sentence: "X is doing Y in Z".
2. **Secondary subjects**: other characters or key objects, each with their own
   position and action relative to the primary.
3. **Environment**: setting, time of day, weather, props that support the
   story.
4. **Framing decision** (below) — which of the above actually fits the frame.

Cut anything the frame cannot show. A waist-up portrait does not need legwear
descriptors; a wide establishing shot does not need eyelash details.

## Shot design

Decide explicitly, then write it:

- **Framing**: close-up, bust, waist-up, full body, wide shot. Drives which
  body parts are visible and which details matter.
- **Angle**: eye level (neutral, default), low angle (dominance, height),
  high angle (vulnerability, overview), from behind, over-the-shoulder.
- **Orientation**: portrait vs landscape should follow the composition, not
  habit.
- **Depth**: foreground / midground / background layers; where the subject
  sits in them.

## Visual hierarchy

One image has one primary focal point (usually the face/eyes). Detail budget
follows hierarchy: spend tokens on the focal region, keep the rest
suggestive. Uniform detail across the whole prompt produces flat, busy
images. If everything is emphasized, nothing is.

## Pose and interaction

- Prefer poses with a clear readable silhouette.
- Hands are hard: prefer described, simple hand actions over complex
  finger configurations unless the shot demands it.
- Gaze direction is a composition tool: looking at viewer (engagement),
  looking away (narrative), looking at another character (relationship).
- Interactions need explicit who-does-what-to-whom. "They are talking" is not
  a prompt; "the left girl leans toward the right girl, whispering" is.

## Lighting

State three things: **direction** (front/side/back/rim), **quality** (soft
diffuse, hard directional, dappled), **color temperature or tint** (warm
sunset, cool overcast, neon accents). Backlight + rim light reads as drama;
flat front light reads as casual. Lighting must agree with the palette and
time of day, or the result looks pasted together.

## Color

Think in a palette: one dominant color area, one secondary, one accent.
Name the palette mood (warm, muted pastel, high-contrast saturated) rather
than listing disconnected colors. Colored lighting (sunset orange, moonlight
blue) is often more effective than recoloring objects.

## Background

- Simple/gradient/flat backgrounds keep focus on the character — the right
  choice for portraits and reference-style images.
- Environmental backgrounds must match the character's perspective and
  lighting; a mismatched background screams composite.
- For story images, choose background elements that support the narrative and
  cut the rest.

## Style

- Name the medium (`illustration`, `watercolor (medium)`, `flat color`) and
  rendering style before aesthetics — medium changes everything downstream.
- Artist influence: use verified artist tags where the model supports them
  (Anima needs the `@` prefix). Never guess an artist tag; verify with the
  Danbooru lookup tools.
- A learned style name is a hint, not an instruction — translate abstract
  aesthetics into concrete visible cues (see `anima-image-generation`,
  "Translating abstract aesthetics").

## References

When working from reference images, one reference answers one question. Name
which layer each reference controls (head, body, color, outfit, style) — see
`character-reference-sheet` for the reference-type discipline, and
`character-consistency` when a character must stay stable across images.

## Iteration

- Change one important variable per round; compare the new result against the
  goal and against the previous round. Use `image-generation-debugging` as
  the base loop.
- Keep rounds bounded; stop when the goal is met or a constraint (model
  capability, seed variance) is reached. Declare model limitations instead of
  looping on the same fix.

## References (files)

- `references/model-grammars.md` — which prompt grammar each model speaks;
  check before writing.
- `references/krea2-prompting.md` — Krea 2 checkpoints (pure natural language,
  no quality tags, turbo at CFG 1).
