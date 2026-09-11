# Forge Neo Prompt Agent：前端体验与按需信息工具 PRD

版本：v1.0 · 2026-09-11  
状态：可用于实现规划；本文交付需求与契约，尚未修改产品代码。  
仓库：https://github.com/FHfanshu/sd-forge-neo-prompt-agent

## 1. 产品决策

保留 Svelte 5、Vite、现有 Pi Agent 与 Python 边界。优先解决动效缺乏连续性、设置排布混乱、信息一次性展开，以及 Agent 无法可靠读取图片来源参数的问题。

角色目前通过 Forge 风格预设中的触发词使用。继续以现有 style 为内容来源，增加可选的分类、封面与检索能力，不另建一份角色提示词数据库。

渐进式披露同时作用于两个独立层面：

1. 用户界面：先显示状态、摘要和主要操作，需要时展开详情。
2. Agent 上下文：先返回有界检索结果，需要时读取选中项的具体字段或图片。

折叠界面不等于节省模型上下文。前端展开详情也不应自动把详情发送给模型。

## 2. 已核实的现状与边界

| 现状 | 依据 | 产品含义 |
| --- | --- | --- |
| Svelte 独立挂载，悬浮层使用 fixed 定位 | frontend/src/bootstrap.ts、styles.css | 可独立调整布局与动效，无须迁移框架 |
| 视觉 token 大量映射 Forge 主题 | frontend/src/styles.css | 保留明暗兼容，自行定义字号、间距、层级与动效 |
| 设置已有 model、connection、generation、local、routes 分区 | frontend/src/components/ProfileSettings.svelte | 重组已有字段，避免重复增加另一套设置 |
| 资源已有 search_resources / inspect_resource | prompt_agent/forge_resources.py、backend/prompt_agent/forge_tools.py | 扩展既有检索契约，避免功能重复 |
| style 保存 prompt、negative_prompt，搜索会截取预览 | prompt_agent/forge_resources.py | 角色触发词继续从预设读取；截断需显式标记 |
| generate_image 当前取首张新画廊图片，并转为 JPEG 返回 | javascript/prompt_agent_03_generate_image.js | 需补稳定图片标识、批次映射与原始参数来源 |
| 附件可能缩放并转为 WebP | frontend/src/attachments.ts | 必须在转码前保全 PNGInfo |
| Roadmap Phase 12 尚有未完成项 | ROADMAP.md | 对本需求涉及的负面词状态、diff 和窄屏验证保持兼容 |

核查基于当前 main 源码，未运行用户本地 Forge。动效与布局问题来自用户反馈，具体复现由实现 Agent 在真实宿主补齐。下文新增工具名、字段、阈值均为拟定契约，不能宣称仓库已具备。

## 3. 目标场景

- 用户调整远程模型连接，只需看到地址、凭据状态、模型和测试结果。
- 用户切换本地模型，再展开本地运行相关参数，当前输入不丢失。
- 用户搜索角色预设，预览完整触发词后引用到对话，或明确应用到 Forge。
- 用户说“读这张图的 PNGInfo”，Agent 读取文件元数据并说明缺失字段。
- 用户说“刚才那张用了什么参数”，Agent 找到确定的最近完成图，读取对应快照。
- 用户说“看一下刚才出的图”，Agent 按需读取视觉输入，而非只读参数后声称看过画面。
- 搜索 LoRA、预设、wildcard、标签、Wiki 时，用户和模型先看到短结果，再读取相关项。

## 4. 范围与优先级

| 优先级 | 内容 |
| --- | --- |
| P0 | 设置重排、动效基础、PNGInfo 提取保全、最近生成查询、按需图片读取、资源结果分层、失败恢复 |
| P1 | 风格预设分类与封面、收藏、预设编辑冲突保护、较早生成记录按需索引 |
| P2 | 多图参数比较、按生成参数检索历史、独立大尺寸资产浏览模式 |

不在本轮：框架迁移、新 Agent runtime、角色训练系统、自动整理整个磁盘、自动恢复全部生成环境。PNGInfo 读取不承诺完整复现原图。

## 5. 前端布局

### 5.1 悬浮窗与导航

