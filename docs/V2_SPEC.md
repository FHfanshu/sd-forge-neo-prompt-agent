# Prompt Agent v2 规范

版本：草案 1（2026-10-08）
范围与里程碑见 `V2_PLAN.md`。本文件是实现和验收的依据；与计划冲突时以本文件为准。
技术栈和 UI 视觉风格另行确定，本文件只约束行为、接口、数据和工程规则。

---

## 1. 术语

| 术语 | 含义 |
|---|---|
| 面板 | 停靠在 Forge 页面右侧的 agent 对话 UI |
| 目标页 | `txt2img` 或 `img2img`；`active` 表示当前所在的那个 |
| 服务商（provider，代码里叫 profile） | 一组 LLM 连接设置：名称、Base URL、API Key、推理强度，以及它下面的若干模型（每个模型可标记是否支持看图） |
| 轮（turn） | 用户发一条消息到 agent 停止（回复完、出错或被停止）的全过程 |
| 工具轮 | 一轮内模型请求一次工具调用并拿到结果，算一个工具轮 |
| 附图 | 用户随消息附带的图片，存服务端 |

---

## 2. 面板

### 2.1 显示状态

| 状态 | 取值 | 默认 | 持久化 |
|---|---|---|---|
| 展开/折叠 | `open` / `collapsed` | `open` | localStorage `pa2.panel` |
| 模式 | `squeeze`（挤压）/ `overlay`（覆盖） | `squeeze` | 同上 |
| 宽度 | 320–720 px | 400 | 同上 |

- 挤压：给 Forge 主容器加右侧留白等于面板宽度；覆盖：不改 Forge 布局，面板 `position: fixed` 盖在右侧。
- 折叠：面板收成 28px 宽的边条，点击展开；挤压模式下留白同步变为 28px。
- 宽度只能通过面板左边缘的拖拽手柄调整；松手时才写 localStorage。
- 窗口宽度 < 900px 时强制使用覆盖模式（不改用户保存的偏好）。
- localStorage 读写失败时用默认值，不报错。

### 2.2 结构

1. 顶栏：会话标题（点开会话列表）、新会话、模式切换、设置、折叠。
2. 消息区：消息列表，见 §3.4。
3. 输入区：附图预览条、`📎 附图` 和 `🖼 最新出图` 按钮、输入框；右下角是模型选择器（按服务商分组列出各自的模型，不合并、不做路由；底部一行选推理强度，按服务商/模型记在浏览器里，「默认」即用服务商设置）和发送/停止按钮。
4. 设置视图：在面板内替换消息区显示，顶栏出现"返回"。

### 2.3 挂载

- 只在 Forge UI 加载完成（`onUiLoaded`）后挂载一次；重复调用必须无副作用。
- 挂载失败时在控制台输出一行带 `[prompt-agent]` 前缀的错误，不影响 Forge 本身。
- 不注入任何全局 CSS reset；所有样式限定在面板根节点内，类名统一前缀 `pa-`。

---

## 3. 对话

### 3.1 轮状态机

```
idle ──发送──▶ requesting ──首字节──▶ streaming ──需要工具──▶ tool_running ──结果──▶ requesting
  ▲                │                     │                         │
  │                └────────┬────────────┴─────────────────────────┘
  │                         ├─ 正常结束 ──▶ idle
  │                         ├─ 用户停止 ──▶ idle（消息标记 stopped）
  └─────────────────────────┴─ 出错    ──▶ idle（消息标记 error，显示错误）
```

- 任何结束路径都必须回到 `idle`，输入框和发送按钮恢复可用。这是硬性要求。
- 非 `idle` 时：输入框仍可编辑，发送按钮变为"停止"。不支持排队追问。
- 停止：立即中止当前 HTTP 请求和正在执行的工具（能中止的话），保留已收到的内容，状态回 `idle` 不超过 1 秒。
- 一轮最多 24 个工具轮；超出时结束本轮，追加一条系统提示"已达到单轮工具调用上限"。
- 模型一次返回多个工具调用时按顺序逐个执行。

