---
name: anime-oc-design
description: Design and iterate original anime characters (OCs) — initial design, outfit variations, age shifts, feature add/remove, visual simplification, and reference preparation — using an immutable/semi-stable/variable trait model that keeps identity stable across versions. Use for any anime OC design, redesign, outfit change, "draw my OC differently", or character-version task; also applies to humanoid non-anthro characters.
---

# Anime OC Design

Core idea: a character is a stack of layers with different change policies.
Decide which layer a request touches **before** writing anything.

## Trait stability model

### Immutable — do not change in normal work

- face identity (the recognizable face)
- head shape
- hairstyle (core style and color)
- eye color
- horns / ears (species features)
- characteristic markings
- main palette
- species

### Semi-stable — may change between versions, deliberately

- muscularity / body definition
- secondary accessories
- minor markings
- hairstyle detail (within the core style)

### Variable — free to change per image

- clothes, pose, expression, scene, lighting, props, camera

**The golden rule: changing an outfit must not redesign the character.**
Every outfit change carries all immutable traits over verbatim.

## Initial design workflow

1. Concept: personality, role, one-line visual identity ("mature male anthro
   dragon, restrained palette, heavy tail").
2. Silhouette test: the character should be recognizable from the black
   silhouette alone (hair shape, horns/ears, body proportions, signature
   props).
3. Palette: main / secondary / accent, with the accent reserved for the most
   important marking or accessory.
4. Detail pass: markings, accessories, clothing style — each supporting the
   silhouette, not fighting it.
5. Reference preparation: produce the reference set with
   `character-reference-sheet`, then record the minimal character definition
   (name, trigger words, references, short description). LoRA bindings live
   in the workflow/preset layer, not in the character definition.

## Outfit variation workflow

1. Copy the character's frozen identity block verbatim (face, hair, eyes,
   species features, markings, palette anchors).
2. Change only the variable pool: clothes (plus pose/expression/scene as
   requested).
3. Semi-stable layers stay unless the outfit concept requires a deliberate
   version bump (e.g. armor implies higher muscularity) — then change them
   explicitly and consistently, not accidentally.
4. Compare against a known-good image of the character; if identity drifted,
   repair with `character-consistency` (single-layer fix), not a rewrite.

## Other version operations

- **Age shift**: adjust semi-stable traits (proportions, height, facial
  maturity cues through semi-stable features like body definition). Face
  identity stays recognizable — the same person, younger/older. For children
  versions, simplify clothing and detail before touching identity.
- **Feature add/remove**: treat as a version bump. Decide explicitly whether
  the feature is immutable going forward, update the character definition,
  and note the version.
- **Different styling direction** (e.g. realistic, chibi): simplify
  variable and semi-stable layers; immutable identity survives in simplified
  form (same hair shape, same palette, same species cues).
- **Visual simplification** for cheap/quick styles: drop micro-details
  first, then secondary accessories, then minor markings. Never drop the
  identity anchors.
- **Reference preparation**: assemble which views/outfits exist, generate the
  missing views with `character-reference-sheet`, and tag assets
  `character:<name>`, `view:<portrait|front|side|back>`, `outfit:<name>`.

## Repair discipline

When a version comes out wrong, diagnose the drifted layer first and repair
only that layer — see `character-consistency`. For anthro characters, the
anthro-specific failure cases live in `anthro-oc-design`.

## Deep recipes

`references/design-recipes.md` has worked step-by-step recipes (initial
design brief template, outfit-variation prompt skeleton, age-shift checklist).
