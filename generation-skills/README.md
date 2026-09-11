# generation-skills

Personal anime image-generation skills, harvested from the archived
`sd-forge-neo-prompt-agent` project (2026-09-12). They are written for personal
use and are deliberately opinionated: they contain actual model judgments,
personal OC conventions, and hard-won failure cases, not neutral tutorials.

The goal: swap the agent runtime (Prompt Agent, ComfyTV, or anything else) and
these skills keep working.

## Skills

| Skill | Scope |
| --- | --- |
| `anima-image-generation` | How the Anima checkpoints hear prompts: variants, hybrid tag/NL grammar, weighting, artist tags, wildcards/LoRA, multi-character, prompt length discipline |
| `anime-image-generation` | How an anime picture itself should be designed: subject decomposition, composition, shots, hierarchy, pose, lighting, color, background, style; plus which prompt grammar each model speaks |
| `anime-oc-design` | OC lifecycle: initial design, outfit variation, age shifts, feature add/remove, simplification — with the immutable/semi-stable/variable trait model |
| `anthro-oc-design` | Anthro-specific anatomy and silhouettes (muzzle, horns, digitigrade, bara builds) plus documented failure-case repairs |
| `character-reference-sheet` | Multi-view reference sheets (portrait/front/side/back/three-quarter/expression) with stable identity, and what each reference image is actually allowed to control |
| `character-consistency` | Which layer drifted (face / body / outfit / palette / markings / style), and single-variable repair of only that layer |
| `image-generation-debugging` | The base method for every generation failure: 14-category taxonomy plus Observe → Classify → Locate → Change one variable → Generate → Compare |
| `danbooru-prompting` | Danbooru tag methodology: canonical status vs usable input, tagging order, classes, evidence boundary, group navigation, lookup discipline |

## Loading model

Skills use progressive disclosure. The agent always sees only `name` +
`description`; it reads `SKILL.md` when the skill triggers, and reads
`references/*.md` only when it needs the deeper knowledge. Keep long material
in `references/` — do not grow `SKILL.md` back into a single giant file.

```text
skill name + description
        ↓
SKILL.md (workflow + rules)
        ↓
references/ (deep detail, failure cases, per-model guides)
```

## Import order (do not install all eight at once)

Skills must be validated against real tasks, not pretty markdown. Import in
this order and verify each batch before adding the next:

1. `anima-image-generation`, `anthro-oc-design` — closest to the real daily
   workflow.
2. `character-reference-sheet`, `character-consistency`, `image-generation-debugging`.
3. `anime-image-generation`, `anime-oc-design`, `danbooru-prompting`.

Validation examples: tags / NL / mixed prompts, complex composition, abstract
aesthetics, two characters; OC initial design, clothes variation, portrait /
front / side / back, body repair, identity repair; dragon, mature male, bara,
muzzle, horns, proportion, tail, different outfits.

Acceptance bar: a different agent model, given only these skills plus the
runtime tools (e.g. ComfyTV + `danbooru-tools`), completes those tasks stably.

## Provenance

- `anima-image-generation`: from `prompt_agent/prompt_skills.py`
  (`ANIMA_DIT_GUIDE`, upstream Anima guide reviewed 2026-07-20), plus the
  agent system prompt's NL/style-transfer rules and the prompt toolkit's
  editing methodology. The old "256 tokens absolute ceiling" rule is
  intentionally deleted: current Anima builds work with roughly 512 token
  positions, and length discipline is now "prune, don't cap".
- `anime-image-generation`: new model-agnostic layer, plus the harvested Krea 2
  guide as a model-grammar reference.
- `anime-oc-design`, `anthro-oc-design`, `character-reference-sheet`,
  `character-consistency`, `image-generation-debugging`: distilled from the
  Sunset/Harvest PRD (sections 7–11), which encodes the personal OC workflow
  and its real failure cases.
- `danbooru-prompting`: from `docs/DANBOORU_TAGS_AGENT.md` (Danbooru wiki
  sources retrieved 2026-07-12), generalized; tool names now point at
  `../danbooru-tools` instead of Forge host tools.

Forge-only material (Forge Couple mechanics, PNGInfo bridge, Forge prompt
editor glue) was deliberately not migrated.