### 3.2 请求与重试

- 首字节之前遇到网络错误、HTTP 429 或 5xx：最多重试 2 次，间隔 1 秒、3 秒；顶栏状态显示"重试中（1/2）"。
- 首字节之后断流：不重试，消息标记 `error`，保留已收到内容。
- 上游返回上下文超长错误时（含 llama.cpp 的 "exceeds the available context size"），错误文案带上游原文，并提示新建会话或检查本地 llama.cpp 每槽位上下文（-c ÷ -np）。

### 3.3 发给模型的上下文

1. 系统提示词 = 固定提示词（§5.4）+ 可用 skills 清单 + 角色名清单。
2. 历史消息全量发送，例外：
   - 只保留**最近 3 条带图的用户消息**的图片，更早的替换为文本 `[图片 <id> 已省略，可用 read_attachment 读取]`。
   - 状态为 `interrupted` 且只有工具调用、没有结果的助手消息：为每个缺失结果补一条工具结果 `{"error":"interrupted"}`，保证协议合法。
3. 所有工具 schema 每次全量发送。

### 3.4 消息展示

| 类型 | 展示 |
|---|---|
| 用户消息 | 纯文本（保留换行）+ 附图缩略图（点击新标签页打开原图） |
| 助手正文 | 流式中：纯文本追加；完成后：Markdown 渲染一次（经 HTML 清洗），代码块带复制按钮 |
| 推理内容 | 默认折叠为一行"思考 · N 字"，点开显示纯文本；流式中折叠行显示"思考中…" |
| 工具调用 | 一行：状态图标 + 中文名 + 简短摘要；点开显示参数与结果 JSON（截断 4000 字） |
| 提示词修改 | 工具行摘要为"正向提示词 +12 −3"；点开显示行内红绿 diff |
| 错误 | 消息底部红色一行错误文案 + "重试"按钮（重发该轮的用户消息） |
| 中断 | 灰色标签"已中断" |

- 每条消息有"复制"操作；用户消息另有"编辑并重发"（删除其后所有消息，然后重发）。
- 消息区只挂载最近 60 条，滚到顶部时每次再加载 60 条。
- 自动跟随滚动：只在用户已处于底部（距离 < 80px）时跟随；用户上滑后停止跟随并显示"↓ 回到底部"。

### 3.5 附图

- 格式：PNG、JPEG、WebP；单张 ≤ 10 MB；每条消息 ≤ 4 张。超限时给出提示并拒绝该张，不影响其他。
- 来源：文件选择、粘贴、拖放到面板、`🖼 最新出图`。
- 上传原始字节到服务端（§6.6），先读 PNG 参数再做任何转码。
- 发给模型时：长边缩到 ≤ 1568px，转 JPEG（质量 90）的 data URL；只有配置开启"视觉"时才发图片，否则只发文本占位 `[附图 <id>]`，agent 可用 `read_attachment` 读参数。

### 3.6 最新出图

- 取当前目标页的 Forge 输出图库：优先当前选中的图，否则第一张。
- 浏览器自己 `fetch` 该图片 URL 拿字节，再走附图上传流程；服务端不接受路径或 URL。
- 图库为空时提示"当前页面还没有出图"。

---

## 4. 会话

- 新会话：标题为空，首条用户消息发出后取前 24 个字符（去换行）作为标题。
- 会话列表：按 `updated_at` 倒序，显示标题和相对时间；支持重命名、删除（二次确认后永久删除，含附图文件）。
- 当前会话 id 存 localStorage `pa2.session`；页面加载时打开它，不存在则打开最新会话，没有会话则新建空会话（空会话不入库，发出第一条消息时才创建）。
- 每个会话记住所用服务商和模型；切换只影响之后的请求。新会话沿用用户上次选择的模型（localStorage `pa2.model`）。
- 打开会话时先显示最近一页消息，更早的历史在后台加载；发起新一轮前会等历史加载完，保证上下文完整。
- 刷新/关闭页面：
  - 助手消息在流式中每 2 秒、以及完成/停止/出错时写入服务端。
  - 页面加载时，服务端里 `status=streaming` 的消息改为 `interrupted`。
  - 绝不自动重放或继续旧的工具调用和请求。
