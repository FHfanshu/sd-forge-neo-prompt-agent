import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function ruleFor(css: string, selector: string): string {
  const start = css.lastIndexOf(`${selector} {`);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe("surface design tokens", () => {
  it("keeps every CSS variable consumed by the Tailwind theme", () => {
    const css = readFileSync("src/styles.css", "utf-8");
    for (const token of [
      "--pa-background",
      "--pa-foreground",
      "--pa-border",
      "--pa-input",
      "--pa-ring",
      "--pa-primary",
      "--pa-primary-foreground",
      "--pa-secondary",
      "--pa-secondary-foreground",
      "--pa-destructive",
      "--pa-destructive-foreground",
      "--pa-muted",
      "--pa-muted-foreground",
      "--pa-accent",
      "--pa-accent-foreground",
      "--pa-popover",
      "--pa-popover-foreground",
      "--pa-radius-lg",
      "--pa-radius-md",
      "--pa-radius-sm",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("keeps the profile settings window floating on mobile viewports", () => {
    const css = readFileSync("src/styles.css", "utf-8");
    expect(css).not.toMatch(/\.pa-profile-window \{ inset: 0 !important/);
  });

  it("keeps the transcript hierarchy borderless instead of nesting cards and rails", () => {
    const css = readFileSync("src/styles.css", "utf-8");
    for (const selector of [
      ".pa-process-drawer",
      ".pa-process-content",
      ".pa-tool-result",
      ".pa-prompt-change",
      ".pa-prompt-change-body",
    ]) {
      expect(ruleFor(css, selector)).not.toMatch(/\bborder(?:-left|-right|-top|-bottom)?\s*:/);
      expect(ruleFor(css, selector)).not.toMatch(/\bbackground\s*:/);
    }
    expect(ruleFor(css, ".pa-message-assistant")).toContain("border: 0");
    expect(ruleFor(css, ".pa-message-assistant::before")).toContain("content: none");
  });
});
