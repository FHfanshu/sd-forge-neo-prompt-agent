# Prompt Agent v2 重写计划

日期：2026-10-08
状态：草案，等确认后开工

## 1. 决策

- 项目复活，在原目录做**大规模重写**（不是原地重构）。扩展名、`data/` 目录位置都不变。
- 旧代码打 tag `pre-v2` 冻结，v2 在分支 `v2` 上开发，验收通过后合回 `main`。
- 依据：`scratchpad/audit_haiku.md`（Haiku 5.5 只读审计）。旧实现约 1.85 万行产品代码，
  三套持久化、两套协议实现、两套工具层；v2 目标约 5k 行。

## 2. 产品范围

一句话：**Forge 页面里停靠一个中文 agent 对话面板，agent 能读写提示词和全部生成参数，
但不能出图；用户自己点 Generate，再把结果交给 agent 看、继续改。**

### 保留

| 功能 | 说明 |
|---|---|
| 停靠对话面板 | 右侧固定面板，挤压 Forge 页面而不是浮在上面；可折叠，只能拖宽度 |
| 流式对话 | OpenAI 兼容接口；流式文本、推理过程（默认折叠）、中止 |
| 读写提示词 | 正/负提示词，txt2img/img2img；保留 hash 防覆盖 + "非空只能打补丁" 规则 |
| 读写生成参数 | 全部暴露：steps、sampler、scheduler、CFG、seed、宽高、batch、高清修复、重绘幅度、checkpoint、preset |
| 看图 | 用户贴图/附图；一键"附上最新出图"；读 PNG 参数（pnginfo）；视觉模型可看像素 |
| Forge 资源 | 搜索/查看 styles、LoRA、wildcards（角色触发词在 styles 里） |
| 模型信息 | checkpoint / LoRA 的底模、触发词、推荐参数、说明：本地 sidecar → 本地缓存 → Civitai 按哈希查询 |
| Danbooru | 标签搜索、标签+wiki 查看、相关标签、wiki 搜索（只留一份客户端） |
| Skills | `load_skill` 读 `generation-skills/*/SKILL.md`（单一来源） |
| 角色定义 | `list_characters` / `get_character` 读 `character-definitions/`（含 bindings） |
| 会话历史 | 列表、切换、重命名、删除、新建 |
| LLM 配置 | 多个配置项，每项只有：名称、Base URL、模型、API Key、（可选）推理强度 |

### 去掉

- `generate_image` 工具（agent 无出图权限）
- 浮动/可拖拽窗口、启动器、移动端布局、visualViewport 处理
- 跨浏览器同步、修订号、冲突副本、IndexedDB、BroadcastChannel
- prompt_toolkit 与语义 diff 卡片、`load_tools` 渐进披露、上下文裁剪（先不做）
- 追问队列（流式中发送按钮变"停止"即可）、收藏/最近模型、每条消息的推理选择器、上下文用量条
- 图片索引（`on_image_saved` 钩子）、settings-export 路由、健康检查之外的杂项路由
- Gemini 原生 provider、英文界面与三份翻译表
- 测试门禁 `tools/test_gate.py`、`quality/` 验收映射、强制 AUDIT 记录、旧 ROADMAP
- Tailwind、bits-ui、Pi agent 库、旧的手写 `javascript/prompt_agent_0*.js`

## 3. 架构

```
浏览器（单个 bundle）                         Python（Forge 进程内）
┌───────────────────────────────┐           ┌──────────────────────────────┐
│ Panel.svelte  停靠面板          │           │ scripts/prompt_agent.py       │
│ store.ts      单一状态源        │  HTTP     │   on_app_started 挂路由        │
│ agent.ts      agent 循环        │ ───────▶  │ api.py      路由               │
│ openai.ts     SSE 解析（唯一）  │  /pa/v2   │ chat.py     转发到 LLM，注入 key │
│ forge.ts      Forge DOM 读写    │           │ profiles.py 配置 + DPAPI        │
│ tools.ts      工具定义+执行      │           │ sessions.py SQLite（唯一存储）   │
└───────────────────────────────┘           │ knowledge/  资源/danbooru/skill/角色│
                                             └──────────────────────────────┘
```

要点：

- **agent 循环在浏览器**，因为提示词/参数工具本质是改 Forge 页面的 DOM。手写循环
  （约 200 行）：发请求 → 读流 → 执行工具 → 回填结果 → 继续，最多 N 轮。
