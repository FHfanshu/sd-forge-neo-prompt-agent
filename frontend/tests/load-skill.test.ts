import { Compile } from "typebox/compile";
import type { PromptAgentHostApi } from "../src/bridge";
import { createLoadSkillTool, LOAD_SKILL_SCHEMA, PROMPT_SKILL_NAMES } from "../src/tools/load-skill";
import { createForgeToolRegistry } from "../src/tools/tool-registry";
import { acceptanceTest } from "./acceptance";

function skillHost(executeAssistantTool: PromptAgentHostApi["executeAssistantTool"]): PromptAgentHostApi {
  return {
    name: "prompt-agent-host",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["forge-availability", "prompt-target", "tool-execution"],
    handshake: () => ({ ok: true, bridge: "prompt-agent-ui", apiVersion: 1, version: "1.0.0", capabilities: [] }),
    isForgeAvailable: () => true,
    activePromptTarget: () => "txt2img",
    readPrompt: async () => ({}),
    captureForgeState: () => ({}),
    restoreForgeState: () => true,
    executeTool: executeAssistantTool,
    executeAssistantTool,
    getLocaleHints: () => ({ locale: "en" }),
    subscribeLocaleHints: () => () => undefined,
    openSettings: () => undefined,
  };
}

describe("on-demand prompt skills", () => {
  acceptanceTest("PROMPT-SKILL-001@3", "registration,load", "registers one bounded load_skill tool and returns only the requested guide", async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      name: "forge_couple",
      title: "Forge Couple prompt guide",
      guide: "Basic mode maps newline-separated prompt lines to regions.",
    }));
    const host = skillHost(execute);
    const registry = createForgeToolRegistry({ host: () => host });
    const tool = createLoadSkillTool({ host: () => host });

    expect(registry.list().map((item) => item.name)).toContain("load_skill");
    expect(PROMPT_SKILL_NAMES).toEqual(["danbooru_tags", "anima_dit", "forge_couple"]);
    expect(Compile(LOAD_SKILL_SCHEMA).Check({ name: "forge_couple" })).toBe(true);
    expect(Compile(LOAD_SKILL_SCHEMA).Check({ name: "../../secrets" })).toBe(false);

    const result = await tool.execute("skill-1", { name: "forge_couple" });

    expect(execute).toHaveBeenCalledWith({ tool: "load_skill", arguments: { name: "forge_couple" } }, undefined);
    expect(result.details).toMatchObject({ ok: true, name: "forge_couple" });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("newline-separated") });
  });
});
