# 运行架构（architecture）

> 本文件是运行结构、模块契约、架构决策、调研事实与技术路线图的权威位置。
> 用户可见语义见 [`behavior.md`](behavior.md)，本插件实现约束和热挂例外见 [`development.md`](development.md)。

## 运行结构

插件把智谱 GLM Coding Plan 的三个 MCP 服务接入 DSH，但不向模型暴露原始 MCP 会话：

| 能力 | 智谱 MCP | DSH 接入点 | 模型侧名称 |
| --- | --- | --- | --- |
| 联网搜索 | `web_search_prime` | `ctx.web.registerSearchProvider`，由 patch 配置 `searchProvider` | 保持内置 `web_search` |
| 网页读取 | `webReader` | `ctx.web.registerFetchProvider`，由 patch 配置 `fetchProvider` | 保持内置 `web_fetch` |
| 开源仓库 | `search_doc` / `get_repo_structure` / `read_file` | `ctx.tools.register(defineTool(...))` | 三个 `github_*` 工具 |

搜索和读取是 **provider 替换**；仓库能力是 **原生工具注册**。设置默认值、停用语义以及 `web_fetch` 的独立开关见 [`behavior.md`](behavior.md)。

## 组件与数据流

```text
模型工具调用
├─ web_search / web_fetch
│  └─ DSH web provider registry
│     └─ zhipu-search / zhipu-reader
└─ github_*
   └─ DSH tools registry
      └─ zhipu-zread

三类调用 → credentials → mcp-http → 智谱 MCP → 结果映射 / 稳定错误码
设置页 → settings namespace → live watch → provider 可用性、工具和提示动态装卸
构建产物变化 → self-hot-reload → DSH HMR partialReload
```

模块边界：

| 模块 | 契约 |
| --- | --- |
| `src/index.ts` | 聚合 provider、工具、system prompt、settings 与自监视热重载；所有副作用随 Fiber 清理 |
| `src/credentials.ts` | 解析凭据并实现 `${DSH_HOME:-~/.dsh}` 回退；不泄露 Key |
| `src/mcp-http.ts` | 完成 MCP 初始化、通知、工具调用和尽力清理；解析 JSON/SSE，映射稳定错误 |
| `src/zhipu-search.ts` | provider id `zhipu-web-search-prime`；传递 `search_query` 并映射搜索来源 |
| `src/zhipu-reader.ts` | provider id `zhipu-web-reader`；请求 Markdown，解析双层 JSON 并映射 `WebFetchResult` |
| `src/zhipu-zread.ts` | 注册三个 `github_*` 工具、参数 schema、60 秒协作超时与通用展示卡片 |
| `src/settings-schema.ts` / `src/client.ts` | 注册 `dsh-zhipu` 设置命名空间和浏览器设置卡片，实时同步六个字段 |
| `src/self-hot-reload.ts` | 精确监视 host 构建产物，并通过官方 HMR API 局部重载 |
| `src/bin/` | 管理持久行、临时热行和桥接行；按可用能力选择热挂载通道 |

## 挂载契约

随包发布的 `cordis.patch.yml` 只承担两件事：

```yaml
- id: web
  config:
    searchProvider: zhipu-web-search-prime
    fetchProvider: zhipu-web-reader
- insert:
    - id: dsh-zhipu
      name: deepseek-harness-zhipu_plan_tools
```

