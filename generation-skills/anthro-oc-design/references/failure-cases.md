# Anthro failure cases

Documented from real generations. Each case: symptom → diagnosis → repair
(change one layer) → what must stay untouched. The general rule: these are
`proportion` / `anatomy` failures in `image-generation-debugging` terms —
identity is not the problem, so identity is not rewritten.

## 1. Head-to-body collapse

- **Symptom**: the character targets 7–8 heads; the result is 5–6 heads —
  chunky, compressed torso, head reads oversized.
- **Diagnosis**: proportion failure. The model's prior for anthro/bara
  bodies (and chibi-adjacent cute priors) overrode the intended proportions.
- **Repair** (one layer — body proportion):
  - state proportions explicitly in the prompt (`tall, slender build, long
    legs, 8 heads tall` style descriptors the model responds to);
  - use a body reference with the correct proportions; avoid referencing
    chibi or stylized-cute images alongside;
  - check that no "chibi", "short", "compact" wording or a low-quality-tag
    style prefix is pulling the prior.
- **Untouched**: face identity, hair, horns, palette, outfit.

## 2. Thigh / hip exaggeration

- **Symptom**: legs far thicker than the design — thighs and hips swallow the
  silhouette while arms/torso match.
- **Diagnosis**: lower-body descriptor exaggeration plus muscular/female-hip
  priors; often reinforced by a reference image with heavy lower body.
- **Repair** (one layer — lower-body descriptors + muscularity):
  - replace generic `thick thighs`-adjacent wording with calibrated terms
    (`lean thighs`, `toned legs`, `slim hips` as fits the design);
  - align the overall muscularity descriptor with the target build;
  - swap or drop lower-body reference images that carry the bias.
- **Untouched**: everything above the waist, identity, outfit.

## 3. Back view over-muscularization

- **Symptom**: back view shows a dramatically more muscular character than
  the front view of the same version — traps, lats, and shoulders inflate.
- **Diagnosis**: bara priors are strongest in back-view training data; a
  muscular prompt written for the front carries extra weight here, and
  back-view references may be biased.
- **Repair** (one layer — muscular prompt + reference bias):
  - check whether the muscularity descriptor is present in the back-view
    prompt; if the design does not want it, remove or soften it;
  - add explicit silhouette calibration (`lean back, V-taper, defined but
    not bulky` — calibrated to the design);
  - verify the back-view body reference matches the front's build.
- **Untouched**: face/horn identity (not visible anyway), palette, markings,
  outfit.

## 4. Side view hunch

- **Symptom**: profile view shows a hunched spine — head juts forward, chest
  sunken, pelvis tucked.
- **Diagnosis**: anatomy/posture failure specific to side views; the model
  lacks a neutral standing profile prior for this body type.
- **Repair** (one layer — spine/neck/head placement):
  - add posture descriptors: `upright posture, straight spine, head held
    high, chest open, neutral standing pose`;
  - check chest and pelvis descriptors are not pulling the torso forward or
    backward;
  - a profile reference with neutral stance helps more than more tags.
- **Untouched**: front-view design, face identity, outfit.

## Pattern behind all four

None of these required touching immutable identity. The instinct to "fix" a
bad generation by rewriting the character produced five new problems every
time it was tried. Diagnose the layer, change one important variable,
regenerate, compare (`image-generation-debugging`).
