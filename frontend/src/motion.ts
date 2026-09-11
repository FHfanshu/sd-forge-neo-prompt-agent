import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function windowIn(_node: Element, { duration = 180 }: { duration?: number } = {}): TransitionConfig {
  const reduced = reducedMotion();
  return {
    duration: reduced ? Math.min(duration, 120) : duration,
    css: (t: number) => {
      const eased = cubicOut(t);
      const scale = reduced ? 1 : 0.98 + 0.02 * eased;
      return `opacity: ${eased}; transform: scale(${scale}); transform-origin: center;`;
    },
  };
}

export function windowOut(_node: Element, { duration = 120 }: { duration?: number } = {}): TransitionConfig {
  return {
    duration: reducedMotion() ? 0 : duration,
    css: (t: number) => `opacity: ${t}; pointer-events: none;`,
  };
}
