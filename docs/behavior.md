# 行为契约（behavior）

> 本文件是用户可见行为、默认值、设置语义、失败模式与错误码的权威位置。
> 安装和卸载入口见 [`README.md`](../README.md)；实现原理见 [`architecture.md`](architecture.md)；遇到故障从 [`troubleshooting.md`](troubleshooting.md) 开始。

## 功能总览

| 能力 | 用户可见行为 |
| --- | --- |
| 联网搜索 | 接管内置 `web_search` 后端，调用智谱 `web_search_prime`，返回中英文混合来源 |
| 网页读取 provider | 接管内置 `web_fetch` 后端，调用智谱 `webReader` 并返回 Markdown 正文；DSH v0.1.2 起 Web 端 agent 预设默认提供 `web_fetch` 工具，安装本插件后默认即走智谱后端 |
| 开源仓库工具 | 按设置注册 `github_search_doc`、`github_get_repo_structure`、`github_read_file` |
| Web 设置卡片 | 仅在 `web` profile 的 DSH 设置 → 插件 → 插件配置中显示；支持实时开关、凭据引用和中英界面 |

### Profile 隔离与 Open Design / headless

DSH bundle 按 profile 独立组合。Open Design 实际启动 `dsh --profile open-design --stdio`，不是 stock `headless`；因此本 bundle 必须另装到 `open-design`。安装后，provider、`web_search` Agent scope 阴影和三个 `github_*` 都按本契约工作。stock `headless` 若需要，也要单独安装。

同一 `${DSH_HOME:-~/.dsh}` 下各 profile 共用 settings/credentials。两个非 Web profile 不显示设置卡，但读取相同 `dsh-zhipu` 值。`open-design` stdout 仅允许 JSONL 协议帧，所以信息日志写 stderr；警告/错误本来就不写 stdout。

### 搜索工具的接管与说明替换

`search` 开启时,本插件除接入后端外,还会在 Agent 作用域注册**同名 `web_search` 工具与 `tool:web_search` 说明** —— 阴影全局内置 tool-web 的对应注册(沿 hashline 的 scoped-shadow 模式):

- 仅当该 Agent 的继承视图中原 `web_search` 可见时才建立阴影,不会突破 preset 的隐藏策略;
- **极简模式（minimal 预设）不注入**:该 preset 是“仅持久 shell + str_replace_editor”的双工具组合,本插件不为其建立 `web_search` 阴影;`zread` 开启时还在该 Agent 作用域 deny 全局 `github_*` 工具(极简 agent 的继承视图会暴露 host 全局注册的工具,只有显式 deny 才能保持双工具承诺)——该 deny 与 `search` 开关无关,只要插件 `enabled` 即生效; 会话中途切换预设(如 cordis → minimal)时由 `agent-preset/selected` 重新评估并撤销阴影/改挂 deny,避免残留注入。
- 模型看到的 `web_search` 是本插件的(description 按语言切换),不是内置的;调用保留内置契约的每次 1–4 条查询、30 秒工具预算与同批失败联动取消,合并来源上限由本插件放宽为 12 条(智谱上游固定返回 10 条,单次查询全部展示,高于内置 tool-web 的 8 条);超量返回由插件按请求上限预裁剪,来源面板不再显示「来源列表已截断」;
- 系统提示中的 `tool:web_search` 说明同样只出现本插件的版本,内置原文不会重复出现;调用中与历史回放仍使用 DSH 的搜索结果卡片和结构化来源 meta;
- 说明为**一段自写文本**(体现智谱后端),含使用方式与查询要点:收窄目标、补充时限/地区/版本限定、避免泛化与多问题拼接、先搜后迭代、保留用户原意 —— 不再单独注入查询指引 section;
- 语言:默认英文(与内置工具风格一致),开启 `zhPrompt` 后为中文。

## 设置语义

设置存储在 DSH `settings.yaml` 的 `dsh-zhipu` 命名空间，修改实时生效。Web GUI 中的下表严格按照
可收缩设置卡片从上到下排列；卡片默认收起。非 Web profile 不显示卡片，但读取同一命名空间与默认值：

| 字段 | 类型 | 默认值 | 语义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。关闭后搜索/读取进入兼容回退、仓库工具与提示卸载；设置入口保留 |
| `search` | boolean | `true` | 是否接管 `web_search`。关闭后回退 DeepSeek 原生搜索(见下方回退语义) |
| `reader` | boolean | `true` | 是否接管 `web_fetch`。关闭后回退受限 HTTP(S) 抓取 |
| `zread` | boolean | `false` | 是否注册三个 `github_*` 工具；关闭后立即从模型工具目录移除 |
| `zhPrompt` | boolean | `false` | 提示词中文化:开启后注入的系统提示词 section、`github_*` 工具说明及其错误消息使用中文(默认英文,与内置工具一致);开启时 `zread` 工具会随切换重装 |
| `credentialRef` | string | `ZAI_CODING_CN_API_KEY` | 智谱 GLM Coding Plan API Key 的凭据引用名 |

