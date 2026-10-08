---
name: danbooru-prompting
description: Danbooru tag methodology for anime prompts and tagging — canonical tags vs usable input (provenance policy), tag classes and naming, tagging order, visible-facts-only evidence boundary, required high-impact tags, tag-group navigation, and lookup-tool discipline. Use whenever building, normalizing, reviewing, or explaining Danbooru-style tags — including when the user never says "Danbooru" but is working with booru-style tag lists, artist/character tags, or tag wikis.
---

# Danbooru Prompting

A compact operational index, not an allowlist and not a replacement for a
tag's own live wiki page. Full detail: `references/tagging-contract.md`;
group navigation: `references/tag-group-index.md`.

## Operating contract

- Apply this skill when the task involves Danbooru/Gelbooru/booru tags, tag
  normalization, tag review, or tag-style prompts. Do not force tag syntax
  into an ordinary natural-language prompt unless requested; NL prompts do
  not need a Danbooru lookup.
- **Canonical status and prompt compatibility are different things.**
  User-provided tags, existing prompt tags, autocomplete/auto-fill tags, and
  model/extension/LoRA/wildcard-specific tokens are usable input when clear
  and intentional. A term missing from the current Danbooru index is not
  invalid — never refuse it or silently delete it as "non-standard". If the
  distinction matters, say it was not found in the index and offer
  canonicalization.
- Mandatory preflight lookup only for strict Danbooru cataloging,
  upload-ready output, or explicit normalization: extract 2–12 short English
  visual concepts and run one batched tag search. For ordinary prompts,
  lookup is optional and serves ambiguity/canonicalization — never let a
  missing or failed lookup block a clear user-requested tag.

## Tag output rules

1. Describe visible facts only. Do not tag facts known from canon, filenames,
   or context unless visible or explicitly requested.
2. When creating or canonicalizing a tag, prefer an established canonical
   tag; do not invent a plausible Danbooru name.
3. Output lowercase, space-separated terms in a comma-separated list. Never
   copy underscore database keys into a prompt: `blue hair`, not `blue_hair`.
4. Use singular nouns for new general tags (`wispberry`, not `wispberries`).
5. No subjective tags (`sexy`, `cute`, `hot`) — opinion is not a stable
   visual fact.
6. For strict cataloging, no duplicates or near-duplicates; keep the most
   specific verified tag. For ordinary prompt editing, do not deduplicate or
   rewrite user-provided tags unless asked.
7. Separate uncertain identification from visual description: an
   unidentifiable character does not prevent tagging clothing, pose, objects,
   composition, and setting.
8. Exclusions belong in a negative prompt, never as `no ...` prose in a
   positive prompt.

## Tagging order (cataloging passes)

1. Artist, character, copyright, source, rating, spoilers (when known/applicable).
2. Subject count and subject type.
3. Framing, viewpoint, orientation, composition.
4. Visible anatomy, hair, face, expression, pose, gesture, action.
5. Clothing, accessories, held/worn objects.
6. Environment, background, lighting, color, style, text, effects.
7. Required blacklist-sensitive tags and other high-impact content tags.

Required high-impact tags on upload (apply only when visibly and
unambiguously met): `furry`, `guro`, `incest`, `loli`, `shota`, `peeing`,
`rape`, `scat`, `spoilers`, `vomit`, `yaoi`, `male_focus`.

## Tag classes and naming

Classes: artist, character, copyright, general, meta. Creation prefixes:
`artist:`/`art:`, `character:`/`char:`, `copyright:`/`copy:`,
`general:`/`gen:`, `meta:`. Use the work's original name and conventional
order (Asian names `surname_givenname`, Western `givenname_surname`). Resolve
genuine ambiguity with a parenthetical qualifier — verify the canonical form
first; do not add qualifiers speculatively (`black rock shooter` is the
copyright; `black rock shooter (character)` is the protagonist).

## Lookup discipline

Use the available Danbooru lookup tools — `danbooru-tools` (see
`../danbooru-tools`), the runtime's built-in Danbooru tools, or a browser on
danbooru.donmai.us. Canonical names in tool output are underscore database
keys for follow-up lookups only; prompts get the space-separated form.

Search before asserting a canonical form when: the concept could map to
several near-synonyms or a qualifier; the object/pose/artist/copyright is
unfamiliar; a tag is likely aliased, deprecated, or implication-heavy (check
aliases and implications with the lookup tools); or the user wants an
exhaustive upload-ready set.

For taxonomy or tag-group research: search wiki titles, inspect selected
pages (bounded bodies with next-hop references), follow only relevant
references, and stop when the evidence answers the task. A search result or
uninspected reference is not evidence, and a `tag_group:*` title is not
itself a usable generation tag.

When live lookup is unavailable during strict cataloging: state the
uncertainty and return only high-confidence visible tags — never fabricate a
canonical name to complete the list. During ordinary prompt editing, keep
clear user tags and do not call them invalid merely because lookup is down.

## Review checklist

- Every tag corresponds to an observable or explicitly requested catalog fact.
- Character/copyright present when identification is reliable.
- Counts, body visibility, orientation, action, interaction, framing match.
- Apparel, accessories, props, environment present only when visible.
- No subjective, speculative, duplicate, pluralized-new, misspelled, or
  fabricated tags.
- Applicable blacklist-sensitive tags not missing (cataloging tasks).
- Unknown identities marked separately from the visible tag list (upload
  review).
