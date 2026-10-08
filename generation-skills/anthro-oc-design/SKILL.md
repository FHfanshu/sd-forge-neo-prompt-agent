---
name: anthro-oc-design
description: Design and repair anthro/furry characters — muzzle, ears, horns, facial balance, head-to-body ratio, shoulders, torso, waist/hip, limbs, paws vs hands, tail, digitigrade vs plantigrade, fur/scales/skin, and masculine/bara builds — with documented failure-case repairs (proportion collapse, thigh exaggeration, back-view over-muscularization, side-view hunch). Use for any anthro OC design, generation, or repair task, including dragons and other scaled/feathered characters.
---

# Anthro OC Design

Pairs with `anime-oc-design`: the immutable/semi-stable/variable trait model
and repair discipline apply unchanged. This skill covers what is
anthro-specific, plus real failure cases with their repairs.

## Facial anatomy

- **Muzzle**: length and angle carry species identity. Canine = medium, blunt;
  dragon/reptile = longer, often with nostril bumps or ridges; feline = short,
  small. A too-short or missing muzzle on a dragon reads as a human with
  horns — treat that as identity failure, not style choice.
- **Ears**: position follows the skull, not hair. Species features (dragon
  frills, long ears, small round ears) are immutable anchors.
- **Horns**: count, curvature, and base position are identity. Pairs must be
  symmetric unless the design says otherwise.
- **Facial balance**: the anthro face needs a deliberate animal-to-human
  ratio. Symptoms of imbalance: human nose on animal skull, eyes placed too
  far forward, jaw too human. Fix by strengthening the species markers
  (muzzle, skull shape, ear placement), not by adding more human traits.

## Body architecture

- **Head-to-body ratio**: target 7–8 heads for mature characters. 5–6 heads
  from a mature-male prompt is a **proportion failure** — see failure cases.
- **Shoulders**: width drives masculine silhouette. Set shoulder width
  relative to head width explicitly in the design (e.g. "broad, ~3 head
  widths") rather than trusting adjectives alone.
- **Torso / waist / hip**: decide the torso shape early (V-taper, straight,
  heavyset). Anthro bodies inherit species leg structure; keep waist/hip
  consistent with digitigrade or plantigrade choice.
- **Digitigrade vs plantigrade**: pick one and keep the whole leg consistent
  (thigh, knee direction, hock, foot shape). Mixing them in one character is
  a common anatomy failure. Digitigrade adds visual height and a distinctive
  silhouette — note it in the identity block.
- **Paws vs hands**: forepaw design (pads, claws, digit count) is identity;
  how they are drawn per image is variable. State which in the definition.
- **Tail**: base position (tailbone base, not lower-back float), thickness
  profile, length relative to body. The tail is part of balance and
  silhouette — give it a default resting behavior in the design (e.g.
  "thick, hangs low, slight curl at the tip").

## Surface

- Fur / scales / smooth skin: choose per body region if mixed (e.g. scales
  along back and tail, smoother front) and keep the mix consistent across
  versions.
- Markings follow body structure (stripes wrap the limb, belly color follows
  the underside). Markings that ignore the underlying anatomy read as decals.

## Masculine / bara builds

- Vocabulary that works: broad shoulders, defined traps and delts, heavy
  chest, thick forearms and upper arms, visible obliques, strong calves.
- Bara priors are strong in anime models: without explicit counterweights,
  muscularity inflates, especially in back and thigh regions (see failure
  cases).
- Keep the neck integrated: a bara neck that starts from the ears destroys
  the muzzle silhouette.
- Muscularity is a semi-stable trait — a version bump changing it is
  legitimate, but change it deliberately, not as a side effect of a back-view
  prompt.

## Species grammar (Danbooru terms)

Dragons and similar: `dragon, scalie, anthro` + horn/tail/wing descriptors
(`wings` only if the design has them; back wings are a common surprise
addition — exclude explicitly if unwanted: add to negative prompt or state
`no wings` in workflow terms that the model honors). Scales + fur mixing is
legitimate but must be region-consistent.

## Failure cases

Real cases with diagnoses and single-layer repairs live in
`references/failure-cases.md`. Read them before repairing any anthro
proportion or posture failure — the fix is usually one layer (proportion,
lower-body descriptors, muscularity, or spine), never a character rewrite.
