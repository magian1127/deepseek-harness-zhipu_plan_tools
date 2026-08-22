# 运行架构（architecture）

> 本文件是运行结构、模块契约、关键架构决策与调研事实的权威位置。
> 用户可见行为见 `behavior.md`，实现规则见 `development.md`。

## 接入方式

把智谱（GLM Coding Plan）三个 MCP Server 的能力以 DSH 原生 provider / 工具形式接入：

| MCP | 端点 | DSH 接入点 |
| --- | --- | --- |
| 联网搜索 search-mcp-server | `https://open.bigmodel.cn/api/mcp/web_search_prime/mcp`，工具 `web_search_prime` | `ctx.web.registerSearchProvider`，patch `web` 行 `searchProvider`，**接管内置 `web_search` 后端** |
| 网页读取 reader-mcp-server | `https://open.bigmodel.cn/api/mcp/web_reader/mcp`，工具 `webReader`（返回 markdown） | `ctx.web.registerFetchProvider`，patch `web` 行 `fetchProvider`；**不启用 `web_fetch` 开关**，DSH 启用后自动生效 |
| 开源仓库 zread-mcp-server | `https://open.bigmodel.cn/api/mcp/zread/mcp`，工具 `search_doc(repo_name,query,language?)` / `get_repo_structure(repo_name,dir_path?)` / `read_file(repo_name,file_path)` | `ctx.tools.register(defineTool(...))` 注册 3 个仓库工具：`github_search_doc` / `github_get_repo_structure` / `github_read_file` |

## 模块契约

- **mcp-http.ts**：`createMcpSession(endpoint, apiKey)` → `{ call(tool, args, signal) }`，内部 `initialize`（响应头取 `Mcp-Session-Id`）→ `notifications/initialized` → `tools/call` → `DELETE`（5s 短超时、尽力而为、abort 后不等待）；SSE 帧解析取首个含匹配 id 的 `data:` JSON；RPC `error`/`isError:true` → 稳定 code 的 ZhipuError；上游包含结构化 `contentFilter` 时归类为 `ZHIPU_CONTENT_FILTERED`，返回固定短提示，不透传上游长错误。
- **zhipu-search.ts**：provider id `zhipu-web-search-prime`；`search()` 原样调 `web_search_prime {search_query}`（不静默改写/硬拒绝查询），映射 `{link,title,content,publishedAt}` → `WebSearchSource{url,title,snippet,publishedAt}`；maxResults 由 seam 截断。
- **zhipu-reader.ts**：provider id `zhipu-web-reader`；`fetch(url)` 调 `webReader {url, return_format:'markdown', retain_images:false, timeout:20}`，双层 parse 后取 `content`，超 200_000 字符截断置 `truncated:true`；普通 `isError`/解析失败 → ZhipuError(`WEB_PROVIDER_ERROR`)，结构化 `contentFilter` → `ZHIPU_CONTENT_FILTERED`。
- **zhipu-zread.ts**：3 个 defineTool，timeoutMs 60_000；参数说明显式写明 `repo_name` 必须 `owner/repo`；`github_read_file` / `github_get_repo_structure` 结果为文本直接返回；`github_search_doc` 的 `language` 参数可选；`isConcurrencySafe: () => true`；`presentCall` generic 卡（title=repo_name 等关键参数）；MCP 内容过滤错误沿用 `ZHIPU_CONTENT_FILTERED`。
- **systemPrompt.section**：为 3 个 `github_*` 工具各加一行简短指引（强调 `repo_name` 传 `owner/repo`，order 110+），另加 `tool:web_search:query-guidance` 指引模型把搜索目标收窄、补充实体/时间/来源等限定；不覆盖官方 `tool:web_search`/`web_fetch` section。
- **cordis.patch.yml**：

  ```yaml
  - id: web
    config:
      searchProvider: zhipu-web-search-prime
      fetchProvider: zhipu-web-reader
  - insert:
      - id: dsh-zhipu
        name: deepseek-harness-zhipu_plan_tools
  ```

  边界：patch 固定指向 provider id；若在插件 config 关掉 `search`/`reader` 而 patch 未删对应行，内置工具会报 provider unavailable。

## 关键架构决策

