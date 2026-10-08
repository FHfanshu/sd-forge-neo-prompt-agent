/** The only module that knows Forge Neo DOM selectors (Gradio 4). */
import type { Target } from "../types";

declare global {
  interface Window {
    gradioApp?: () => Document | ShadowRoot;
    onUiLoaded?: (callback: () => void) => void;
  }
}

export function root(): Document | ShadowRoot {
  return window.gradioApp?.() ?? document;
}

function q<T extends Element = HTMLElement>(selector: string): T | null {
  return root().querySelector<T>(selector);
}

function visible(element: Element | null): boolean {
  return !!element && (element as HTMLElement).offsetParent !== null;
}

export function forgeReady(): boolean {
  return !!q("#txt2img_prompt textarea");
}

/** Currently shown generation tab, or null when the user is on another tab (Extras, Settings…). */
export function activeTarget(): Target | null {
  if (visible(q("#tab_img2img"))) return "img2img";
  if (visible(q("#tab_txt2img"))) return "txt2img";
  return null;
}

export function promptTextarea(target: Target, field: "positive" | "negative"): HTMLTextAreaElement | null {
  return q<HTMLTextAreaElement>(`#${target}_${field === "positive" ? "prompt" : "neg_prompt"} textarea`);
}

function nativeSet(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function writeText(element: HTMLTextAreaElement, value: string): void {
  nativeSet(element, value);
}

// -- generic controls -------------------------------------------------------------

export function controlRoot(selector: string): HTMLElement | null {
  return q(selector);
}

export function readNumber(rootEl: HTMLElement): number | null {
  const input = rootEl.querySelector<HTMLInputElement>("input[type=number]") ?? rootEl.querySelector<HTMLInputElement>("input, textarea");
  if (!input) return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

export function writeNumber(rootEl: HTMLElement, value: number): boolean {
  const inputs = rootEl.querySelectorAll<HTMLInputElement>("input[type=number], input[type=range], input:not([type]), input[type=text], textarea");
  if (!inputs.length) return false;
  inputs.forEach((input) => nativeSet(input, String(value)));
  return true;
}

export function readDropdown(rootEl: HTMLElement): string | null {
  const input = rootEl.querySelector<HTMLInputElement>("input");
  return input ? input.value : null;
}

/** Short wait for Gradio to re-render. Not requestAnimationFrame: that pauses in background tabs. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** Select a Gradio 4 dropdown option the way a user would (focus → mousedown on the option). */
export async function writeDropdown(rootEl: HTMLElement, value: string): Promise<boolean> {
  const input = rootEl.querySelector<HTMLInputElement>("input");
  if (!input) return false;
  if (input.value === value) return true;
  input.focus();
  input.dispatchEvent(new FocusEvent("focus"));
  let option: HTMLElement | null = null;
  for (let attempt = 0; attempt < 30 && !option; attempt++) {
    await nextFrame();
    option = [...rootEl.querySelectorAll<HTMLElement>("li[data-testid=dropdown-option]")].find((li) => li.getAttribute("aria-label") === value) ?? null;
  }
  if (!option) {
    input.blur();
    return false;
  }
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  for (let attempt = 0; attempt < 30 && input.value !== value; attempt++) await nextFrame();
  input.blur();
  return input.value === value;
}

export function hiresToggle(): HTMLInputElement | null {
  return q<HTMLInputElement>("#txt2img_hr-visible-checkbox");
}

export function writeHires(enabled: boolean): boolean {
  const box = hiresToggle();
  if (!box) return false;
  if (box.checked !== enabled) {
    box.checked = enabled;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
}

// -- output gallery ------------------------------------------------------------

/** URL of the selected (or first) output image of a generation tab. */
export function latestImageUrl(target: Target): string | null {
  const gallery = q(`#${target}_gallery`);
  if (!gallery) return null;
  const preview = gallery.querySelector<HTMLImageElement>(".preview img, [data-testid=detailed-image]");
  const selected = gallery.querySelector<HTMLImageElement>(".thumbnail-item.selected img, button.selected img");
  const first = gallery.querySelector<HTMLImageElement>(".thumbnail-item img, .grid-wrap img, img");
  const image = preview ?? selected ?? first;
  return image?.src || null;
}