- 保留现有可拖动、可缩放窗口；不引入新的窗口状态机。
- 聊天保持主要入口；设置与资源浏览通过明确入口进入。
- 打开设置保留聊天草稿、附件、滚动位置；关闭后焦点回到触发按钮。
- 窄窗口使用单内容区，返回时恢复上一层位置，避免多个小弹窗重叠。
- 输入框、模型选择器、发送与停止控件的位置不随加载状态跳变。

### 5.2 设置的信息架构

先盘点现有所有字段、默认值、保存方式、provider 适用条件，再输出字段迁移表。禁止重排时遗漏已有能力。

| 分区 | 默认可见 | 按需展开 |
| --- | --- | --- |
| 连接与模型 | 配置名称、连接类型、地址/凭据状态、模型选择、测试连接 | 备用地址、能力覆盖、协议特殊选项 |
| 回复偏好 | 默认推理强度、输出上限；既有提示词偏好如已实现则保留 | Temperature、Top P 等细节 |
| 本地运行 | 仅本地模式显示模型配置状态、启动/停止状态 | 硬件分配、卸载策略和其他已有本地参数 |
| 高级 | 已设置项目的简短摘要 | routes 与其余低频配置，沿用现有语义 |

“回复偏好”用于 LLM 参数，避免与 Forge 出图参数都叫“生成设置”。连接类型切换不得悄悄删除已有不适用字段。

布局规则：

- 标签统一置于控件上方，说明紧贴所属字段；错误贴近字段显示。
- 表单默认单列。仅宽高等真正关联的短字段可以并排。
- 以设置内容区宽度而非浏览器宽度决定列数；不足 560px 时强制单列。
- 长地址、模型名、路径输入占满可用宽度，不挤进窄列。
- 间距采用 4/8/12/16/24/32px；正文建议 13–14px，分组标题 15–16px，窗口标题 17–18px。最终用真实宿主截图微调。
- 分组主要靠留白和标题，避免每个字段再套一层边框卡片。
- 已折叠但存在错误的分组显示错误标记；定位错误时展开并聚焦对应字段。
- 保持现有保存语义，提供“保存中 / 已保存 / 保存失败”；失败保留本地输入，并允许重试。快速切换配置时禁止旧响应覆盖新配置。

### 5.3 渐进式披露的界面层级

| 层级 | 内容 | 触发 |
| --- | --- | --- |
| 摘要 | 状态、结果数量、简短描述、主要动作 | 默认 |
| 详情 | 参数分组、完整预设内容、单条搜索结果详情 | 点击相应项 |
| 原始数据 | 原始 PNGInfo、工具 JSON、解析警告 | 明确点击“原始信息” |

- 工具执行中显示简短动作，例如“正在查找角色预设”。
- 完成显示“找到 8 个预设”等事实；空结果、失败、部分成功需区分。
- 搜索默认显示最多 5 条用户可读结果，剩余项用“显示更多”；不改变模型收到的独立预算。
- 搜索中的旧结果可暂留，但必须显示更新中；过期请求不能覆盖新查询。
- 展开历史工具结果只读取已保存详情，不重跑原工具。
- 大文本有固定可滚动详情区域和复制按钮，不撑高整个聊天窗口。

## 6. 动效规范

动效用于说明位置、层级和状态变化。禁用全局 transition: all；拖拽、流式文字和滚动不添加跟手延迟。

| 交互 | 拟定表现 | 时长 |
| --- | --- | --- |
| 打开悬浮窗 | 轻微缩放 0.98→1 与淡入，原点参考入口方向 | 160–200ms |
| 关闭悬浮窗 | 轻微淡出，完成后卸载可交互内容 | 100–140ms |
| 切换设置分区 | 容器尺寸稳定，内容淡入，可附 4px 内位移 | 120–160ms |
| 展开字段/详情 | 有界内容高度过渡，长列表采用淡入 | 160–200ms |
| 菜单与 tooltip | 淡入与微小位移 | 80–120ms |
| hover / pressed | 颜色及轻微反馈 | 80–120ms |
| 拖动、缩放、连续输入 | 立即响应，不对坐标做缓动 | 即时 |

- 使用 Svelte 既有 transition / animate / motion 能力；不为此引入大型动效依赖。
- 动效可被打断；快速开关以最后一次意图为准，不积压队列或产生幽灵遮罩。
- 首次加载窗口恢复不从屏幕角落飞入。
- prefers-reduced-motion 下取消缩放和位移，保留必要状态反馈。
- 动效不改变焦点顺序，不使隐藏控件仍可 Tab 访问；Escape 先关闭最上层菜单，再处理窗口。
- 目标是拖拽流畅、无明显掉帧。性能验证记录浏览器与设备，不用单个开发环境的帧率作普遍承诺。

