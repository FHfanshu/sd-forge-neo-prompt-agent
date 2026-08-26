from __future__ import annotations

from pathlib import Path
from typing import Any


ANIMA_DIT_GUIDE = """# Anima DiT prompt guide

Source: https://huggingface.co/circlestone-labs/Anima
Reviewed: 2026-07-20

Use this guide only for Anima image checkpoints.

## Model variants
- Anima Base is flexible and neutral. It benefits most from explicit quality, style, subject, and composition guidance.
- Anima Aesthetic is already quality-tuned. `masterpiece, best quality` is safe, but score tags are optional; remove score tags and lower CFG if the result becomes noisy or over-detailed.
- Anima Turbo is distilled for fast iteration and normally uses CFG 1 and 8-12 steps. At CFG 1, classifier-free guidance reduces to the positive prediction and the negative prompt has no effect. Do not generate or rely on a negative prompt for the normal Turbo setup.

## Prompt grammar
- Anima understands Danbooru/Gelbooru-style tags, natural-language captions, and mixtures of both. Pure tags, pure short NL, or an organic mix are all valid; choose the form that states the scene most clearly.
- Write ordinary tags in lowercase and use spaces instead of underscores. Score tags such as `score_7` keep underscores.
- Preferred tag order: quality/meta/year/safety, subject count, character, series, artist, then general appearance/action/composition tags.
- Prefer verified Danbooru-style tags when inventing a new tag or when the user explicitly asks for Danbooru canonicalization. Danbooru is a reference taxonomy, not an allowlist for Anima prompts. User-provided tags, existing Forge prompt tags, Forge autocomplete or older auto-fill tags, and model/extension/LoRA-specific trigger tags are valid prompt input when they are clear and intentional; preserve them instead of rejecting or silently replacing them because a lookup has no match. Use the live Danbooru tag-group wiki to resolve ambiguity or produce an upload-ready canonical form: https://danbooru.donmai.us/wiki_pages/tag_groups
- Prefix artist tags with `@`, for example `@artist name`; without `@` the artist effect is weak.
- Prompt weighting works but usually needs stronger values than SDXL, for example `(chibi:2)`.
- Preserve wildcard references such as `__artist_names__`, dynamic choices, and LoRA tags such as `<lora:name:1>` exactly. Never expand, translate, rename, or reformat them unless the user explicitly asks.
- Anima uses a small Qwen3 0.6B text encoder. Assume limited comprehension: use simple tags or short, direct English clauses rather than sophisticated prose.
- Keep the final positive prompt well below 256 tokens whenever possible; 256 tokens is an absolute ceiling, not a target. A shorter prompt with clear subject, action, composition, and style is more reliable.
- Express one visual fact at a time. Avoid nested or dependent clauses, abstract relationships, implied references, long chains of interactions, repeated synonyms, exhaustive tag lists, and conflicting micro-details.
- For complex requests, keep only the highest-priority visible details. Do not try to preserve every instruction by compressing them into a dense paragraph.

## Translate abstract aesthetics into visible instructions
- Do not assume the text encoder understands the name of an aesthetic movement, era, design trend, or mood. Treat labels such as `Frutiger Aero` as brainstorming seeds, not complete prompt content.
- Brainstorm a broad candidate inventory before writing: characteristic scene objects, setting, shapes, materials, lighting, palette, atmosphere, and composition. This exploration should produce more options than the final prompt uses.
- Select the strongest compatible details for the requested scene and state them explicitly. For example, replace `Frutiger Aero elements` with concrete cues such as translucent aqua bubbles, glossy white plastic, saturated green grass, a clear cyan sky, soft sunbeams, water droplets, and clean rounded forms when those cues fit the scene.
- Do not use vague stand-ins such as `style elements`, `aesthetic atmosphere`, `retro-futuristic feeling`, or the movement name alone. A learned style name may remain as a secondary hint, but concrete visible language must carry the result.
- Keep brainstorming and final writing separate: explore freely, then deliver a selective, coherent, model-facing prompt rather than dumping every association.

## Tags, natural language, and mix
- Free form is intentional: tags, short NL, or both may appear in one prompt. Do not force every request into pure tags or pure prose.
- User format requests are authoritative. If the user asks for NL, natural language, prose, or complete sentences, include a real English NL block in the Forge prompt; do not answer with prose in chat while writing only tags. For an attached-image style transfer, normally use two to four short, direct sentences for the most important subject/scene relationship, style, and composition unless the user explicitly requests tags only.
- Natural language often steers the image more strongly than an equal-looking tag list because it spends more tokens on the same idea. Treat long NL as high-weight, not neutral flavor text.
- Prefer short NL for structure that tags express poorly: spatial layout, multi-character positions, gaze/interaction, and short action chains.
- Prefer tags for countable visual facts: hair, eyes, clothes, props, medium, framing, and franchise identity. When a concept maps cleanly to a Danbooru tag group, use the tag rather than a long descriptive clause.
- When mixing, lead with quality/meta/safety and core subject tags, then add at most one or two short NL clauses for layout or relationship, then remaining detail tags. Do not restate the same fact in both forms.
- If NL starts to drown tags, shorten the sentences or convert repeated descriptors back into tags. Never pad with synonym-heavy prose to “make it stronger.”

## Useful defaults
- Base positive prefix: `masterpiece, best quality, score_7, safe, `.
- Base/Aesthetic negative: `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`.
- Turbo negative prompts have no effect at CFG 1. Omit them. To make a negative prompt participate, CFG must be above 1, which departs from the recommended Turbo setup and may change or degrade its distilled behavior.
- Quality tags are optional on Aesthetic. Do not mechanically stack every score tag.
- Use `safe`, `sensitive`, `nsfw`, or `explicit` only when it matches the user's requested rating.

## Natural language and multi-character scenes
- Natural-language prompts may use two or more short sentences when needed, but each sentence should remain simple and concrete.
- Quality and artist tags may precede natural language.
- For named characters, state the name first and then describe the visible appearance.
- For multiple characters, state the exact count and give each character a position, appearance, pose, gaze, and interaction. Do not provide only a list of names.
- Prefer concrete spatial wording such as left, center, right, foreground, behind, facing the viewer, and looking at each other.

## Limitations
- Anima targets anime, illustration, and other non-photorealistic art; do not promise strong photorealism.
- Short or underspecified prompts can produce unwanted content. Add subject, appearance, composition, and an appropriate safety tag.
- Long rendered text is unreliable.
"""


