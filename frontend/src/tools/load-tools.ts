import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import { TOOL_GROUP_NAMES, TOOL_GROUPS, type ToolGroupName } from "./tool-groups";

const groupSchema = Type.Union(TOOL_GROUP_NAMES.map((name) => Type.Literal(name)));

export const LOAD_TOOLS_SCHEMA = Type.Object({
  groups: Type.Array(groupSchema, { minItems: 1, maxItems: TOOL_GROUP_NAMES.length }),
}, { additionalProperties: false });

type LoadToolsParameters = Static<typeof LOAD_TOOLS_SCHEMA>;

export interface LoadToolsFactoryOptions {
  resolveTools?: () => AgentTool<any>[];
}

export function createLoadToolsTool(options: LoadToolsFactoryOptions = {}): AgentTool<typeof LOAD_TOOLS_SCHEMA, unknown> & { permission: "read" } {
  const description = [
    "Reveal specialized tools that are hidden until needed.",
    `Groups: ${TOOL_GROUP_NAMES.map((name) => `${name} (${TOOL_GROUPS[name].tools.join(", ")})`).join("; ")}.`,
    "Call this with one or more group names to load their full definitions; the revealed tools become callable from the next step.",
  ].join(" ");
  return {
    name: "load_tools",
    label: "Load tools",
    description,
    parameters: LOAD_TOOLS_SCHEMA,
    permission: "read",
    executionMode: "parallel",
    execute: async (_toolCallId, params: LoadToolsParameters) => {
      const tools = options.resolveTools?.() ?? [];
      const groups = [...new Set(params.groups)] as ToolGroupName[];
      const definitions = groups.flatMap((group) => {
        const names = new Set(TOOL_GROUPS[group].tools);
        return tools.filter((tool) => names.has(tool.name)).map((tool) => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
        }));
      });
      const result = { ok: true, groups, tools: definitions };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
}