## 7. 预设与角色资产

### 7.1 数据关系

Forge style 的 prompt / negative_prompt 为唯一提示词事实来源。附加的 UI 元数据保存 preset_ref、category、cover_image_id、favorite、display_name，可选 revision。分类至少允许角色、画风、其他。

不得从名称自动认定角色身份，不把同名 LoRA 自动绑定到预设。已有预设未分类时仍正常可用。

现有 style ID 使用名称，实现需处理重命名：有宿主稳定 ID 则复用；否则维护显式映射，无法判断时显示待重新关联，不按近似名字合并。封面丢失降级占位，不能阻止预设使用。

### 7.2 浏览与操作

- 支持按名称、触发词、分类搜索；无封面时采用简洁文本行，不要求补全封面才能使用。
- 默认显示名称、分类、短预览；点击展开完整正负提示词。
- “加入对话”只引用预设，Agent 在需要时 inspect 完整内容，不自动改 Forge。
- “应用到 Forge”明确目标字段与预设组合结果，沿用既有宿主 style 语义，避免重复添加触发词。
- 含占位符的 style 需按宿主规则合成，不能直接字符串拼接；组合多个预设需保持顺序。
- 负面词存在但当前未启用时，显示“已配置，当前未生效”，不擅自调整 CFG。
- P1 编辑预设时原子保存并校验版本；外部修改冲突保留草稿，先重新读取再处理。

## 8. 图片身份与元数据保全

### 8.1 统一逻辑引用

引入 ImageRef：image_id、source、generation_id?、batch_index?、created_at?、time_source、target?、width、height、metadata_status、availability。

- source 区分用户附件、生成完成记录、当前画廊回退、历史索引。
- image_id 为宿主授权范围内稳定逻辑 ID；工具参数不接受任意路径或远程 URL。
- metadata_status 区分 available、partial、absent、unsupported、error。
- 图片文件时间、生成时间、导入时间分别记录，不混称生成时间。
- 当前界面“选中图”与“最近完成图”分别建模，不静默互换。

### 8.2 保全流程

原始附件/生成输出 → 在原始字节或可靠宿主快照中提取元数据 → 保存来源与结构化结果 → 再生成压缩视觉副本。

- PNGInfo 读取不能依赖已经转为 JPEG/WebP 的视觉副本。
- 浏览器上传附件需要增加受限提取通路或在客户端先提取再由后端验证；本轮默认采用后端受限提取端点，复用既有授权与附件限额。
- 原始文件不要求无限期保留；至少将提取后的有界元数据和图片引用持久化，明确原图可用状态。
- 优先复用实际 Forge 版本的 metadata parser；具体导入接口须实机核对。支持典型 Forge/A1111 parameters；其他格式可返回原始文本与 unsupported/partial。
- 不把当前 UI 参数补成旧图参数。允许读取生成完成时保存的快照，但必须标明 snapshot 来源。
- 原文件元数据与快照冲突时分别返回并标记冲突，禁止无提示混合。
- 元数据、Wiki 和资源文本作为不可信内容数据处理，不能提升为 Agent 系统指令。

## 9. 新增 Agent 只读工具契约

每个工具需要前端 TypeBox schema、Python 参数验证、超时、AbortSignal、结构化错误和用户可读状态。以下工具名为设计稿，落地时统一注册、代理、持久化与测试边界。

### 9.1 list_recent_generations

输入：target=active|txt2img|img2img；scope=session|host_recent，默认 session；limit 默认 8、上限 20；cursor 可选；include_grids 默认 false。

输出：items、next_cursor、has_more、scope、coverage、snapshot_id。items 包含 ImageRef 摘要及简短描述，不含完整提示词、原图或 base64。

