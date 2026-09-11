---
name: character-consistency
description: Diagnose and repair character drift between generations — decide which layer drifted (face identity, hairstyle, body proportion, outfit, palette, markings, or style) and repair only that layer with single-variable changes. Use whenever a generated character looks "off", doesn't match a previous version or reference, or when iterating an existing character across images, outfits, or model changes.
---

# Character Consistency

The core rule: **first decide which layer drifted, then repair only that
layer.**

A wrong generation is not "the character is wrong" — it is one layer being
wrong while the others are usually fine. Rewriting the whole prompt to fix
one layer is how one problem becomes five.

## Layers

```text
face identity        face shape, features, species markers
hairstyle            core style and color
body proportion      head-to-body, shoulder/hip, limb lengths, silhouette
outfit               clothing structure, colors, accessories
palette              main/secondary/accent colors
markings             placement and shape of characteristic marks
style                rendering style / medium (affects everything's look)
```

## Diagnosis

Compare the bad output against a known-good image (the character definition's
references), layer by layer, and state the verdict explicitly before editing:

```text
clothes correct  + body correct  + face wrong     → face-identity drift
face correct     + clothes correct + body wrong   → body/proportion drift
face correct     + body correct   + clothes wrong → outfit generation error
everything slightly different at once             → style drift or
                                                     wrong checkpoint/LoRA
```

## Repair: single-variable

Change **one** controlling variable per round, in this order of preference:

1. **Prompt layer** — the drifted layer's descriptors (calibrated wording,
   not more adjectives).
2. **Reference layer** — add/swap the reference that controls that layer
   (head reference for face, body reference for proportion, color reference
   for palette).
3. **Workflow layer** — LoRA selection/strength for the character, seed,
   CFG. These are inference settings; use them deliberately and record what
   was used.

Then generate and compare against the same known-good image. If the layer
did not move, escalate to the next preference; if it moved but something
else broke, revert and reconsider — that usually means the variable was not
the controlling one.

## Worked examples

**Example 1** — clothes correct, body correct, face wrong.
Only face identity may be touched: pull the head reference, re-assert
immutable face traits verbatim (species markers, eye color, hairstyle),
regenerate. Do not "improve" clothes or body while you are there.

**Example 2** — face correct, clothes correct, body proportion wrong.
Only body is touched: body reference + proportion/silhouette descriptors.
Face and outfit blocks stay byte-identical to the working prompt.

## Anti-pattern (named failure)

```text
generation fails
   ↓
rewrite the entire prompt
   ↓
five new problems
```

Never do this. It also destroys the ability to know what worked: after a full
rewrite there is no baseline to compare against. The single-variable loop is
slower per round and faster overall.

## After repair

When the repair succeeds, fold the fix back into the character definition or
reference set (update the asset or the identity block) so the same drift does
not need repairing next time. Repeated drift in the same layer usually means
the reference for that layer is missing or bad — fix the reference, not the
prompt, permanently.
