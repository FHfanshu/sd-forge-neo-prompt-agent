import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  plugins: [svelte(), cssInjectedByJsPlugin()],
  build: {
    target: "es2022",
    outDir: "../javascript",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      name: "PromptAgentV2",
      formats: ["iife"],
      fileName: () => "prompt_agent.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