- session 限当前 Agent 会话关联生成；host_recent 为当前宿主已索引的完成记录，包括用户手动生成。
- 按 completed_at 降序，同时间以 generation_id 和 batch_index 稳定排序。
- 首选生成完成钩子记录。当前 gallery 仅作为明确标记的回退，不能声称覆盖全部历史。
- “刚才那张”优先当前会话最近完成图；存在批次歧义且动作取决于具体图片时，展示候选缩略图选择。
- 批次的每张图有独立 image_id 与参数映射，拼图有单独类型，默认排除。
- 分页锚定快照；新生成显示“有新结果”，刷新后更新顺序，旧游标不重复漏项。
- P0 保存最近 200 个完成批次的轻量索引，不复制输出图片；淘汰索引不删原文件，不破坏已保存对话证据。
- 启动前的旧输出不在 P0 覆盖范围；返回 coverage 明示起点。P1 按需扫描授权输出目录，禁止全盘扫描。

### 9.2 read_pnginfo

输入：image_id 必填；fields 可选，默认 summary；允许字段 summary、positive_prompt、negative_prompt、generation_parameters、extra_metadata；原始全文使用结果详情工具按段读取。

输出：image_id、metadata_status、source、parser_format、requested_fields、data、missing_fields、warnings、result_id、truncated。

summary 返回有无元数据、已识别字段名及短参数摘要。generation_parameters 可包含 steps、sampler、scheduler、CFG、seed、尺寸、checkpoint 名称/哈希、已识别的高分辨率参数；不可识别字段保留在 extra_metadata。

- seed 如超出 JS 安全整数范围，采用十进制字符串无损传递。
- 缺失返回 null/字段缺失及 missing_fields，不伪造默认值或估计值。
- 外部截图无元数据时明确 absent；视觉推断另行说明，不能包装为 PNGInfo。
- read_pnginfo 不调用生图、不写提示词、不加载或切换模型。
- 图像损坏、元数据过大、来源失效分别返回可恢复错误，不使整个回合永久阻塞。
- 读取元数据文本不要求模型具备视觉能力。

### 9.3 read_image

输入：image_id；detail=preview|standard，默认 preview。输出受限图像内容块与 image_id、原始尺寸、实际传输尺寸、缩放状态。

- 视觉判断时才调用。元数据查询和搜索不能自动携带图像内容块。
- 检查当前模型视觉能力；不支持时返回 vision_unsupported，仍允许读 PNGInfo。
- 复用现有图片压缩、单图与整回合附件预算；同图同规格在同回合去重。
- 原图引用失效但元数据仍在时，PNGInfo 可读、视觉读取报 image_unavailable。
- UI 缩略图通过宿主受限资源访问，不将宿主文件 URL 当作模型可访问地址。

### 9.4 read_tool_result

输入：result_id；selector 使用允许的字段/条目选择器；cursor 可选；max_chars 默认 4000、上限 12000。

输出：selected_data、next_cursor、has_more、truncated、available_sections、source_tool、source_version。

- 用于长 PNGInfo、Wiki 正文和搜索结果附加详情；单资源语义读取仍优先 inspect_resource。
- result_id 绑定原结果及会话权限；不能枚举其他会话私有结果。
- 截断以字段或条目边界进行；原始长文本以稳定字符段分页，JSON 必须始终合法。
- UI 展开走详情读取 API，Agent 显式调用才进入模型上下文。
- 快照持久化到现有历史体系并保持有界；单结果拟定上限 256KiB，超过则保存截断标志和重新查询入口，禁止声称完整。
- 历史 result_id 不可用时返回 result_unavailable 并提供可执行重新检索建议，不能自动执行旧的写工具。

## 10. 既有检索工具的分层契约

复用 search_resources、inspect_resource、Danbooru 标签与 Wiki 系列工具。P0 不新增“搜索有哪些工具”的动态发现层；这里优先解决工具返回内容过量。工具发现如后续确有需求另立范围。

| 类型 | 搜索返回 | 详情返回 |
| --- | --- | --- |
| style | ID、名称、分类、匹配片段、截断标志 | 完整请求字段、版本与占位符信息 |
| LoRA | ID、名称、架构摘要、短触发词片段 | 指定激活词、推荐权重与允许的 metadata |
| wildcard | ID、名称、token、相关摘要 | 分页匹配值 |
| model / embedding | 逻辑 ID、显示名 | 现有允许详情，不返回路径 |
| Danbooru tag | 名称、分类与短描述 | 别名、相关信息，Wiki 按需 |
| Wiki | 标题、短摘要、下一步引用 | 分段正文与相关引用 |

新统一投影字段：result_id、items、returned_count、has_more、next_cursor、truncated、available_sections。准确 total 仅在低成本且可确定时返回，否则 null。外部来源无真实分页能力时明确 has_more=false 并提示细化查询，不能伪造下一页。