- 多标签页：不做实时同步；面板获得焦点时刷新会话列表；同一消息后写覆盖先写。

---

## 5. Agent 工具

### 5.1 通用规则

- 结果统一为 JSON：成功 `{"ok": true, ...}`，失败 `{"ok": false, "error": {"code": "...", "message": "..."}}`。
- 失败不终止本轮，作为工具结果交还模型自行纠正。
- 结果序列化后超过 16000 字符时截断，并附 `"truncated": true`。
- 超时：浏览器工具 15 秒，Python 工具 30 秒，`model_info` 首次算哈希 180 秒。
- 错误码：`INVALID_ARGS`、`STALE`、`NOT_FOUND`、`AMBIGUOUS`、`NOT_ON_GENERATION_TAB`、`FORGE_UNAVAILABLE`、`NETWORK`、`TIMEOUT`、`INTERNAL`。

### 5.2 Forge 工具（浏览器执行）

**`read_prompt`** `{target?: "active"|"txt2img"|"img2img"}`
→ `{target, positive: {text, hash}, negative: {text, hash, effective}}`
- `hash` = 文本的 53 位非加密哈希（cyrb53，14 位十六进制）。只用于检测过期状态；用同步哈希是因为局域网 http 访问时浏览器没有 `crypto.subtle`。
- `effective` = 当前 CFG ≠ 1（CFG 为 1 时负向提示词不生效）。
- `active` 但当前不在 txt2img/img2img 页 → `NOT_ON_GENERATION_TAB`。

**`edit_prompt`** `{target?, field: "positive"|"negative", base_hash, text?, patches?}`
- `base_hash` 与当前不符 → `STALE`，错误中附当前 `text` 和 `hash`。
- `text`（整段写入）只允许在该字段当前为空时使用；否则 `INVALID_ARGS`。
- `patches` 按顺序原子应用，任一失败则全部不生效：

| op | 参数 | 说明 |
|---|---|---|
| `replace` | `find, replace, all?` | |
| `delete` | `find, all?` | |
| `insert_before` / `insert_after` | `anchor, text` | |
| `append` / `prepend` | `text, separator?`（默认 `", "`） | 字段为空时不加分隔符 |

- `find`/`anchor` 精确匹配；未找到 → `NOT_FOUND`；`all` 不为 true 且匹配多处 → `AMBIGUOUS`（附匹配次数）。
- 写入方式：设置 textarea 值并派发 `input` 事件，保证 Forge 读到新值。
- 返回 `{target, field, text, hash, before_hash}`；UI 用前后文本生成 diff。
- 负向提示词不生效时，返回附 `"note": "负向提示词当前不生效（CFG=1）"`。

**`read_generation_parameters`** `{target?}`
→ `{target, context_hash, values: {...}, options: {...}}`

| 参数 | 类型/范围 | 选项来源 |
|---|---|---|
| `checkpoint` | 字符串 | Forge checkpoint 下拉 |
| `preset` | 字符串 | Forge UI 预设单选 |
| `sampler`、`scheduler` | 字符串 | 对应下拉 |
| `steps` | 1–150 | |
| `cfg_scale` | 0–30 | |
| `seed` | −1 – 2147483647 | |
| `width`、`height` | 64–4096，8 的倍数 | |
| `batch_count`、`batch_size` | 1–16 / 1–8 | |
| `enable_hr`、`hr_scale`、`hr_upscaler`、`hr_steps`、`hr_denoising` | 仅 txt2img | upscaler 下拉 |
| `denoising_strength` | 0–1，仅 img2img | |

- `context_hash` = 目标页 + 上表所有当前值 JSON 的同一哈希。
- 某控件在当前 Forge 中找不到时，该项不出现在 `values` 里，并在 `missing` 数组中列出，不报错。

