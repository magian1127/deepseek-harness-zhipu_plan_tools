# 开发指南（development）

> 本文件是本插件的仓库结构、特殊挂载限制、不可破坏约束、开发经验与测试策略的权威位置。
> 用户可见语义见 [`behavior.md`](behavior.md)，架构边界见 [`architecture.md`](architecture.md)，发布清单见 [`release.md`](release.md)。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | host 插件入口与运行时装配 |
| `src/*.ts` | provider、MCP、凭据、设置与热重载模块 |
| `src/client.ts` / `src/client-logic.ts` | 浏览器设置卡片及纯状态逻辑 |
| `src/bin/` | CLI 与 patch 行管理源码 |
| `src/tests/` | `node:test` 测试源码 |
| `cordis.patch.yml` | 随包发布的持久 bundle patch |
| `lib/` / `bin/` / `.tsbuild/` | 构建产物，由 `npm run build`、`prepare` 或 `prepack` 生成 |
| `docs/` | 按主题拆分的权威文档 |

`src/` 是唯一手写程序源码；`lib/`、`bin/` 与 `.tsbuild/` 只能由构建命令生成。

## 热路径选择（智谱专属例外）

本插件的首次挂载因复杂 patch 存在额外限制：

| 场景 | 本插件正确通道 | 验证方式 |
| --- | --- | --- |
| 首次热挂载 | 使用项目 CLI 的桥接/临时行策略；不可仅凭 dsh-zh manifest reconcile 假定成功 | CLI `status` 之外，检查实际 Loader、provider registry 和现有 GUI |
| 自监视尚未安装 | 一次性动态插件对目标文件执行 `hmr.stashed.add(fileUrl)` 与 `hmr.partialReload()` 引导 | 确认真实目标路径进入 `hmr.configs` |

原因：`cordis.patch.yml` 除 `insert` 外还含 `web.config`，而 dsh-zh 的简单 manifest `hotMount` 只接受 `insert → id + name`。本插件 Host 必须保持单文件 bundle，query URL 才能可靠刷新入口；Loader 自身 `loadCache` 不会自动清除。

## 不可破坏的约束

### 包与 client bundle

1. `package.json` 必须保留本包的 `dsh-zhipu` CLI、`.` / `./client` / `./cordis.patch.yml` / `./package.json` exports，以及 `dsh.bundle.patch` / `dsh.client` 声明。
2. `dsh.client.inject` 填客户端**包名依赖**，浏览器插件 `exports.inject` 填 Cordis **服务名**，二者不可混用。
3. `lib/client.js` 由本项目 Client 构建生成经典 `window.__ModuleLoader__.load(...)` bundle，不能手改。

### 挂载、注册与卸载

4. 行 id 不得复用：持久行 `dsh-zhipu`、临时热行 `dsh-zhipu-hot`、桥接行 `dsh-zhipu-bridge`。
5. `cordis.patch.yml` 必须解析为顶层数组；清空最后一个条目后写回 `[]`，不能只剩注释或 `null`。
6. 三通道迁移窗口中的预期重复注册可幂等跳过，但不能吞掉其它异常；桥接卸载按 `entry.options.id` 删除对应 Loader entry。
7. 桥接代码访问 `ctx.loader` 必须声明 `inject: ['loader']`；`loader.create({ id, name })` 的 `name` 必须是包名，不能是 file URL。

### 凭据与设置

8. `dshHome()` 的非空 `$DSH_HOME` → `~/.dsh` 回退不可删除；三层凭据解析的 API Key 永不写入配置、日志或错误信息。
9. 客户端只向 `settings.plugin.item` 注入本插件卡片并使用官方 `settingsScope`；不增加自定义网络请求、遥测或独立持久数据。

## 实现经验

### Schema 与工具调用

- 三个 `github_*` 和 scoped `web_search` 的 parameters/output 都使用纯 JSON Schema，不与 schemastery 简写混用；`required` 只放在对象层数组中。
- scoped `web_search` 只在原工具对目标 Agent 可见时建立阴影,并保持 1–4 查询、30 秒预算、轮询合并与同批失败取消;结果上限由本插件定为 12(智谱上游固定返回 10 条,单查询全量透传,高于内置 tool-web 的 8),不能因改说明文字而退化执行契约。
- `repo_name` 的执行校验保持 `owner/repo`；历史展示可降级，但不能放宽实际 schema。
- 工具参数变更至少走一次 DSH 真实调用，确认实际注册的 schema，而不只验证 TypeScript。

### 回退传输