### 关闭后的回退语义

`search` 或 `reader` 关闭后，web 行配置仍指向本插件 provider(configuredId 静态固化,seam 不回退)，因此由 provider 自身提供回退：

- **搜索回退**:关闭后 `web_search` 仍可用,内部按 DSH DeepSeek provider 的请求形状直连 `https://api.deepseek.com/anthropic/v1/messages` 并使用 `web_search_20250305`,凭据为 `DEEPSEEK_API_KEY`;单次请求含 30 秒本地超时。`available()` 只做本地同步判断,执行时再走完整凭据解析链。
- **读取回退**:关闭后 `web_fetch` 仍可用,内部用 Node `fetch` 抓取公开 HTTP(S) 文本资源。它拒绝 URL 内嵌凭据、显式本机/私网地址、跨源重定向和非文本响应,限制 5 次同源重定向、5,000,000 响应字节与 200,000 正文字符;不提供完整 DNS 重绑定防护。
- **回退兼容边界**:回退目标是内置 DeepSeek 搜索,不是其他插件替换的后端。若部署里有其他插件的 patch 排在本插件之后接管 `searchProvider`,seam 会选中它,本插件无感知;若本插件排最后,关闭后回退的是内置 DeepSeek,而不是被覆盖的其他后端——要恢复其他后端的接管,需从挂载行移除本插件的 provider 指向(卸载通道),不能只关开关。
- 彻底恢复静态配置(让内置 provider 或上层插件重新接管)仍走卸载通道:从挂载行移除 `searchProvider` / `fetchProvider` 指向。

## 凭据与数据边界

### 首次配置

使用前在 **DSH 设置 → 模型** 添加中国区 `zai-coding-cn` 提供商，而不是海外 `zai`。该提供商通过 `apiKeyEnv: ZAI_CODING_CN_API_KEY` 引用环境认证，与插件的默认 `credentialRef` 一致。

确保该引用存在于环境变量或 `${DSH_HOME:-~/.dsh}/.credentials.yaml`；若使用其他变量名，在插件设置卡片修改 `credentialRef`。

### 解析与安全

实际调用按以下顺序解析凭据：

1. DSH credentials 服务；
2. 当前进程环境变量；
3. `${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs` 段。

provider 的 `available()` 只确认 credentials 服务是否可解析或本地环境变量/凭据文件是否已知存在，不发网络请求；指定引用实际缺失时由执行路径返回稳定错误码。API Key 不写入插件配置、日志或错误信息；插件不做遥测、不上传额外数据。搜索/读取开启时只调用智谱官方 MCP；关闭时调用上述 DeepSeek 或 HTTP(S) 回退端点。

## `web_fetch` 启用边界

自 DSH v0.1.2 起，Web 端 agent 预设（standard / ptc / codex）默认在模型工具目录中提供 `web_fetch`。本插件只设置 reader provider、不改工具开关：安装挂载后 `web_fetch` 默认即以智谱 `webReader` 为后端，无需额外启用步骤。

旧版 DSH（Web 组合尚未默认提供 `web_fetch` 时）才需要在 profile patch 中启用：

```yaml
- id: tool-web
  config:
    fetch: true
```

数据边界：开启态抓取在智谱云端执行，本地进程不连接目标地址，但请求 URL 会提交给智谱 MCP；关闭态回退本地受限 HTTP(S) 抓取（见上方回退语义）。

## 调用边界与失败模式