**`set_generation_parameters`** `{target?, context_hash, values: {...}}`
- `context_hash` 不符 → `STALE`（附当前值）。
- 每个值必须在范围内或在 `options` 列表中；任一不合法则全部不写，`INVALID_ARGS` 列出所有问题。
- 修改 `checkpoint` 时返回附 `"note": "切换 checkpoint 会触发模型加载"`。
- 返回新的 `values` 和 `context_hash`。

**`read_latest_image`** `{target?}`
- 同 §3.6 取图并上传为附图，返回 `{attachment_id, width, height, pnginfo}`；配置开启视觉时，图片作为工具结果的图片内容一并交给模型。

### 5.3 Python 工具

所有名称类参数只能取自服务端枚举出的清单，不接受路径、`..`、绝对路径或 URL。

**`read_attachment`** `{attachment_id, include_image?}` → `{pnginfo, width, height}`（+ 图片，需视觉）
- `pnginfo` 结构：`{status: "ok"|"missing"|"unsupported"|"error", positive, negative, parameters: {...}, raw}`。PNG 读文本块；WebP/JPEG 读 EXIF UserComment（Forge 的 WebP 输出就存在这里）。
- 发给模型的用户消息里，每张附图都带 `[附图 attachment_id=…]` 标签，模型据此调用 `read_attachment`。

**`search_resources`** `{kind: "style"|"lora"|"wildcard", query?, limit?≤50}` → `[{name, summary}]`
**`inspect_resource`** `{kind, name}` → style：正/负提示词；lora：激活词、推荐权重、说明（来自 sidecar）；wildcard：前 100 行。

**`model_info`** `{kind: "checkpoint"|"lora", name, refresh?}`
- `name` 必须在 Forge 当前的模型列表中。
- 查询顺序：本地 sidecar → 本地缓存 → Civitai（开关打开时）。
- 返回：`{source: "sidecar"|"cache"|"civitai"|"none", base_model, trigger_words, tags, description, version_notes, url, sha256}`，`description` 为纯文本，截断 6000 字。
- Civitai：`GET /api/v1/model-versions/by-hash/{sha256}`，再 `GET /api/v1/models/{modelId}`；15 秒超时。
- 缓存：`data/prompt-agent/model-info/<sha256>.json`；命中直接返回；"未找到"也缓存，7 天后可重查；`refresh` 强制重查。
- 只向 Civitai 发送哈希和可选 API Key，不发送文件名或路径。
- 哈希优先读 Forge 的哈希缓存；没有则计算并写回 Forge 缓存。

**`danbooru_search`** `{query, type?: "tag"|"wiki", category?, limit?≤30}`
**`danbooru_inspect`** `{names: string[≤12], type?: "tag"|"wiki"}` → 标签元数据 + wiki 正文（截断）
**`danbooru_related`** `{name, category?, limit?≤30}`
- 复用 `danbooru-tools/danbooru_tools`（单一客户端，不复制代码）；结果在内存中缓存 1 小时。

**`load_skill`** `{name, reference?}`
- 清单 = `generation-skills/*/SKILL.md` 的 frontmatter `name`；`reference` 取自该 skill 的 `references/*.md` 文件名。
- 返回正文 Markdown（截断 16000 字）。

**`list_characters`** `{}` → `[{name, short_description}]`
**`get_character`** `{name}` → 角色 JSON + 匹配的 `bindings/*.json`。

### 5.4 系统提示词

从旧版 `FORGE_AGENT_SYSTEM_PROMPT` 迁移，规则保留：