预算建议：Agent 默认检索 8 条、单条摘要不超过 240 字符、普通响应总文本目标不超过 6000 字符；字符预算用于工程约束，不能宣称等于固定 token 数。对旧调用端通过兼容投影迁移，禁止直接删字段导致现有 runtime 失效。

过滤可匹配完整已索引内容，返回只携带相关片段。完整触发词应用前必须 inspect，禁止把截断的 snippet 直接当完整预设使用。

缓存键包含工具、规范化查询、分页快照及资源版本。资源刷新后作废旧检索缓存；历史已展示证据保留原版本。

## 11. Agent 行为策略

| 用户意图 | 正常调用顺序 | 约束 |
| --- | --- | --- |
| 这张图的参数 | 确定附件 ID → read_pnginfo 请求参数字段 | 不必 read_image |
| 看刚才图的构图 | list_recent_generations → read_image | 不能只读元数据后声称看过图 |
| 找角色触发词 | search_resources(style) → inspect_resource | 命中后停止无关搜索 |
| 沿用上张图但改背景 | list_recent_generations → read_pnginfo → read_prompt / read_generation_parameters → 按已授权目标执行现有写工具 | 旧图参数与当前状态分开，保留 freshness guard |
| 查某标签用法 | search_danbooru_tags → 指定详情或 Wiki | 只读有关段落，避免递归遍历 |

仅提供摘要提示模型可用的后续工具。禁止自动展开每条命中、自动翻到最后一页、自动加载全部 Wiki 或最近图片。

生成结果默认返回批次 ID、图片 ID 与状态摘要；用户明确要求查看或评估时再读视觉内容。修改旧 generate_image 的返回结构需同步 provider 适配与历史恢复兼容。

已有用户授权的修改继续执行，无需为每一次只读工具调用追加确认。只要求“读取/查看”时不执行应用参数或生成。

中止之后保留已完成只读证据；刷新只恢复历史，不恢复工具执行。取消 Agent 等待与中断 Forge 出图是不同动作，必须分别显示实际状态。

## 12. 架构落点与数据安全

- 前端：独立设置分组组件、预设浏览组件、图片引用组件、结果摘要/详情组件；拆分过大的 Surface/ProfileSettings 时按用户操作边界进行。
- Agent runtime：负责工具编排与状态；UI store 仅映射，禁止创建第二套执行状态源。
- Python：图片引用授权、原始元数据提取、完成记录索引、结果详情验证；仍不执行 Agent loop。
- Forge adapter：接入实际完成事件，映射 batch/image；避免用首个新 img.src 作为唯一成功证据。
- SQLite 为持久历史权威，IndexedDB 为缓存；扩展 schema 需迁移与刷新中断处理。
- 图像引用只解析到服务端登记的附件或授权输出文件；验证路径归属与链接逃逸，不暴露任意磁盘读取接口。
- 元数据解压与文本解析设资源上限：拟定文本展开总量 1MiB、单请求 10 秒；超过返回 metadata_too_large/timeout。仅读取 metadata 时避免无必要完整解码巨图。
- 不在日志和 AUDIT 中保存原始提示词、图片或 API 密钥；工具输出不包含凭据与绝对文件路径。

