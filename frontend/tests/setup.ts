import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";
import "fake-indexeddb/auto";

const testRect = new DOMRect(0, 0, 120, 32);
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => testRect,
});
Object.defineProperty(HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => ({ 0: testRect, length: 1, item: (index: number) => index === 0 ? testRect : null }),
});
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => undefined;

if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

if (!Element.prototype.animate) {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: (_keyframes: unknown, options?: { duration?: number }) => {
      const duration = Number(options?.duration ?? 0);
      const animation = {
        currentTime: duration,
        playState: "running",
        effect: null as unknown,
        cancel() { animation.playState = "idle"; },
        finish() {},
        play() {},
        pause() {},
        commitStyles() {},
        addEventListener() {},
        removeEventListener() {},
        get finished() { return Promise.resolve(animation); },
        set onfinish(handler: null | (() => void)) {
          if (typeof handler !== "function") return;
          queueMicrotask(() => {
            animation.currentTime = duration;
            animation.playState = "finished";
            handler();
          });
        },
      };
      return animation;
    },
  });
}

afterEach(() => {
  cleanup();
});
