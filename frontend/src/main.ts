import { mount } from "svelte";
import { boot } from "./controller";
import { forgeReady } from "./forge/dom";
import "./ui/styles.css";
import Panel from "./ui/Panel.svelte";

declare global {
  interface Window {
    __PROMPT_AGENT_V2__?: { mounted: boolean };
  }
}

function start(): void {
  const namespace = (window.__PROMPT_AGENT_V2__ ??= { mounted: false });
  if (namespace.mounted) return;
  namespace.mounted = true;
  try {
    const host = document.createElement("div");
    host.id = "prompt-agent-v2";
    document.body.appendChild(host);
    mount(Panel, { target: host });
    void boot();
  } catch (error) {
    namespace.mounted = false;
    console.error("[prompt-agent] mount failed", error);
  }
}

// Forge calls onUiLoaded callbacks once Gradio has rendered; fall back to polling if the hook is missing.
if (typeof window.onUiLoaded === "function") {
  window.onUiLoaded(start);
} else {
  const timer = setInterval(() => {
    if (forgeReady()) {
      clearInterval(timer);
      start();
    }
  }, 500);
}