## 13. 验收场景

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| UX-01 | 设置内容区 360/480/720px | 无横向溢出，字段不挤压，长文本可编辑，标签顺序清晰 |
| UX-02 | 切分区与开关设置 | 草稿与焦点正确恢复，窗口不跳位，无重复遮罩 |
| UX-03 | 快速连续开关 10 次 | 最终状态正确，隐藏控件不可聚焦，交互不被残留层拦截 |
| UX-04 | 减少动态效果、键盘、触摸 | 动效降级，Escape 层级正确，折叠区不藏住错误 |
| UX-05 | 保存失败与配置切换 | 输入保留，可重试；旧请求不写入新配置 |
| PRE-01 | 已有角色 style | 无迁移提示词即可搜索，inspect 保留完整触发词 |
| PRE-02 | 预设引用和应用 | 引用不改 Forge；应用保留占位符/顺序语义，不重复添加 |
| IMG-01 | 带参数 PNG 经压缩转码 | read_pnginfo 仍返回原始元数据，source 明确 |
| IMG-02 | 无元数据截图、损坏图、大 metadata | 分别给出 absent/error/超限，后续对话仍可发送 |
| IMG-03 | 手动及 Agent 生成、批量 4 张含拼图 | 每张参数对应正确，最近排序准确，拼图默认排除 |
| IMG-04 | 生成期间手动改变当前参数 | 上一张图仍读取其快照，不能被当前 UI 值污染 |
| IMG-05 | 文件删除、刷新、服务重启 | 标识状态真实，已保存元数据可读；不重放生成 |
| IMG-06 | 查询期间插入新生成 | 旧分页不重复漏项，刷新后新项可见 |
| TOOL-01 | 大量资源及长 Wiki | 摘要响应有界、截断可见、详情能定向读取 |
| TOOL-02 | 用户展开工具详情 | 不额外调用模型，不重跑原工具 |
| TOOL-03 | 非视觉模型查询图片参数 | PNGInfo 正常；视觉读取明确不支持 |
| TOOL-04 | 元数据含指令文本、非法图片 ID | 内容不变成系统指令，越权请求被拒绝 |
| TOOL-05 | 中止、超时、过期结果 | 状态终止准确、输入可用、无自动写入重试 |
| DATA-01 | 旧会话和旧工具结果 | 仍能展示，缺少新字段时降级，无刷新执行 |

真实 Forge 验证需使用实际主题、远程模型配置、本地配置、长名称预设与真实 PNGInfo 样本。记录截图和可见状态；不以精确像素、计时器次数或私有 DOM 结构代替语义验收。

## 14. 实施顺序与交付门槛

1. 基线：读取 AGENTS/ROADMAP，复现设置和动效问题，核实 Forge 版本与完成钩子，输出现有字段迁移表及图片来源图。
2. 体验基础：设置重排、统一动效与状态反馈；真实数据验证，维持原工具能力。
3. 图片基础：ImageRef、原始 metadata 提取、持久化、完成批次映射与最近索引。
4. 工具闭环：list_recent_generations、read_pnginfo、read_image，完成“刚才那张图”场景。
5. 信息分层：read_tool_result、既有检索投影、UI 摘要与按需详情，验证模型上下文确实有界。
6. P1：预设分类封面与编辑；在基础体验和数据完整性验收后推进。

每步小范围提交，禁止把 UI、存储迁移、图片解析与工具契约塞进一个不可审查的大改动。实现时维护 quality/acceptance.json；行为变更按仓库工具 bump revision。开发运行 affected gate，最终运行 full gate，并更新 AUDIT。

必须遵守仓库 Node 22.17.0 / pnpm 10.12.4。javascript/prompt_agent_90_ui.js 通过构建生成，禁止手工修改；源文件与文档遵守 1000 行限制。若无法访问真实 Forge，交付时明确“实机验收未完成”，不能以 mock 覆盖宣称全部完成。

## 15. 可直接交给实现 Agent 的任务说明

> 依据本文实施 Forge Neo Prompt Agent 体验与只读信息工具升级。先读仓库 AGENTS.md、ROADMAP.md 及相关架构约束。保留 Svelte 与单 Pi runtime，角色继续复用 style 触发词。先完成设置字段清单和真实状态复现，再按第 14 节顺序推进。所有新增工具需要 schema、Python 校验、取消/超时、结构化结果及持久化兼容。PNGInfo 必须来自原始元数据或明确标识的生成快照，先提取后转码；最近生成必须正确关联批次和图片。将 UI 折叠与模型上下文按需读取分开实现。不要以截图美化代替数据与状态验收，不自动应用读取结果，不重新执行历史工具。完成每步后报告修改、验证结果和实际限制；遇到接口未知先查当前 Forge 代码，避免凭空实现假接口。

## 16. 源码参考

- [仓库规则](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/AGENTS.md)
- [路线图](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/ROADMAP.md)
- [设置实现](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/frontend/src/components/ProfileSettings.svelte)
- [前端样式](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/frontend/src/styles.css)
- [附件转码](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/frontend/src/attachments.ts)
- [当前生图工具](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/javascript/prompt_agent_03_generate_image.js)
- [资源搜索与详情](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/prompt_agent/forge_resources.py)
- [工具服务端验证](https://github.com/FHfanshu/sd-forge-neo-prompt-agent/blob/main/backend/prompt_agent/forge_tools.py)