- 有附图时先逐张做客观视觉清单，再改提示词；不编造身份、画外内容。
- 附图用 `read_attachment` 读原参数；读不到元数据时明确说明是按像素重建的。
- 描述图片时默认输出英文、中文两版连续描述。
- 混合提示词：自然语言块和 tag 互不强转；用户要 NL 时实际写入 Forge 的必须包含 NL 块。
- 抽象风格名要展开成具体可见细节再写入。
- 先读后写，用最新 hash；非空字段只能打补丁；负向不生效时要说明，不擅自改 CFG。
- 工具报错时修正参数或重新读取后再试，不盲目重复同一失败写入。
- 角色/实体先查 styles 和角色定义，再查 Danbooru；不凭记忆编造。
- 切换 checkpoint 或按模型写提示词前，先用 `model_info` 了解底模和用法。
- 回复简短，不复述已改内容，用用户的语言。

删除：`generate_image`、`load_tools`、`prompt_toolkit` 相关段落。新增：**你不能出图；需要看效果时请用户点击生成，再用 `read_latest_image` 查看。**

---

## 6. HTTP 接口

前缀 `/prompt-agent/v2`。全部 JSON（除流式与图片）。错误统一 `{"error": {"code", "message"}}` 加相应 HTTP 状态码；错误信息不得包含 API Key 或本地绝对路径。

### 6.1 配置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/profiles` | `{profiles: [...], default_id}`；每项含 `has_api_key`，不含 key |
| PUT | `/profiles/{id}` | 新建或更新；`api_key` 字段：省略=不变，`""`=清除，非空=设置 |
| DELETE | `/profiles/{id}` | 删除配置和对应密钥 |
| PUT | `/profiles/default` | `{id}` |
| POST | `/profiles/{id}/models` | 调上游 `GET {base_url}/models` 返回模型 id 列表，用作连接测试 |
| GET/PUT | `/settings` | `{civitai_enabled, has_civitai_key}`；PUT 可带 `civitai_api_key` |

配置字段：`id`（服务端生成）、`name`（1–40 字）、`base_url`（http/https，末尾的 `/chat/completions` 会被去掉）、`models`（1–100 个 `{id, vision}`，id 不重复）、`reasoning_effort`（`""|none|low|medium|high|xhigh`，可用值取决于模型的对话模板；`""` 表示不发送。旧配置里的 `none` 导入为 `""`）、`temperature`（可空，0–2）、`max_tokens`（可空，256–200000）。旧格式（单个 `model` + `vision`）读取时自动转换。

### 6.2 对话

`POST /chat`：`{profile_id, model, messages, tools, reasoning_effort?}` → 透传上游 `text/event-stream`。`model` 必须是该服务商已配置的模型之一，否则 400。
- 服务端设置 `stream: true`、`stream_options.include_usage`、`temperature`，忽略浏览器传来的同名字段。`reasoning_effort` 优先用请求体里的值（必须在允许列表里，否则 400），否则用服务商设置。
- 请求体上限 32 MB。
- 客户端断开时服务端必须关闭上游连接。
- 上游非 2xx：读取错误体，清洗后返回同状态码的 JSON 错误。

### 6.3 会话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions` | 列表 |
| POST | `/sessions` | 创建 `{title?, profile_id}` |
| PATCH | `/sessions/{id}` | `{title?, profile_id?}` |
| DELETE | `/sessions/{id}` | 永久删除含附图 |
| GET | `/sessions/{id}/messages?before_seq=&limit=60` | 分页，按 seq 升序返回 |
| PUT | `/sessions/{id}/messages/{msg_id}` | 幂等写入；新消息服务端分配 `seq` |
| DELETE | `/sessions/{id}/messages?from_seq=` | 删除该 seq 及之后（编辑重发用） |
| POST | `/sessions/recover` | 把所有 `streaming` 改为 `interrupted`，页面加载时调用 |

### 6.4 工具

`POST /tools/{name}`：body 为工具参数，返回 §5.1 的结果格式（工具级错误也是 HTTP 200）。只接受 §5.3 列出的名称，未知名称 404。

`GET /context`：skills 与角色清单（用于系统提示词）。`GET /forge/options`：sampler、scheduler、upscaler、checkpoint、preset 的可选值。