FORGE_COUPLE_GUIDE = """# Forge Couple prompt guide

Source: https://github.com/Haoming02/sd-forge-couple
Verified against installed Forge Couple: 7.1.0 (commit c7884e8)
Reviewed: 2026-07-27

Use this guide when the user wants distinct characters or regional conditioning through Forge Couple. The installed version supports SD1, SDXL, and Anima.

## Authority and safe scope
- Build or edit the positive-prompt lines with `read_prompt` and hash-guarded `edit_prompt`.
- Do not claim Forge Couple is enabled, select its mode, change mappings, or alter its UI settings unless a dedicated live tool confirms that action. The current Prompt Agent tool surface edits prompt text but does not control Forge Couple settings.
- Ask the user to enable/configure Forge Couple when the requested mode or mapping cannot be confirmed.

## Choose the simplest mode
- Prefer Basic mode for ordinary side-by-side or stacked regions.
- Use Advanced mode only when explicit normalized boxes and weights are needed.
- Use Mask mode only when the user needs irregular drawn regions.
- The checkpoint must already understand the intended composition. Regional conditioning reduces attribute bleed but does not invent a composition the model cannot follow.

## Basic mode
- Split the positive prompt into one non-empty line per region. With an empty Couple Separator, a newline is the separator.
- Horizontal direction maps lines left to right. Vertical direction maps lines top to bottom.
- Repeat the total subject count and shared scene premise in every character region. This helps the checkpoint keep the full cast instead of generating one isolated subject per tile.
- Without Global Effect, provide at least two region lines. With First Line or Last Line Global Effect, include that global line as an additional line, so two character regions require three lines.
- Never leave a trailing or accidental empty line; empty lines count as regions.

### Two-character Anima example
Configure Basic mode, Horizontal direction, Global Effect = First Line, and the default newline separator:

```text
masterpiece, best quality, safe. 2girls standing side-by-side in a classroom, medium shot, soft daylight.
2girls, left girl, hatsune miku, turquoise twintails, facing viewer, relaxed smile.
2girls, right girl, kagamine rin, short blonde hair, white bow, looking at the left girl, cheerful expression.
```

Keep shared composition/style in the global line. Keep each character's identity, side, appearance, pose, gaze, and local action in that character's line. Do not repeat a distinctive attribute in both character lines.

## Separators and prompt syntax
- Default separator: newline. Do not insert `BREAK` merely to separate Forge Couple regions; `BREAK` is ordinary prompt content unless the Couple Separator is explicitly configured to match it.
- A custom separator may be a word or escaped newline sequence such as `\nbar\n` or `\n\n`. Preserve the configured separator exactly.
- Dynamic Prompts or other extensions that rewrite prompts can break separators or common-prompt expansion. Keep the structure simple and verify the final prompt lines.

## Common Prompts
- When the UI parser is set to `{ }`, define shared text once as `{common:shared prompt}` and recall it later as `{common}`. The `< >` parser works the same way when selected.
- Use a unique key and only one key per bracket pair.
- Example:

```text
3girls, hatsune miku, {common:vocaloid, casual clothes, looking at viewer, smile}, holding a sign.
3girls, kagamine rin, {common}, holding a sign.
3girls, kasane teto, {common}, holding a sign.
```

- Respect the `Include Definitions in Prompt` option: when disabled, the definition site is removed after expansion.

## Advanced mode
- Match each prompt line to exactly one mapping row.
- Each row uses normalized x start/end and y start/end in `0.0` through `1.0`, plus a weight from `0.0` through `5.0`.
- Cover the entire image with weighted regions. Add a full-canvas layer (`x 0.0-1.0`, `y 0.0-1.0`) when needed to prevent uncovered pixels.
- Keep line order synchronized with mapping-row order. Sending to img2img does not automatically transfer mappings; use the extension's Pull from txt2img control when appropriate.

## Mask mode
- Match the number and order of prompt lines to the saved mask layers, plus one line when Global Effect is enabled.
- Ensure every pixel receives weight. Only pure white pixels belong to a drawn mask; use Global Effect for reliable full-image coverage.
- Treat masks as broad conditioning regions, not pixel-perfect segmentation.

## Hires and validation
- The Compatibility toggle disables Forge Couple during the Hires Fix pass; do not describe it as general compatibility enhancement.
- If generation stops at the first step, inspect the Forge console for the extension's validation error.
- Common failures are too few Basic lines, line/mapping count mismatch, uncovered Advanced/Mask pixels, trailing empty lines, and prompt-rewriting extensions changing separators.
- For shape errors, enable Forge's `Pad prompt/negative prompt` optimization and use width/height divisible by 64, matching the extension's troubleshooting guidance.
"""


