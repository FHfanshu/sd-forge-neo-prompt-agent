---
name: character-reference-sheet
description: Generate consistent multi-view character reference sheets — portrait, front, side, back, three-quarter, and expression sheets — with stable identity, proportions, scale, palette, and markings; plus the discipline of what each reference image is allowed to control (head/body/color/outfit/style). Use when producing character turnarounds, model sheets, reference sets, or any "give me views of this character" task.
---

# Character Reference Sheet

## View menu

| View | Locks / shows |
| --- | --- |
| portrait | face identity, hair, expression baseline |
| front | full-body proportions, symmetry, palette, markings |
| side (profile) | skull/muzzle silhouette, spine posture, depth of body |
| back | back markings, hair from behind, back musculature, tail base |
| three-quarter | the "hero" angle; bridges front and side |
| expression sheet | same head, many expressions; identity must survive each |

Standard order: portrait → front → side → back → three-quarter → expressions.
Approve each view before generating the next; every later view reuses the
approved prompt and changes only the view tags.

## Hard requirements (every view)

```text
same character
same proportions
same scale
neutral pose
consistent palette
consistent markings
orthographic-like
low perspective distortion
clean background
```

A reference sheet is documentation, not art. Drop dramatic lighting, dynamic
poses, and heavy stylization — anything that hides structure makes the
reference less usable later.

## Generation strategy

- Build the first view as a clean, neutral, well-lit image; treat it as the
  identity anchor.
- For each subsequent view, change **only** the view/composition tags from
  the approved prompt. If a new view regresses identity, suspect the changed
  tags first, then the model's priors for that angle (see
  `anthro-oc-design` failure cases for back/side view biases).
- Per-view pitfalls:
  - **back view**: face is invisible — identity is carried by hair shape,
    body proportions, palette, and markings. Verify those against the front.
  - **side view**: the profile silhouette is the identity carrier (muzzle,
    skull, posture). Watch for hunching; keep a neutral-spine descriptor.
  - **expressions**: change only expression tags; any change to hair, eyes,
    or markings during an expression sheet is drift.
- Generate at one consistent resolution/aspect for all body views; mixing
  scales breaks the sheet.

## Reference hygiene: one image, one job

A reference image should never be treated as answering everything. Classify
every reference by what it genuinely controls:

```text
Head Reference   — face identity, hairstyle, expression baseline
Body Reference   — proportions, build, digitigrade/plantigrade, silhouette
Color Reference  — palette, marking placement
Outfit Reference — clothing structure and details
Style Reference  — rendering style / medium / line quality only
```

When composing a generation from multiple references, name which layer each
one controls and resolve conflicts explicitly (e.g. outfit reference with a
different body type: take clothes, not proportions). A reference that mixes
layers silently is the main source of "reference conflict" failures — see
`image-generation-debugging`.

## Asset conventions

Store each approved view as a separate asset (e.g. ComfyTV Asset Library)
tagged:

```text
character:<name>
view:<portrait|front|side|back|three-quarter|expression>
outfit:<name>       (when not the default outfit)
```

Character definitions reference these tags, not copies. Workflow: after the
sheet is approved, record the minimal definition update per
`anime-oc-design` (name, triggers, references, short description).