- **Python 只做转发**：浏览器只传 `profile_id` 和消息，Python 解密 key、拼 URL、
  原样转发 OpenAI SSE。协议解析只在 TS 写一次（只支持 OpenAI 兼容，所以不需要归一化层）。
- **API Key 永远不进浏览器**；Python 不接受浏览器传来的 URL、路径、模型以外的端点参数。
- **知识类工具**（资源、Danbooru、skill、角色）在 Python 执行；名称只能从目录清单里选，不接受路径。
- **存储**：服务端 SQLite 唯一权威。消息按条追加/更新（不再整会话上传）；
  流式中只在消息完成或每 2 秒落一次盘。刷新时未完成的消息标记"已中断"，绝不重放工具调用。

## 4. 前端设计

### 布局

```
┌ Forge 页面（右侧留出面板宽度）───────────┬─ 面板 ───────────────────┐
│                                          │ [会话标题 ▾] [模型 ▾] [+][⚙]│
│                                          │──────────────────────────│
│                                          │ 用户消息                  │
│                                          │ ▸ 思考（折叠）            │
│                                          │ ✓ 修改正向提示词  +3 −1 ▸ │
│                                          │ 助手回复（Markdown）      │
│                                          │──────────────────────────│
│                                          │ [📎][🖼最新出图]          │
│                                          │ ┌──────────────────────┐ │
│                                          │ │ 输入框                │ │
│                                          │ └──────────────[发送/停止]│
└──────────────────────────────────────────┴──────────────────────────┘
```

- **只做停靠，不做悬浮窗。** 面板有两种显示方式，用一个按钮切换，都不能拖动位置：
  - 挤压：Forge 页面让出右侧宽度（默认）；
  - 覆盖：面板盖在页面右侧，不改 Forge 布局，适合窄屏或要看大图库时。
  另外可折叠成右边缘的细条，宽度可拖（只有这一个拖拽手柄，宽度存 localStorage）。
  理由：旧版"怪"和卡的大头在浮窗（拖拽、缩放、z-index、视口/键盘处理、启动器丢失），
  覆盖模式已经给了悬浮窗"不占布局"的好处，代价只有几行 CSS。
- 会话列表从标题下拉打开；设置在面板内切换视图，不弹窗口。
- 工具调用每次一行，点开看参数和结果；提示词修改展开后显示简单红绿 diff。
- 只有中文文案，集中在一个 `zh.ts`。
- 样式用 Svelte 作用域 CSS，统一 `pa-` 前缀，不注入任何全局 reset，避免污染 Gradio。

### 性能规则（针对上次卡死的根因）

1. 流式中的消息只渲染纯文本追加；完成后才做一次 `marked` + DOMPurify。
2. 历史消息渲染一次后不再变化（不可变对象 + keyed each），流式 token 只更新当前消息。
3. 列表只挂最近 60 条，向上滚动加载更早的。
4. 不用定时器做逐字动画；滚动跟随用一个 `requestAnimationFrame` 合并。
5. 图片附件存服务端（会话目录下文件），消息里只放引用，不长期持有 base64。
6. bundle 目标 < 80 KB gzip（现在 242 KB）。

## 5. 工具清单（给 agent）

| 工具 | 执行位置 | 说明 |
|---|---|---|
| `read_prompt` | 浏览器 | 返回正/负提示词、hash、负向是否生效 |
| `edit_prompt` | 浏览器 | `base_hash` 必填；补丁操作：replace/append/prepend/delete/insert_before/insert_after；字段为空时才允许整段写入 |
| `read_generation_parameters` | 浏览器 | 当前全部参数 + 可选值列表（sampler、scheduler、upscaler、checkpoint、preset）+ `context_hash` |
| `set_generation_parameters` | 浏览器 | 带 `context_hash`；值必须在可选值列表/范围内 |
| `read_latest_image` | 浏览器→Python | 取 Forge 图库当前/最新输出：pnginfo + 图片（视觉模型时） |
| `read_attachment` | Python | 读用户附图的 pnginfo / 像素 |
| `search_resources` / `inspect_resource` | Python | styles、LoRA、wildcards |
| `model_info` | Python | `kind`=checkpoint/lora + 名称（必须在 Forge 模型列表里），返回底模、触发词、推荐参数相关说明、标签、版本说明、Civitai 链接、来源；`refresh` 可强制重查 |
| `danbooru_search` / `danbooru_inspect` / `danbooru_related` | Python | tags 与 wiki；`danbooru_inspect` 同时接受 tag 名和 wiki 标题 |
| `load_skill` | Python | 列出/读取 `generation-skills` |
| `list_characters` / `get_character` | Python | 读 `character-definitions` |

