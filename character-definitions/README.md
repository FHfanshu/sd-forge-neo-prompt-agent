# character-definitions

Minimal character definitions, per the Sunset/Harvest PRD. One file per
character, exactly four fields — no database, no LoRA registry:

```json
{
  "name": "...",
  "reference_images": ["portrait", "front", "side", "back"],
  "trigger_words": ["..."],
  "short_description": "..."
}
```

- `reference_images` lists the *views* the character has approved references
  for. The actual images are ordinary assets in the production workspace's
  asset library (e.g. ComfyTV Asset Library), tagged:

  ```text
  character:<name>
  view:<portrait|front|side|back|three-quarter|expression>
  outfit:<name>
  ```

  The definition stores only these view names / tags, not copies of the
  images. Fill in a view only after the corresponding reference passed the
  requirements in `generation-skills/character-reference-sheet`.

- `trigger_words` are the prompt tokens that invoke the character (LoRA
  triggers, Danbooru-style character tags, or wildcards).
- `short_description` is one sentence in the owner's own words.

## Deliberately absent

- **No LoRA fields.** The same OC may have many LoRA versions; most turn out
  unusable; LoRA choice and strength depend on the checkpoint/workflow and
  belong to the workflow/preset layer. Bind LoRAs manually where the images
  are actually generated. If one LoRA ever becomes a stable default, add an
  *optional* binding then — not before.
- No image library, gallery, upload UI, or preview manager: the production
  workspace (ComfyTV) already provides those. Do not rebuild them.
- No identity/trait database: the design methodology lives in
  `../generation-skills/anime-oc-design` and `anthro-oc-design`; the
  definition above plus the reference assets is the storage.

## Files

- `_template.json` — copy for a new character.
- `xiuran.json` — first entry; fill in the canonical short description when
  porting (kept minimal here to avoid inventing details).
