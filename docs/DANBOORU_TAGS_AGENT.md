# Danbooru Tags Agent Reference

Purpose: produce, normalize, review, or explain Danbooru-compatible image tags when that taxonomy is requested. This is a compact operational index, not a universal allowlist for prompt tags and not a replacement for a tag's own live wiki page.

Sources retrieved 2026-07-12:

- https://danbooru.donmai.us/wiki_pages/help:home
- https://danbooru.donmai.us/wiki_pages/howto%3Atag
- https://danbooru.donmai.us/wiki_pages/tag_groups

## Operating Contract

Use this reference only when the user explicitly asks for Danbooru, Gelbooru, booru tags, tag normalization, tag review, tag-style prompts, or tag-wiki guidance. Do not force tag syntax into an ordinary natural-language prompt unless requested. Natural-language prompts do not need a Danbooru lookup; keep them direct and visually clear.

Danbooru canonical status and prompt compatibility are different things. User-provided tags, tags already present in Forge, tags copied from Forge autocomplete or older auto-fill, and model-, extension-, LoRA-, or wildcard-specific prompt tokens are usable input when they are clear and intentional. Preserve their spelling and meaning unless the user asks for normalization. A term missing from the current Danbooru index is not thereby invalid, and it must not by itself cause a refusal or a claim that the term is a “non-standard tag”. If the distinction matters, say that it was not found in the current Danbooru index and offer canonicalization; do not silently delete it.

There is a mandatory preflight gate only for strict Danbooru cataloging, upload-ready output, or explicit Danbooru normalization: extract 2-12 short English visual concepts from the user's request and make one `search_danbooru_tags` call with `queries`. For ordinary image-generation prompts and prompt edits, lookup is optional and is used for ambiguity or canonicalization, not as an allowlist. Do not let a missing or failed lookup block a clear user-requested tag.

For tag output:

1. Describe visible facts only. Do not tag facts known from canon, filenames, metadata, or prior context unless they are visible or the user explicitly asks for catalog metadata.
2. When creating or canonicalizing a new Danbooru tag, prefer an established canonical tag and do not invent a plausible Danbooru name. This rule does not override the provenance rule above: retain a clear user or existing-prompt tag even when it is not indexed by Danbooru.
3. Output lowercase, space-separated terms in a comma-separated list for Anima prompts. Never copy Danbooru's underscore database keys to the prompt: output `blue hair`, not `blue_hair`; output `black rock shooter (character)`, not `black_rock_shooter_(character)`.
4. The lookup tools return `name` and `prompt_tag` in prompt-ready space-separated form. `canonical_name` contains the underscore database key solely for a follow-up lookup; never reproduce it in prompt text.
5. Use singular object nouns when creating or normalizing a general tag: `wispberry`, not `wispberries`.
6. Do not use subjective tags such as `sexy`, `cute`, or `hot`. They express opinion rather than a stable visual fact.
7. For strict cataloging, do not duplicate tags or add synonymous near-duplicates; prefer the most specific verified tag and retain broader tags only when they independently convey useful information. For ordinary prompt editing, do not deduplicate, rewrite, or replace user-provided tags unless asked.
8. Separate an uncertain identification from visual description. A character or copyright that cannot be identified should not prevent tagging visible clothing, pose, objects, composition, and setting.

## Tagging Order

For a complete cataloging pass, inspect in this order. Stop when the requested detail level is reached.

1. Artist, character, copyright, source, rating, and spoilers when known or applicable.
2. Subject count and subject type.
3. Framing, viewpoint, orientation, and composition.
4. Visible anatomy, hair, face, expression, pose, gesture, and action.
5. Clothing, accessories, held/worn objects, and other objects.
6. Environment, background, lighting, color, style, text, and effects.
7. Required blacklist-sensitive tags and other high-impact content tags.

For image-generation prompts that accept Danbooru-style tags, use only user-requested, desired visual content. Exclusions belong in a negative prompt, not as `no ...` prose in a positive prompt.

## Evidence Boundary

### Tag What Is Visible

- Tag visible elements, even if they seem obvious from a character's identity.
- Do not tag obscured or off-frame parts. A waist-up view does not establish legwear or footwear.
- Do not apply a trait merely because it is canonical. For example, use `vampire` only when visible vampire characteristics support it.
- Canonical relationships may be tagged only where they convey meaningful, established information, such as `siblings`; do not infer subjective relationship labels from appearance alone.
- If an image has visible but unidentifiable content, describe the visible fact. In Danbooru upload work, `tagme`, `character_request`, `copyright_request`, or `source_request` indicate missing information; do not use these request tags as substitutes for ordinary visual tagging.

### Required High-Impact Tags

Danbooru's tagging guide calls out these tags as necessary on upload so blacklist filtering works: `furry`, `guro`, `incest`, `loli`, `shota`, `peeing`, `rape`, `scat`, `spoilers`, `vomit`, `yaoi`, and `male_focus`.

Apply only when the criterion is visibly and unambiguously met. Do not silently omit an applicable tag in a cataloging task. For image-generation tasks, follow the user's requested safety scope and platform policy.

## Tag Classes And Naming

Danbooru tag classes are artist, character, copyright, general, and meta. Existing tags normally appear without a prefix in exported tag lists. Prefixes are for creation or reclassification:

| Class | Creation prefix | Agent rule |
| --- | --- | --- |
| Artist | `artist:` or `art:` | Use a verified artist tag; do not guess attribution. |
| Character | `character:` or `char:` | Identify every featured character when possible. |
| Copyright | `copyright:` or `copy:` | Add the originating work for identified characters; use `original` for non-franchise art. |
| General | `general:` or `gen:` | Default class for visible concepts, objects, appearance, actions, and scenes. |
| Meta | `meta:` | Administrative or cross-cutting tags; use only established terms. |

Use the work's original name where Danbooru has established it. Preserve conventional name order: commonly `surname_givenname` for Asian names and `givenname_surname` for Western names. Use a full character name when possible.

Resolve a genuine ambiguity with a qualifier in parentheses. Examples: `black_rock_shooter` is the copyright, while `black_rock_shooter_(character)` is the protagonist. Do not add qualifiers speculatively; verify the canonical form first.

## Review Checklist

Before returning a tag list, check:

- Each tag corresponds to an observable or explicitly requested catalog fact.
- Character and copyright are present when identification is reliable.
- Counts, body visibility, orientation, action, interaction, and framing match the image.
- Apparel, accessories, props, and environment are only present when visible.
- No subjective, speculative, duplicate, pluralized-new-tag, misspelled, or fabricated tag appears.
- Applicable blacklist-sensitive tags are not missing.
- Unknown identities are marked separately from the visible tag list when the task is upload/catalog review.

## Tag Group Navigation

Use this index to decide where a disputed term belongs, then consult the linked live tag-group wiki for exact definitions, aliases, implications, and exceptions. A term may belong to more than one group.

### Composition And Style

- Artistic license, image composition, backgrounds, censorship, character count, colors, fine art parody, focus tags, lighting, prints, visual aesthetic, patterns, symbols, text, Japanese dialects, year tags.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Aimage_composition

### Body And Appearance

- Body parts, ass, breasts tags, face tags, ears tags, eyes tags, hair, hair color, hair styles, hands, gestures, feet, neck and neckwear, posture, pussy, shoulders, skin color, wings, injury.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Abody_parts

### Clothing And Accessories

- Accessories, attire, handwear, headwear, legwear, neck and neckwear, sexual attire, sleeves, embellishment, eyewear, fashion style, makeup, covering, nudity, mask, swimsuit.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Aattire

### Actions, Sex, And Relationships

- Sex acts, simulated sex acts, sexual positions, BDSM and torture, dances, family relationships, groups, phrases, verbs and gerunds, transgender, gender nonconformity.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Asex_acts

### Objects And Environments

- Audio tags, holding tags, cards, doors and gates, piercings, sex objects, weapons, vehicles, ships, aircraft, armor, technology, fire, water, locations, real-world locations.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Aholding_tags

### Creatures, Plants, Food, And Activities

- Animals, birds, cats, dogs, legendary creatures, flowers, food tags, board games, sports, video games, game activities.
- Live index: https://danbooru.donmai.us/wiki_pages/list_of_animals

### Themes And Real World

- Companies and brand names, holidays and celebrations, jobs, people, history, theme, subjective, technology.
- `subjective` is a navigation group, not permission to apply opinion-based tags in ordinary image tagging.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_group%3Atheme

### Characters, Media, And Meta

- Character lists are organized by copyright, including common series such as Arknights, Fate, Genshin-related media, Pokemon, Touhou, Umamusume, Vocaloid, and many others.
- Meta groups include metatags and drawing software.
- Live index: https://danbooru.donmai.us/wiki_pages/tag_groups

## Escalation

For strict Danbooru canonicalization, use `search_danbooru_tags` to resolve or assert a tag. It accepts up to 12 concepts in `queries`, combines autocomplete, prefix, and multiword wildcard recall, then returns candidates grouped per query. Use `related_danbooru_tags` to expand one verified seed. Use `inspect_danbooru_tags` to validate up to 12 selected tags in parallel; Wiki bodies are included by default. These tools verify Danbooru taxonomy; they do not decide whether a clear tag-like token is usable in an Anima, Forge, LoRA, wildcard, or extension prompt.

For taxonomy, aesthetics, or Tag Group research, use `search_danbooru_wikis` to find canonical Wiki titles, then `inspect_danbooru_wikis` to read selected pages. Each inspected page returns bounded DText plus deduplicated Wiki and Tag Group references. Follow only relevant references in another inspection round. Stop when the evidence answers the task or the remaining branches are repeated, irrelevant, or too broad. A search result, URL, or uninspected reference is not evidence, and a `tag_group:*` page title is not itself a generation tag.

Search before asserting a Danbooru-canonical form when any of these are true:

- The concept could map to several near-synonyms or a qualifier.
- The object, clothing construction, pose, action, character, artist, or copyright is unfamiliar.
- A tag is likely aliased, deprecated, implication-heavy, or unusually sensitive.
- The user asks for an exhaustive upload-ready tag set rather than a generation-oriented list.

When live lookup is unavailable during a strict cataloging task, state the uncertainty briefly and return only high-confidence visible tags; never fabricate a canonical tag name to make the list look complete. During ordinary prompt generation or editing, keep clear user-supplied and existing tags, and do not describe them as invalid merely because Danbooru lookup is unavailable.