所有工具每次都全量发送 schema。系统提示词从旧版迁移，删掉 generate_image、load_tools、
prompt_toolkit 相关段落，其余规则（hash 读后写、负向未启用要说明、混合 NL/tag、
错误后修正重试、回复简短）原样保留。

### 模型信息查询顺序（`model_info`）

1. **本地 sidecar**：模型文件旁的 `.json`（Forge 额外网络卡片：说明、激活词、推荐权重）
   和 `.civitai.info`（Civitai Helper 类扩展留下的）。
2. **本地缓存**：`data/prompt-agent/model-info/<sha256>.json`，命中直接返回。
3. **Civitai**：用 Forge 自带的哈希缓存取 SHA256（没有就现算一次并写回 Forge 缓存），
   请求 `GET /api/v1/model-versions/by-hash/{sha256}`，再取 `/api/v1/models/{modelId}`
   的说明；HTML 转纯文本、截断后写入本地缓存。找不到也缓存"未找到"（7 天后可重查）。

- 设置里一个开关"允许联网查询 Civitai"（默认开）和一个可选 Civitai API Key（同样 DPAPI 加密）。
- 只发送哈希，不上传文件名或路径。大文件首次算哈希可能要几十秒，工具结果会说明"正在计算"。
- 推荐参数不做结构化解析，把作者说明原文（截断）交给 agent 自己读。

## 6. 数据与迁移

| 文件 | v2 处理 |
|---|---|
| `data/prompt-agent/profiles.json` | 只读，首次启动导入为 `profiles-v2.json`（OpenAI 兼容项；其他类型跳过并在设置页提示） |
| `data/prompt-agent/secrets.dpapi.json` | 密文直接复制到 `secrets-v2.dpapi.json`，同一 entropy，key 不用重填 |
| `data/prompt-agent/sessions.sqlite3` | 不导入、不修改（保留以便回滚） |
| 新增 `data/prompt-agent/v2.sqlite3` | 会话 + 消息表 |
| 新增 `data/prompt-agent/attachments/` | 附图文件 |
| 浏览器 IndexedDB / localStorage 旧键 | 不读，放弃 |

旧文件一律不改不删，回滚只需切回 `pre-v2`。

## 7. 测试（精简）

- Python `unittest`：配置导入与 DPAPI、chat 转发（mock httpx，含中止）、会话存储、
  知识类工具的输入校验（拒绝路径/越界名称）。
- 前端 `vitest`：SSE 解析、agent 循环（mock 流 + mock 工具）、提示词补丁与 hash 规则、store。
- 真机检查（每个里程碑）：在本机 Forge Neo 上手动/浏览器面板走一遍主流程。
- 不再有门禁脚本、验收映射、强制审计日志。`AGENTS.md` 重写成一页。

## 8. 里程碑

| # | 内容 | 完成标准 |
|---|---|---|
| M0 | 打 tag `pre-v2`，建分支 `v2`；新 `AGENTS.md`；清空旧代码骨架 | 仓库只剩 v2 骨架 + 内容目录 + `data/`，Forge 能正常启动 |
| M1 | Python：profiles + DPAPI + 导入、chat 转发、sessions | 单测通过；用现有 key 能 curl 出流式回复 |
| M2 | 前端：停靠面板、对话、会话、设置，无工具 | 真机：发送/流式/停止/刷新/切会话正常；300 条消息的会话流式不卡 |
| M3 | Forge 工具：提示词 + 参数 | 真机：txt2img/img2img 读写正确，hash 冲突能自我纠正 |
| M4 | 图片：附图、最新出图、pnginfo、视觉 | 真机：出图后一键交给 agent 分析并改参 |
| M5 | 知识工具：资源、模型信息（Civitai + 缓存）、Danbooru、skills、角色 | 各工具真机调用一次成功；断网时模型信息走缓存/sidecar 不报错 |
| M6 | 删旧代码与文档、更新 README、合回 `main` | 全量单测 + 真机主流程通过 |

每个里程碑一个或几个小提交。

## 9. 风险

- **Forge DOM 变动**：所有选择器集中在 `forge.ts`，M3 前先在当前 Forge Neo 上逐个确认。
- **DPAPI**：只支持 Windows；非 Windows 在保存 key 时明确报错。
- **会话无鉴权**：能访问 Forge 的人就能看历史，与旧版一致，README 写明。
- **未提交的内容改动**：`character-definitions/` 和 `bindings/` 的未提交修改不动，由你决定何时提交。
