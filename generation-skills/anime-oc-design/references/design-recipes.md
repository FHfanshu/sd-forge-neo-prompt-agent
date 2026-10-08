# OC design recipes

## Initial design brief template

Fill this before writing any prompt. Keep it in the character definition.

```text
name:
species / type:
one-line identity:
immutable anchors:  (face, hair, eyes, species features, markings, palette)
semi-stable:        (build, accessories, minor markings)
default outfit:
trigger word(s):
references:         (portrait / front / side / back / expression ...)
```

The prompt for a first design should describe the design itself, not a
masterpiece hunt: identity anchors first, then outfit, then one clear pose
and a neutral background. Save the stylized hero shots for after the
reference set exists.

## Outfit-variation prompt skeleton

Structure the prompt as three blocks and only the third changes:

```text
[identity block — copied verbatim from the character definition]
[shared scene/composition block — shot, lighting, mood]
[outfit block — the only block you are allowed to redesign]
```

For Anima-style hybrid prompts, the identity block is tags; the scene block
can be one short NL sentence; the outfit block is tags plus, if needed, one
short NL clause for how the outfit sits.

Sanity check after writing: diff the identity block against the character
definition. Any difference there is a bug, not creativity.

## Age-shift checklist

- Decide the target age band first (child / teen / adult / mature) — this
  sets proportions and detail level.
- Proportions: younger = larger head-to-body ratio, smaller nose/muzzle
  detail, shorter limbs. Older adult = longer limbs, more defined features.
- Adjust semi-stable only: body definition, hairstyle detail, accessories.
- Face identity must remain recognizable across all ages. If the face
  changed beyond maturity cues, that is drift — repair it.
- Clothing and pose should match the age band (a child version in adult
  clothing reads wrong even with correct proportions).

## Feature add/remove (version bump)

1. Name the feature and the layer it belongs to (usually semi-stable:
   horns/ear shape changes are identity-level; accessory additions are not).
2. Generate one isolated test image (neutral pose, simple background) that
   shows the feature against known-good identity.
3. Only after the test passes, adopt it into the character definition and
   reference set.
4. Record the version note: "v2: added Glasses" style.

## Reference preparation

Before batch-producing a character's images, ensure in this order:

1. A portrait that locks face identity.
2. Front + side + back full-body (see `character-reference-sheet`).
3. One outfit-locked image per canonical outfit.
4. Asset tags applied: `character:<name>`, `view:...`, `outfit:...`.

A character definition without view-consistent references will drift the
first time a different model or prompt style touches it.