_DANBOORU_TAGS_GUIDE_PATH = Path(__file__).resolve().parents[1] / "docs" / "DANBOORU_TAGS_AGENT.md"


def _read_danbooru_tags_guide() -> str:
    return _DANBOORU_TAGS_GUIDE_PATH.read_text(encoding="utf-8")


PROMPT_SKILLS = {
    "anima_dit": {
        "name": "anima_dit",
        "title": "Anima DiT prompt guide",
        "guide": ANIMA_DIT_GUIDE,
        "source": "https://huggingface.co/circlestone-labs/Anima",
        "reviewed": "2026-07-20",
    },
    "danbooru_tags": {
        "name": "danbooru_tags",
        "title": "Danbooru tags agent reference",
        "guide": _read_danbooru_tags_guide(),
        "source": "https://danbooru.donmai.us/wiki_pages/tag_groups",
        "reviewed": "2026-07-12",
    },
    "forge_couple": {
        "name": "forge_couple",
        "title": "Forge Couple prompt guide",
        "guide": FORGE_COUPLE_GUIDE,
        "source": "https://github.com/Haoming02/sd-forge-couple",
        "reviewed": "2026-07-27",
        "version": "7.1.0",
    },
}


def normalize_prompt_skill_name(name: str) -> str:
    return str(name or "").strip().lower().replace("-", "_").replace(" ", "_")


def load_prompt_skill(name: str) -> dict[str, Any]:
    normalized = normalize_prompt_skill_name(name)
    skill = PROMPT_SKILLS.get(normalized)
    if skill is None:
        return {
            "ok": False,
            "name": normalized,
            "available": sorted(PROMPT_SKILLS),
            "error": f"unknown prompt skill: {normalized or name}",
        }
    return {"ok": True, **skill}


def automatic_prompt_skill(forge_preset: str = "", checkpoint: str = "") -> str:
    text = f"{forge_preset} {checkpoint}".casefold()
    return "anima_dit" if "anima" in text else ""
