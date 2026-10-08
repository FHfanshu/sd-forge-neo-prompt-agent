import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

// links must never navigate the Forge page away
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const cache = new Map<string, string>();

/** Render completed assistant text once; results are memoized because finished messages never change. */
export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
    FORBID_TAGS: ["style", "img", "iframe", "form", "input"],
    FORBID_ATTR: ["style"],
  });
  html = html.replace(/<pre>/g, '<pre><button type="button" class="pa-code-copy">复制</button>');
  cache.set(text, html);
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  return html;
}
