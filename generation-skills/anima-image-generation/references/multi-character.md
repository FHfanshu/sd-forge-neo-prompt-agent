# Multi-character and regional prompting

## Plain multi-character prompts

- State the exact subject count (`2girls`, `1boy 1girl`).
- Give each character a position, appearance, pose, gaze, and interaction.
  A list of names is not enough.
- Use concrete spatial wording: left, center, right, foreground, background,
  behind, facing the viewer, looking at each other.
- State which character is which in the same order used by the spatial
  wording ("left girl … right girl …").
- Do not repeat one character's distinctive attribute in another character's
  description — attribute bleed between characters is the most common
  multi-character failure.

Natural-language sentences may split into two or more short sentences for
layout, but each sentence stays simple and concrete.

## Regional conditioning principles

When a runtime or extension supports per-region prompts (line-per-region,
boxes, or masks), these principles transfer regardless of the specific tool:

- **Choose the simplest mode that works.** Side-by-side or stacked regions →
  simple line/box mode. Irregular drawn regions only if genuinely needed.
- **The checkpoint must already understand the composition.** Regional
  conditioning reduces attribute bleed; it does not invent a composition the
  model cannot follow. Fix the base prompt first.
- **Repeat the total subject count and shared scene premise in every
  character region.** This keeps the full cast in the checkpoint's mind
  instead of generating one isolated subject per tile.
  Example global line: `masterpiece, best quality, safe. 2girls standing
  side-by-side in a classroom, medium shot, soft daylight.`
- **One region = one line, with that character's identity, side, appearance,
  pose, gaze, and local action.** Shared composition/style belongs in the
  global line, not duplicated per region.
- **Never leave trailing or accidental empty lines** — empty lines count as
  regions.
- **Global effect placement matters.** If a global line is configured as the
  first or last line, include it as an additional line: two character regions
  require three lines in total.
- **Preserve separators exactly.** A custom separator (a word or escaped
  newline sequence) must survive every edit. Do not insert `BREAK` merely to
  separate regions unless the separator is explicitly configured to match.
- **Prompt-rewriting extensions (dynamic prompts, wildcards, common-prompt
  syntax like `{common:...}`) can break separators or expansion.** Keep the
  structure simple and verify the final expanded prompt lines.
- **Cover the whole canvas.** With explicit boxes or masks, every pixel should
  receive a weight; add a full-canvas layer when needed. Treat masks as broad
  conditioning regions, not pixel-perfect segmentation.
- If generation stops at the first step, look for the extension's validation
  error in the runtime console: too few region lines, line/count mismatch,
  uncovered pixels, or a broken separator.