### 6.5 附图

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/attachments?session_id=` | 原始字节上传（`Content-Type` 为图片类型） → `{id, width, height, pnginfo}` |
| GET | `/attachments/{id}` | 原图 |
| GET | `/attachments/{id}/model` | 给模型用的缩放 JPEG |

---

## 7. 数据

### 7.1 目录

根目录 `data/prompt-agent/`（可用环境变量 `SD_FORGE_NEO_PROMPT_AGENT_DATA` 覆盖）。

```
profiles-v2.json          配置（不含 key）
secrets-v2.dpapi.json     {profile_id: 密文, "civitai": 密文}
settings-v2.json          civitai_enabled 等
v2.sqlite3                会话与消息
attachments/<session>/<id>.<ext>
model-info/<sha256>.json
```

旧文件（`profiles.json`、`secrets.dpapi.json`、`sessions.sqlite3`）只读，v2 不修改、不删除。

### 7.2 SQLite

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
  profile_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);  -- 迁移 2：ALTER TABLE sessions ADD COLUMN model TEXT
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  status TEXT NOT NULL CHECK (status IN ('complete','streaming','stopped','error','interrupted')),
  content TEXT NOT NULL DEFAULT '', reasoning TEXT NOT NULL DEFAULT '',
  tool_calls TEXT, tool_call_id TEXT, tool_name TEXT,
  attachments TEXT, error TEXT, usage TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mime TEXT NOT NULL, width INTEGER, height INTEGER, bytes INTEGER,
  sha256 TEXT NOT NULL, pnginfo TEXT, created_at INTEGER NOT NULL
);
```

- 时间为毫秒时间戳；JSON 列存字符串。
- 启用 WAL 和外键；`PRAGMA user_version` 记录结构版本，升级在启动时顺序执行。

### 7.3 旧配置导入

- 条件：`profiles-v2.json` 不存在且 `profiles.json` 存在。只执行一次。
- 导入 OpenAI 兼容类型的配置：名称、Base URL、模型、推理强度；其余类型跳过并记录数量。
- Base URL 沿用 v1 的含义：路径里没有 `/v1`、`/v1beta`、`/openai` 时补 `/v1`（`api.deepseek.com` 除外）。
- 对应密钥：从 `secrets.dpapi.json` 复制密文到 `secrets-v2.dpapi.json`（同一 entropy，无需解密）。
- 设置页显示一次"已导入 N 个配置，跳过 M 个"。

### 7.4 文件写入

- JSON 文件：写临时文件后原子替换。
- DPAPI 仅 Windows；非 Windows 保存 key 时返回错误"仅支持 Windows 加密存储"。

---

## 8. 安全与隐私（硬性）

1. API Key 和 Civitai Key 只在 Python 内解密，只在需要的那次请求中使用；不出现在任何响应、日志、错误信息中。
2. 浏览器不能指定上游 URL 之外的连接目标；`/chat` 只连该配置的 `base_url`。
3. 服务端不根据浏览器传来的路径或 URL 读文件；所有资源名称来自服务端枚举。
4. 不自动重放工具调用；agent 无出图能力。
5. 只对外发送：LLM 请求（到用户配置的端点）、Danbooru 查询、Civitai 哈希查询。
6. 会话无鉴权，能访问 Forge 页面的人就能读取历史；README 写明。

---

## 9. 性能预算

| 项 | 目标 |
|---|---|
| 前端 bundle | < 80 KB gzip |
| 面板挂载 | Forge 加载完成后 < 100 ms 可交互 |
| 流式渲染 | 300 条消息的会话中流式输出，无 > 50 ms 的长任务（DevTools Performance） |
| 切换会话 | 300 条消息 < 200 ms 显示最近 60 条 |
| 内存 | 连续 30 轮对话后 JS 堆不持续增长（多次 GC 后回落） |
| 流式写盘 | 每条消息流式中至多每 2 秒一次 |

实现约束：流式只更新当前消息；历史消息对象不可变，不随新 token 重建；不用逐字动画定时器；滚动跟随合并到一个 `requestAnimationFrame`。