1. **不用内置 mcp-client 组合行桥接**：`StreamableHttpConfig.headers` 是静态字符串直接透传 `requestInit`，API key 必须硬编码进 cordis.yml；原生实现统一走 DSH 凭据服务，凭据可热更新、不落盘到配置。
2. **HTTP 用 Node 全局 fetch 替代 curl 子进程**：node fetch 调通全部 remote MCP 端点，新实现直接 fetch。
3. **`dshHome()` 回退**：harness 主进程不导出 `DSH_HOME`，home 解析语义（官方 `resolveDshHome`）为「显式配置 > `$DSH_HOME` > `~/.dsh`，空白视为未设置」；任何读凭据/配置的代码必须带 `~/.dsh` 回退。同时配套两项机制：**注册幂等保护**（遇 `already registered` 跳过，防双实例）与**自监视热重载**。
4. **webReader 结果映射**：响应是双层 JSON 编码字符串（需 `JSON.parse` 两次）得 `{title,url,content(markdown),...}`；映射为 `WebFetchResult{statusCode:200, body:{kind:'text',content}, truncated}`。
5. **reader 跟随部署开关**：patch 只覆盖 `web` 行 `fetchProvider`，绝不触碰 `tool-web` 行 `fetch` 开关。
6. **CLI 完整仿造但简化自迁移**：复制 dsh-zh 的 CLI 框架与标记文本层行管理；改为「热行/桥接行自清理」——插件 apply 时检测自己是热行或桥接行实例且对应行仍在 patch/manifest 中，则直接清理，当前进程继续作为唯一实例。
7. **zread 工具用小写 `github_` 前缀命名**：语义直观、全小写与内置工具零冲突，且工具说明内显式声明 `repo_name` 必须为 `owner/repo`。
8. **设置体系**（仿 hashline）：host 侧 `ctx.settings.register('dsh-zhipu', Config, { base, applies:'live', exposeToClients:true })` + `settings.watch()`；client 侧 `settings.plugin.item` 槽位注入折叠卡片（`settingsScope` + `locale` + `--dsw-alias-*` 主题 token）；`dsh.client.inject` 声明五个 client 包。
9. **设置开关语义**：`search`/`reader` 是**停用而非回退**——providers 常驻注册，关闭时 `available()` 返回 false 且调用报结构化错误；真正回退内置需删 patch 对应行。
10. **热挂载通道**：官方 patch-layer watcher 在当前运行版本可能不生效；可靠通道是动态插件的 `ctx.loader.create({ id, name })`（dsh-zh 自迁移同款机制）。`loader.create` 的 `name` 必须是**包名**（否则设置卡片 client.js 404）；query URL 热挂载只对**单文件 bundle** 有效 → host 侧 tsdown 单文件化。

## 复盘修订记录（2026-08-20）

1. **工具命名改为全小写**：原用 `GitHub_` 大写前缀，联调发现过大写与内置风格不一致且模型易误读；改为 `github_search_doc` / `github_get_repo_structure` / `github_read_file`，并在 `description` 与 `systemPrompt.section` 显式声明 `repo_name` 必须为 `owner/repo`。
2. **修复自监视热重载空转 bug**：`self-hot-reload.ts` 的 `ctx.effect` 回调体把清理动作直接写在回调体内（立即执行、注册即关闭 watcher），改为 cleanup 作为返回值后自监视恢复。详见 `development.md` 踩坑 7。

## 调研事实存档

- 三个 remote MCP 端点（`web_search_prime` / `web_reader` / `zread`）均以 `ZAI_CODING_CN_API_KEY` Bearer 认证实测调通；`vision/mcp`、`reader/mcp` 等候选 URL 均 404，正确端点为 `web_reader/mcp`。
- `webReader` 输入参数：`url`（必填）、`timeout`（秒，默认 20）、`no_cache`、`return_format`（markdown/text）、`retain_images`、`no_gfm`、`keep_img_data_url`、`with_images_summary`、`with_links_summary`；输出为双层 JSON 编码字符串。
- zread `tools/list`：`search_doc{repo_name,query,language?}`、`get_repo_structure{repo_name,dir_path?}`、`read_file{repo_name,file_path}`。
- DSH 预设 `tool-web` 行默认 `fetch: false`（`web_fetch` 默认关闭），`search` 默认开启。
- DSH 侧契约：`packages/web/web/src/types.ts`（WebSearchProvider/WebFetchProvider/WebFetchResult）、`packages/web/tool-web/src/{search,fetch}.ts`（defineTool 范例）、`packages/core/tools/src/index.ts`（ToolDefinition）、`packages/mcp/mcp-client/src/`（headers 静态透传证据）。
- hashline 设置模板：host `settings.register(ns, Config, {base, applies:'live', exposeToClients:true})` + `settings.watch()`；client `slots.inject('settings.plugin.item')` + `slots.register({name,key,locale}, Card)` + `settingsScope.bind({namespace})` + `locale.register`；卡片为折叠 header + toggle/文本控件 + 恢复默认/放弃/保存 footer。

## 路线图

- 视觉理解 vision-mcp-server（二期）：GLM-4.6V `chat/completions` 原生工具。
- MCP 会话复用/连接池（减少每调用 ~1 RTT）。