- `web` 行把内置工具路由到插件 provider，不修改 `tool-web.fetch`；
- `dsh-zhipu` 行挂载插件本体；开发期的其他行 id 及清理规则见 [`development.md#不可破坏的约束`](development.md#不可破坏的约束)。

## 关键架构决策

### 原生 provider 与工具，而非通用 MCP 组合行

通用 MCP 配置的请求头是静态字符串，容易迫使 API Key 落入配置。原生接入可以统一使用 DSH credentials 服务、支持凭据热更新，并保持模型熟悉的 `web_search` / `web_fetch` 名称。

### 每次调用使用独立 MCP 会话

`mcp-http` 当前按 `initialize` → `notifications/initialized` → `tools/call` → `DELETE` 执行。清理使用短超时并尽力而为；取消后不等待清理。用户可见的延迟边界见 [`behavior.md#调用边界与失败模式`](behavior.md#调用边界与失败模式)。

### provider 常驻、关闭即回退，工具按设置装卸

搜索和读取 provider 常驻 registry;`available()` 在开启态看智谱凭据,关闭态看回退可用性(搜索看 `DEEPSEEK_API_KEY`,读取恒可用)。三个仓库工具随 `zread` 动态注册或卸载。具体设置语义只在 [`behavior.md#设置语义`](behavior.md#设置语义) 定义。

### web_search 工具与说明的 Agent 作用域阴影

`search` 开启时,仅对继承视图中原 `web_search` 可见的 Agent 注册同名工具与 `tool:web_search` 说明(systemPrompt.section scope 层阴影全局),沿 dsh-hashline 的 scoped-shadow 模式(`src/search-tool.ts`),不突破 preset 隐藏策略;其中**极简模式(minimal 预设)——“仅持久 shell + str_replace_editor”的双工具组合——直接豁免**,不注册阴影(`index.ts` 的 `isMinimalAgent` 经 `agentPresets.composedPreset(agent.ctx)` 判定);`zread` 开启时还在极简 Agent 作用域以 `restrict` deny 全局 `github_*` 工具——与 hashline 同理:极简 agent 的继承视图暴露 host 全局注册的工具,必须显式 deny 才能保持双工具承诺,且 deny 与 `search` 开关无关(由 `installAgentSurface` 统一建立表面)。替代工具保留内置的查询数、来源数、工具预算与同批失败取消语义。工具 description 为静态字符串,随 `zhPrompt` 变化由 refresh() 对所有 live Agent 重装;说明 text 为函数,组装时按设置实时取值。新 Agent 由 `agent/created` 事件自动接管。 会话中途切换预设(如 cordis → minimal,DSH `recompose`)时,经官方 `agent-preset/selected` 对目标 Agent 重新评估,撤销已装阴影/改挂 deny,避免残留注入;不得监听 `tools/change` 兜底——工具注册/注销会同步触发它,重装表面又触发它,形成无限递归卡死会话创建。

### 关闭开关不依赖 seam 回退,由 provider 自回退
`web` 行的 `searchProvider` / `fetchProvider` 被 bundle patch 静态 pin 到本插件;`WebRuntime` 在构造时固化 configuredId(只读,运行时不可改),configured provider 不可用时报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`,seam 不会自动选其他 provider。因此关闭开关后:搜索由 provider 内部按 DSH 请求形状直连 DeepSeek 搜索端点(`deepseek-fallback`),读取由 provider 内部执行受限 HTTP(S) 文本抓取(`http-fallback`)。后者负责 URL、同源重定向、内容类型、传输预算与 Fiber 外无持久副作用的边界;剩余 DNS 风险和其他插件兼容边界见 [`behavior.md#关闭后的回退语义`](behavior.md#关闭后的回退语义)。

### 凭据解析带 DSH home 回退

宿主进程不保证导出 `DSH_HOME`。解析遵循“非空 `$DSH_HOME`，否则 `~/.dsh`”，再由 credentials 服务、环境变量与凭据文件组成调用链。安全边界见 [`behavior.md#凭据与数据边界`](behavior.md#凭据与数据边界)，实现硬约束见 [`development.md#不可破坏的约束`](development.md#不可破坏的约束)。

### 动态 Loader 与单文件 host bundle

可靠的运行时挂载使用动态 Loader；query URL 用于绕过 ESM 入口缓存。因为入口 query 不会刷新多模块包的相对导入，host 产物必须保持单文件 bundle。完整热路径与缓存事实集中在 [`development.md#热路径选择智谱专属例外`](development.md#热路径选择智谱专属例外)。

## 调研事实

以下内容只记录影响实现选择的上游事实：

- MCP 端点：
  - 搜索：`https://open.bigmodel.cn/api/mcp/web_search_prime/mcp`；
  - 读取：`https://open.bigmodel.cn/api/mcp/web_reader/mcp`；
  - 仓库：`https://open.bigmodel.cn/api/mcp/zread/mcp`。
- 三个服务均使用 `ZAI_CODING_CN_API_KEY` Bearer 认证；曾验证的 `vision/mcp`、`reader/mcp` 等候选地址不适用。
- `webReader` 支持 `url`、`timeout`、`no_cache`、`return_format`、`retain_images`、`no_gfm`、`keep_img_data_url`、`with_images_summary`、`with_links_summary`；正文位于双层 JSON 编码结果中。
- zread 的工具 schema 为 `search_doc{repo_name,query,language?}`、`get_repo_structure{repo_name,dir_path?}`、`read_file{repo_name,file_path}`。
- DSH 相关契约位于上游 web provider、tool-web、core tools 与 mcp-client 包；查阅上游源码时以实际运行版本为准，不以本地 checkout HEAD 推断运行行为。

## 技术路线图

| 项目 | 方向 | 状态说明 |
| --- | --- | --- |
| 视觉理解 | 将 GLM-4.6V `chat/completions` 能力封装为原生工具，覆盖图像、视频、OCR、UI、图表与 diff | 已完成端点、消息结构、prompt 来源和模型选项调研，待实现 |
| MCP 会话复用 | 连接池或受控会话复用，减少每次调用的初始化往返 | 待设计取消、并发与失效边界 |

版本与 npm 发布状态不属于技术路线图，统一见 [`release.md`](release.md)。
