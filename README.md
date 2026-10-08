# SD Forge Neo Prompt Agent

在 Forge Neo 页面右侧停靠一个中文 agent 对话面板：和 LLM 一起写、改提示词和生成参数。
**agent 不能出图**——参数调好后由你点 Generate，再点"最新出图"把结果交给它继续改。

## 功能

- 停靠面板：挤压或覆盖两种模式，可折叠、可调宽度
- 读写 txt2img / img2img 的正负提示词（补丁式修改，带防覆盖校验和红绿 diff）
- 读写全部生成参数：checkpoint、预设、采样器、调度器、步数、CFG、种子、尺寸、批次、高清修复、重绘幅度
- 看图：粘贴/拖放/选择图片，或一键附上最新出图；读取 PNG 生成参数，视觉模型可直接看图
- 知识工具：Forge styles / LoRA / wildcards、checkpoint 与 LoRA 的 Civitai 信息（本地缓存）、
  Danbooru 标签与 wiki、`generation-skills/` 技能文档、`character-definitions/` 角色定义
- 会话历史保存在本机 SQLite，刷新页面不会丢，未完成的回复标记为"已中断"
- 只支持 OpenAI 兼容接口；API Key 用 Windows DPAPI 加密保存在服务端，浏览器拿不到

## 安装

把本目录放到 `extensions/` 下并重启 Forge。依赖只有 Forge 自带的 `httpx`、`Pillow`。
在面板右上角 ⚙ 里添加模型配置（Base URL、模型、API Key）。

旧版（v1）的配置和 API Key 会在首次启动时自动导入；旧会话不导入。旧文件不会被修改，
旧版代码在 git 标签 `pre-v2`。

## 数据与隐私

运行数据在 `data/prompt-agent/`（可用环境变量 `SD_FORGE_NEO_PROMPT_AGENT_DATA` 改位置）。
对外只发送：LLM 请求（到你配置的地址）、Danbooru 查询、Civitai 模型哈希查询（可在设置里关闭）。
会话没有单独鉴权：能打开这个 Forge 页面的人就能看到对话历史。

## 开发

见 `AGENTS.md`、`docs/V2_SPEC.md`。