- `http-fallback` 不得退化为裸 `fetch(..., { redirect: 'follow' })`:必须保留 HTTP(S)/凭据/显式私网 URL 校验、同源重定向、超时、响应字节/字符上限与文本内容类型检查。
- 调用方取消与插件本地超时必须分开分类;search/reader 的 MCP 失败映射为 `WEB_PROVIDER_ERROR`,仓库工具使用 `ZHIPU_PROVIDER_ERROR`,结构化内容过滤保持 `ZHIPU_CONTENT_FILTERED`。

### 跨端设置

- 设置卡订阅建立后立即按当前快照渲染；host 与 client 各自维护默认值时，改名后全仓库搜索旧名和新名，避免六个设置字段跨端漂移。

### 安装与解析

- 持续开发使用 CLI 的 `--link <项目路径>`；`.npmrc` 的 `omit=peer` 用于避免 link 安装时在插件根生成第二份宿主 peer。
- 不在文档或脚本硬编码本机绝对路径。
- Open Design 使用独立 `open-design` profile；安装/验收不能以 `headless` 代替。其 probe/models/stdio stdout 是严格 JSONL，`src/index.ts` 的信息日志在该 profile 必须写 stderr，不能污染协议帧。

### 上游异常分类

宽泛搜索可能被上游以 `contentFilter` 拒绝，也可能返回 `No results found`。这不是判断协议参数错误的充分依据。实现只识别结构化过滤信号并映射稳定错误码；具体用户行为以 [`behavior.md#搜索工具的接管与说明替换`](behavior.md#搜索工具的接管与说明替换) 和 [`behavior.md#错误码速查`](behavior.md#错误码速查) 为准。
zread 上游对未收录/不存在的仓库在 `tools/call` 的 `isError` content 中返回双层 JSON 错误(内层 msg 含 "repo not found")。`mcp-http` 将其映射为 `ZHIPU_REPO_NOT_FOUND` 固定文案;正则漏检时安全降级为 `ZHIPU_PROVIDER_ERROR`,不放宽脱敏边界。
`github_*` 工具执行路径的错误消息(ZHIPU_DISABLED / ZHIPU_CREDENTIAL_MISSING / ZHIPU_PROVIDER_ERROR / ZHIPU_REPO_NOT_FOUND)随 `zhPrompt` 切换:默认英文,开启后中文;`zhPrompt` 经 `HttpOptions` 与 `resolveApiKey` 的 language 参数传入,search/reader 路径不传保持中文。
上游 `web_search_prime` 无结果条数参数(schema 实测,`additionalProperties:false`),超量返回固定发生;搜索 provider 按 `request.maxResults` 预裁剪再返回,使 seam 的 `capSources` 不触发(seam 的 `truncated` 语义限定为 seam 自身丢弃来源,provider 预裁剪时报告 false)——对齐官方 Exa provider 的行为,UI 不再出现「来源列表已截断」。

## 测试策略

- **纯逻辑单测**：覆盖设置归一化、schema、凭据文件解析、patch 行、DeepSeek/HTTP 回退策略和搜索合并边界。
- **假 Context 装配测试**：验证 provider、Agent scope、动态装卸、HMR、可逆清理，以及 `open-design` profile 信息日志不进入 stdout。
- **mock MCP 端到端**：承接真实 initialize → initialized → tools/call → DELETE 请求形状，覆盖 search/reader 主路径、SSE/JSON、错误映射、取消、超时和清理。
- **构建契约验证**：检查产物存在、Node 语法、经典 client bundle 格式和 CLI usage。
- **真实管线验收**：Web 用现有 GUI；Open Design 用 `dsh --profile open-design --probe/--stdio` 检查 stdout 纯 JSONL，再检查新 `od-*` 会话首个 `request/header`。不得为验收重启 DSH。

## 验证分层

本插件提交审核前至少运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run verify`；发布前再执行 [`release.md#发布前验证`](release.md#发布前验证) 的完整序列和打包检查。

若任一步失败，先定位失败原因；不要用重启、跳过检查或重复执行掩盖问题。

## 安全审计（2026-09）

项目专属要点（完整清单见工作区根 `docs/audit-2026-09.md`，勿在此复制）：

- 已确认高危：HTTP 回退无 DNS rebinding 防护（公网域名二次解析到内网不设防，需连接前解析并 pin IP）；duplicate 注册被当成功返回 no-op disposer（HMR/双行下旧 Fiber 卸载后 provider/tool 永久消失）。
- 中危：回退超时不覆盖 `credentials.resolve`（卡死占满并发槽）；MCP 错误把上游响应体原样进 error/cause（条件性凭据泄漏）；外部标题/正文/URL 直接拼 Markdown 工具输出（无不可信内容隔离）；CLI `--profile` 未校验。
- 正面范例（保持）：`self-hot-reload.ts` 全能力探测+静默降级；`web.config` 复杂 patch 不走 dsh-zh simple reconcile（安装只走项目 CLI 全量通道）。
