type Schema = Record<string, unknown>;

const target: Schema = { type: "string", enum: ["active", "txt2img", "img2img"], description: "默认 active（当前页面）" };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const patch: Schema = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["replace", "delete", "insert_before", "insert_after", "append", "prepend"] },
    find: { type: "string", description: "replace/delete 要精确匹配的原文" },
    replace: { type: "string" },
    anchor: { type: "string", description: "insert_before/insert_after 的锚点原文" },
    text: { type: "string" },
    separator: { type: "string", description: "append/prepend 分隔符，默认 \", \"" },
    all: { type: "boolean", description: "匹配多处时全部处理" },
  },
  required: ["op"],
};

export const TOOL_DEFS: { name: string; label: string; description: string; parameters: Schema }[] = [
  { name: "read_prompt", label: "读取提示词", description: "读取 Forge 当前的正向/负向提示词和 hash。修改前必须先读。", parameters: obj({ target }) },
  {
    name: "edit_prompt",
    label: "修改提示词",
    description: "修改提示词。base_hash 必须是最近读取的 hash。字段非空时只能用 patches；字段为空时才能用 text 整段写入。",
    parameters: obj(
      { target, field: { type: "string", enum: ["positive", "negative"] }, base_hash: { type: "string" }, text: { type: "string" }, patches: { type: "array", items: patch, maxItems: 32 } },
      ["field", "base_hash"],
    ),
  },
  {
    name: "read_generation_parameters",
    label: "读取参数",
    description: "读取全部生成参数（checkpoint、preset、sampler、scheduler、steps、cfg_scale、seed、宽高、batch、高清修复、重绘幅度）、可选值列表和 context_hash。",
    parameters: obj({ target }),
  },
  {
    name: "set_generation_parameters",
    label: "修改参数",
    description: "修改生成参数。context_hash 必须是最近读取的值；choice 类参数必须取 options 里的值。只写要改的键。你不能出图。",
    parameters: obj({ target, context_hash: { type: "string" }, values: { type: "object", description: "要修改的参数键值" } }, ["context_hash", "values"]),
  },
  {
    name: "read_latest_image",
    label: "查看最新出图",
    description: "读取 Forge 图库里当前选中/最新的一张出图：PNG 参数，以及（模型支持视觉时）图片本身。",
    parameters: obj({ target }),
  },
  {
    name: "read_attachment",
    label: "读取附图",
    description: "读取用户附图的 PNG 生成参数；include_image=true 时（模型支持视觉）同时给出图片。",
    parameters: obj({ attachment_id: { type: "string" }, include_image: { type: "boolean" } }, ["attachment_id"]),
  },
  {
    name: "search_resources",
    label: "搜索资源",
    description: "检索本地资源：LoRA（按训练批次分组，匹配文件名、文件夹、推断的触发词、训练概念和训练标签）、checkpoint、style 预设（角色触发词常在这里）、wildcard。query 用空格分隔多个词，优先用英文标签或角色/触发词；结果按相关度排序并说明命中字段。kind 留空搜全部；base_model 按底模过滤（如 anima、sdxl）。",
    parameters: obj({ query: { type: "string" }, kind: { type: "string", enum: ["lora", "checkpoint", "style", "wildcard"] }, base_model: { type: "string" }, sort: { type: "string", enum: ["relevance", "newest"], description: "newest 按训练完成时间从新到旧" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, []),
  },
  {
    name: "inspect_resource",
    label: "查看资源",
    description: "查看资源详情：style 的完整正/负提示词；LoRA 的用法、底模、推断触发词、各训练概念的标签（含频次）、训练参数和全部版本（epoch）；checkpoint 的底模；wildcard 的取值。LoRA 的 name 可以是文件名或训练批次名。",
    parameters: obj({ kind: { type: "string", enum: ["lora", "checkpoint", "style", "wildcard"] }, name: { type: "string" } }, ["kind", "name"]),
  },
  {
    name: "model_info",
    label: "模型信息",
    description: "查询从 Civitai 下载的 checkpoint 或 LoRA 的作者说明、触发词和推荐设置（本地说明文件 → 本地缓存 → Civitai，首次需计算文件哈希，较慢）。本地训练的 LoRA 用 inspect_resource 即可，不要调用这个。",
    parameters: obj({ kind: { type: "string", enum: ["checkpoint", "lora"] }, name: { type: "string" }, refresh: { type: "boolean" } }, ["kind", "name"]),
  },
  {
    name: "edit_memory",
    label: "更新记忆",
    description: "编辑记忆文件 MEMORY.md（Markdown，全文已在系统提示里）。append 在末尾追加 text；replace 把 find 精确匹配的原文换成 text；delete 删除 find 匹配的原文。find 必须在文件里恰好出现一次。",
    parameters: obj({ op: { type: "string", enum: ["append", "replace", "delete"] }, text: { type: "string" }, find: { type: "string" } }, ["op"]),
  },
  {
    name: "danbooru_search",
    label: "Danbooru 搜索",
    description: "搜索 Danbooru 标签（type=tag）或 wiki 标题（type=wiki），只返回候选名称。",
    parameters: obj({ query: { type: "string" }, type: { type: "string", enum: ["tag", "wiki"] }, category: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } }, ["query"]),
  },
  {
    name: "danbooru_inspect",
    label: "Danbooru 查看",
    description: "查看标签的元数据与 wiki 正文（type=tag），或 wiki 页面正文（type=wiki）。解释标签含义前先查看。",
    parameters: obj({ names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12 }, type: { type: "string", enum: ["tag", "wiki"] } }, ["names"]),
  },
  {
    name: "danbooru_related",
    label: "相关标签",
    description: "查询与某标签经常共同出现的标签。",
    parameters: obj({ name: { type: "string" }, category: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } }, ["name"]),
  },
  {
    name: "load_skill",
    label: "加载技能",
    description: "加载一个生成技能文档（名称见系统提示中的清单），或其 references 中的参考文档。",
    parameters: obj({ name: { type: "string" }, reference: { type: "string" } }, ["name"]),
  },
  { name: "list_characters", label: "角色列表", description: "列出已定义的角色。", parameters: obj({}) },
  { name: "get_character", label: "角色定义", description: "读取角色定义（触发词、参考视图、绑定的模型与 LoRA）。", parameters: obj({ name: { type: "string" } }, ["name"]) },
];

export const TOOL_LABELS: Record<string, string> = Object.fromEntries(TOOL_DEFS.map((tool) => [tool.name, tool.label]));

export function openAiTools() {
  return TOOL_DEFS.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}