- **凭据缺失**：智谱路径报告 `WEB_PROVIDER_CREDENTIAL_MISSING`;回退路径(内置 DeepSeek 搜索)同样报告该码并提示 `DEEPSEEK_API_KEY`;仓库工具报告 `ZHIPU_CREDENTIAL_MISSING`。先检查 `zai-coding-cn` 与 `credentialRef` 对应的环境变量或凭据文件。
- **历史工具参数异常**：回放旧 `github_*` 调用时，展示层降级为通用卡片；实际执行仍严格校验，`repo_name` 必须是 `owner/repo`。
- **取消与超时**：调用方 `AbortSignal` 全程透传并保持取消语义；调用中止后不等待 MCP 会话清理，DELETE 清理失败不覆盖原结果。插件自身 MCP 请求超时归类为 provider 失败，不伪装成用户取消。
- **会话生命周期**：每次调用独立完成 MCP 初始化、调用和清理，当前不复用连接，额外约有一次握手往返。
- **网页正文上限**：`webReader` 与 HTTP 回退正文最多保留 200,000 字符，超出时返回 `truncated: true`；HTTP 回退另有 5,000,000 字节传输上限。智谱 MCP 响应体另有 8 MiB(8,388,608 字节)读取上限，超出时调用失败。
- **仓库未收录**：zread 上游对未收录或不存在的 `owner/repo` 在 `isError` content 中返回结构化 `repo not found` 错误,插件映射为 `ZHIPU_REPO_NOT_FOUND` 固定提示,引导改用其他方式直接访问 GitHub;消息语言随 `zhPrompt`(默认英文)。上游原文仍只存不可枚举 `detail`,不会自动重试。
- **搜索内容过滤**：上游返回结构化 `contentFilter` 时，插件统一映射为 `ZHIPU_CONTENT_FILTERED`，返回固定短提示，引导将搜索收窄到明确目标并补充实体、时间、地区、指标或来源。不会自动重试或切换后端。
- **回退搜索失败**：内置 DeepSeek 搜索请求失败、超过 30 秒或未返回 `web_search_tool_result` 块时报告 `WEB_PROVIDER_ERROR`;不会自动改回智谱或重试。
- **回退抓取失败**：关闭 reader 后的 HTTP 抓取网络失败报告 `WEB_PROVIDER_ERROR`;超时、URL/重定向策略、响应大小或内容类型失败使用下表对应错误码。非 2xx 文本响应仍作为结果返回,不抛错。
- **错误消息脱敏**：智谱 MCP 与仓库工具的失败消息为固定分类文案（含工具名、状态码与实际请求端点，对齐官方 v0.1.2 起 web_search 失败报端点的行为）；上游响应体/网络错误原文不进入错误消息或 cause，仅以不可枚举属性保留截断供排障。API Key 不会出现在任何错误路径。
- **不可信内容隔离**：搜索结果的标题/摘要经控制字符与 Markdown 结构转义，URL 仅允许 http(s) 且无控制字符（否则退化为纯文本）；网页读取正文前后包裹「外部网页内容（不可信）」边界标记，提示模型不要执行正文中出现的指令。

## 错误码速查

下表同时列出插件自身错误码和可能由 DSH web 层返回的集成错误码：

| 错误码 | 来源与含义 | 第一反应 |
| --- | --- | --- |
| `WEB_PROVIDER_CONFIGURED_MISSING` | DSH：配置指向的 provider 未注册 | 检查插件挂载行和加载状态 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | DSH：provider 已注册但 `available()` 为 false | 检查总开关、功能开关和本地凭据 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 插件：搜索/读取解析不到凭据 | 检查 `credentialRef`、环境变量和凭据文件 |
| `WEB_PROVIDER_ERROR` | 插件或 DSH：搜索/读取传输、解析或 provider 调用失败 | 查看消息中的错误码前缀与 cause |
| `WEB_INVALID_URL` / `WEB_BLOCKED_URL` | HTTP 回退：URL 非 HTTP(S)、过长、含凭据或为显式本机/私网地址 | 改用公开、规范的 HTTP(S) URL |
| `WEB_REDIRECT_BLOCKED` | HTTP 回退：跨源重定向或超过 5 次 | 直接检查并请求可信最终 URL |
| `WEB_UNSUPPORTED_CONTENT_TYPE` | HTTP 回退：响应不是支持的文本类型或字符集 | 改用文本/HTML/JSON/XML 资源 |
| `WEB_FETCH_TOO_LARGE` / `WEB_FETCH_TIMEOUT` | HTTP 回退：响应超过字节上限或 30 秒传输预算 | 使用更小资源或更具体的页面 URL |
| `WEB_ABORTED` | 搜索/读取调用被取消 | 正常取消路径；检查调用方 signal |
| `WEB_DUPLICATE_PROVIDER` | DSH：同一 provider id 被重复注册 | 检查是否存在双挂载并确认幂等保护 |
| `ZHIPU_CREDENTIAL_MISSING` | 仓库工具解析不到凭据 | 同凭据检查步骤 |
| `ZHIPU_DISABLED` | 仓库工具执行时已被设置停用 | 开启 `enabled` 和 `zread` |
| `ZHIPU_PROVIDER_ERROR` | 仓库 MCP 的传输、协议或上游调用失败 | 查看消息前缀与 cause |
| `ZHIPU_REPO_NOT_FOUND` | 仓库工具：zread 上游未收录该仓库(或 `owner/repo` 不存在) | 核对仓库名与真实存在性；未收录仓库改用 `web_fetch` 访问 GitHub 页面 |
| `ZHIPU_ABORTED` | 仓库工具调用被取消 | 正常取消路径；检查调用方 signal |
| `ZHIPU_CONTENT_FILTERED` | 智谱 MCP 内容过滤拒绝了当前请求 | 缩小范围并补充具体限定后重试 |
