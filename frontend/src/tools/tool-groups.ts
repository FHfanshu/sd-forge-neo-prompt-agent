export const TOOL_GROUP_NAMES = ["image", "forge_resources", "danbooru"] as const;

export type ToolGroupName = (typeof TOOL_GROUP_NAMES)[number];

export interface ToolGroupDefinition {
  readonly label: string;
  readonly description: string;
  readonly tools: readonly string[];
}

export const TOOL_GROUPS: Record<ToolGroupName, ToolGroupDefinition> = {
  image: {
    label: "Image inspection",
    description: "List recent host generations, read PNGInfo metadata, and read image pixels (vision only).",
    tools: ["list_recent_generations", "read_pnginfo", "read_image"],
  },
  forge_resources: {
    label: "Forge resources",
    description: "Search and inspect Forge styles, wildcards, LoRAs, checkpoints, and embeddings by logical id.",
    tools: ["search_resources", "inspect_resource"],
  },
  danbooru: {
    label: "Danbooru tags and wikis",
    description: "Search, inspect, and expand Danbooru tags and Wikis for canonicalization and background research.",
    tools: [
      "search_danbooru_tags",
      "inspect_danbooru_tags",
      "related_danbooru_tags",
      "search_danbooru_wikis",
      "inspect_danbooru_wikis",
    ],
  },
};

export const CORE_TOOL_NAMES = [
  "read_prompt",
  "edit_prompt",
  "read_generation_parameters",
  "apply_generation_parameters",
  "generate_image",
  "prompt_toolkit",
  "load_skill",
  "load_tools",
] as const;