---

## 10. 中文文案

- 所有 UI 文案集中在一个 `zh.ts`；代码中不出现散落的中文字面量。
- 工具中文名：读取提示词、修改提示词、读取参数、修改参数、查看最新出图、读取附图、搜索资源、查看资源、模型信息、Danbooru 搜索、Danbooru 查看、相关标签、加载技能、角色列表、角色定义。
- 常用错误文案：

| 情形 | 文案 |
|---|---|
| 未配置 | 还没有可用的模型配置，去设置里添加一个 |
| 网络错误 | 连接模型服务失败：{原因} |
| 401/403 | API Key 无效或没有权限 |
| 上下文超长 | 超出模型上下文长度（上游原文），提示新建会话或调整本地 -c / -np / --kv-unified |
| 停止 | 已停止 |

---

## 11. 工程规范

### 11.1 目录

```
scripts/prompt_agent.py        Forge 钩子，只注册路由
prompt_agent/                  Python 包（不使用 backend/ 名称，避免与 Forge 的 backend 包冲突）
  api.py chat.py profiles.py secrets.py settings.py sessions.py attachments.py pnginfo.py
  knowledge/ resources.py model_info.py danbooru.py skills.py characters.py
frontend/                      前端源码与构建配置
javascript/prompt_agent.js     构建产物（唯一一个浏览器脚本，不手改）
tests/                         Python 测试
generation-skills/ character-definitions/ danbooru-tools/   内容与共享库，v2 只读
data/                          运行数据，不入库
```

### 11.2 规则

- 源文件建议 ≤ 400 行，硬上限 1000 行（构建产物除外）。
- Python ≥ 3.11，带类型注解；除 Forge 已有的 `httpx`、`Pillow` 外不加运行时依赖。
- 前端 TypeScript `strict`；依赖版本锁定，新增依赖需说明理由。
- 所有 Forge DOM 选择器只能出现在 `frontend/src/forge/` 下。
- 浏览器全局只占用一个命名空间 `window.__PROMPT_AGENT_V2__`。
- 日志前缀 `[prompt-agent]`；不记录消息内容、key、图片。

### 11.3 测试

- Python `unittest`：配置导入与 DPAPI、`/chat` 转发与断开、会话存储与恢复、附图与 pnginfo、所有 Python 工具的参数校验（含路径注入用例）、model_info 的 sidecar/缓存/离线路径。
- 前端单测：SSE 解析（含推理字段与 `<think>` 标签）、agent 循环（mock 流和工具：正常、出错、停止、上限）、提示词补丁与 hash 规则、参数校验、轮状态机每条结束路径都回到 `idle`。
- 真机检查：每个里程碑在本机 Forge Neo 上走一遍主流程，结果写进提交说明。
- 修 bug 时补一个能复现它的测试（能测的话）。

### 11.4 Git

- 小步提交，每次提交前看 `git status --short` 和 `git diff --stat`，只暂存本次相关文件。
- 提交信息英文，首行说明做了什么。
- 不提交 `data/`、`node_modules/`、包管理缓存、构建中间产物。

---

## 12. 视觉规范

定稿：A（融入 Forge）+ B（聊天式输入与标签摘要）+ C（等宽内联 diff）。配色跟随当前 Gradio 主题和明暗模式。

### 12.1 颜色变量（定义在面板根节点 `.pa-root`）

所有颜色从 Gradio 主题变量派生，括号里是主题缺变量时的回退值。明暗由 `<body>` 的 `dark` 类决定，面板用 MutationObserver 跟随切换，亮色时加 `.pa-light`。

