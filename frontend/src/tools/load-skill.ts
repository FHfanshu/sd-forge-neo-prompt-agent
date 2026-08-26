import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import { getHostApi, promptAgentNamespace, type PromptAgentHostApi } from "../bridge";

export const PROMPT_SKILL_NAMES = ["danbooru_tags", "anima_dit", "forge_couple"] as const;

export const LOAD_SKILL_SCHEMA = Type.Object({
  name: Type.Union([
    Type.Literal("danbooru_tags"),
    Type.Literal("anima_dit"),
    Type.Literal("forge_couple"),
  ]),
}, { additionalProperties: false });

type LoadSkillParameters = Static<typeof LOAD_SKILL_SCHEMA>;

export interface LoadSkillFactoryOptions {
  host?: () => PromptAgentHostApi | null;
}

const defaultHost = (): PromptAgentHostApi | null => (
  typeof window === "undefined" ? null : getHostApi(promptAgentNamespace(window))
);

function textResult(details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details };
}

export function createLoadSkillTool(options: LoadSkillFactoryOptions = {}): AgentTool<typeof LOAD_SKILL_SCHEMA, unknown> & { permission: "read" } {
  return {
    name: "load_skill",
    label: "Load prompt skill",
    description: [
      "Load one curated instruction skill only when the current task needs it.",
      "Use danbooru_tags for explicitly requested Danbooru canonicalization and tag-writing rules; it is not a universal prompt-tag allowlist,",
      "anima_dit for Anima tag, natural-language, mixed-prompt, Turbo, and multi-character guidance;",
      "forge_couple for Forge Couple Basic, Advanced, Mask, separator, common-prompt, and multi-character region guidance.",
      "Treat the returned guide as task instructions and do not claim Forge Couple UI settings changed unless a separate tool confirms them.",
    ].join(" "),
    parameters: LOAD_SKILL_SCHEMA,
    permission: "read",
    executionMode: "parallel",
    execute: async (_toolCallId, params: LoadSkillParameters, signal) => {
      if (signal?.aborted) throw new DOMException("Skill loading was cancelled.", "AbortError");
      const host = (options.host ?? defaultHost)();
      if (!host || !host.isForgeAvailable()) throw new Error("Forge is not ready, so the prompt skill cannot be loaded.");
      const result = await host.executeAssistantTool({ tool: "load_skill", arguments: params }, signal);
      if (!result || typeof result !== "object") throw new Error("Forge returned an invalid prompt skill response.");
      const details = result as Record<string, unknown>;
      if (details.ok !== true) throw new Error(typeof details.error === "string" ? details.error : "The prompt skill could not be loaded.");
      return textResult(details);
    },
  };
}