| 变量 | 来源 | 用途 |
|---|---|---|
| `--pa-text` | `--body-text-color`（`#e6e8ee`） | 正文 |
| `--pa-bg` | `--background-fill-primary`（`#10141f`） | 面板底色 |
| `--pa-bg-raised` | 正文色 5% 混入底色（亮色 3%） | 输入卡片、弹出菜单 |
| `--pa-bg-sunken` | 黑色 22% 混入底色（亮色：正文色 4%） | diff、代码块底色 |
| `--pa-bubble` | 主色 14% 混入 raised | 用户消息气泡 |
| `--pa-chip` / `--pa-hover` / `--pa-line` / `--pa-line-strong` | 正文色 6% / 9% / 10% / 16% 透明混合 | 标签、悬停、分隔线、描边 |
| `--pa-text-2` | 正文色 72% 混入底色 | 标签文字、次要信息 |
| `--pa-muted` | `--body-text-color-subdued`（`#8b93a7`） | 提示、占位、图标 |
| `--pa-accent` | `--color-accent`（`#f97316`） | 发送/停止、流式光标 |
| `--pa-on-accent` | `--button-primary-text-color`（white） | 主色按钮上的文字 |
| `--pa-accent-soft` / `--pa-accent-text` / `--pa-focus` | 主色 16% / 主色 60% 混入正文 / 主色 55% | 提示词修改标签、焦点环 |
| `--pa-ok` / `--pa-bad` / `--pa-warn` | 暗色 `#5fd39a` `#f2817f` `#f5c451`；亮色 `#15803d` `#dc2626` `#b45309` | 成功/diff 新增、失败/diff 删除、中断/重试 |

主色只用于：发送/停止按钮、流式光标、焦点环、提示词修改标签。其他地方一律中性色。

### 12.2 字体与尺寸

- 正文：Gradio `--font`，回退 `ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif`，13px，行高 1.55。
- 等宽（diff、代码、工具参数）：Gradio `--font-mono`，回退 `ui-monospace, "Cascadia Code", Consolas, monospace`，11.5px，行高 1.6。
- 小字（标签、快捷键提示、时间）：12px / 11px。字重只用 400 和 500。
- 间距基数 4px：消息间距 14px，面板内边距 12–14px，标签间距 6px。
- 圆角：标签 999px，按钮 7–8px，diff/代码块 8px，输入卡片 14px，用户气泡 `14px 14px 4px 14px`。
- 不用阴影和渐变；层次靠底色深浅和分隔线。

### 12.3 组件

| 组件 | 规格 |
|---|---|
| 顶栏 | 高 48px；会话标题（500 字重）+ 下拉箭头；模型标签带 6px 状态点（绿=可用，黄=重试中，红=上次失败）；右侧 28px 图标按钮：新会话、模式切换、设置 |
| 用户消息 | 右对齐气泡，最大宽 80%；附图缩略图在气泡上方，高 88px |
| 助手消息 | 无底色；上方一行标签（思考、各工具调用），下方正文 |
| 标签 | 高 24px；图标 + 简短文字。状态：运行中=文字变亮 + 旋转图标；成功=默认；失败=`--pa-bad` 文字 + 警告图标。可展开的标签带上下箭头 |
| 展开内容 | 标签行下方：提示词修改显示等宽 diff（保留前后各 1 行上下文，删除行 `−` 红、新增行 `+` 绿）；其他工具显示参数与结果 JSON |
| 流式光标 | 7×14px `--pa-accent` 实心块，跟在正文末尾 |
| 输入卡片 | `--pa-bg-raised`，圆角 14px；上为输入框（自动增高，最多 8 行），下为工具行：附图按钮、"最新出图"描边标签、快捷键提示、发送/停止方形按钮（28px，主色） |
| 错误 | 正文下方一行 `--pa-bad` 文字 + "重试"文字按钮 |
| 折叠边条 | 宽 28px，`--pa-bg`，竖排图标；有进行中的请求时显示主色小点 |

### 12.4 交互细节

- Enter 发送，Shift+Enter 换行；输入法组合输入中按 Enter 不发送。
- 焦点环：`0 0 0 2px var(--pa-accent)` 半透明，仅键盘焦点显示。
- 动效只用于：标签展开（120ms 高度/透明度）、旋转图标；遵守 `prefers-reduced-motion`。
