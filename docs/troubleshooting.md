# 故障排查（troubleshooting）

> 本文件只负责“症状 → 诊断动作”。
> 错误码和用户可见语义见 [`behavior.md`](behavior.md)；本插件热挂例外和实现硬约束见 [`development.md`](development.md)；发布故障见 [`release.md`](release.md)。

## 快速分流

1. 先记录完整错误码，不要只看自然语言消息。
2. 再确认运行中的版本与插件条目；磁盘构建产物不是运行时生效的证据。
3. 按下表定位；涉及行为含义时跳转到 [`behavior.md#错误码速查`](behavior.md#错误码速查)，涉及 HMR 时跳转到 [`development.md#热路径选择智谱专属例外`](development.md#热路径选择智谱专属例外)。
4. 全程禁止用重启 DSH 代替诊断。

## 症状索引

| 症状 | 最短诊断路径 |
| --- | --- |
| 工具名或 schema 修改后仍是旧版 | 用运行时 `Tool.listTools` 确认真值；Host 半边在当前 DSH 下**没有热通道**（`hmr` 服务面已移除 `registerConfig`/`partialReload`），需由用户重启一次 `dsh web` 后复查 |
| host 自监视无反应 | 这是**预期现象**：旧式自监视（`hmr.registerConfig`/`partialReload`）在当前 DSH 已不存在，`src/self-hot-reload.ts` 恒为 no-op。不要按旧文档去修 watcher，改走重启 |
| `web_search` / `web_fetch` 报 provider 未注册 | 对照 `WEB_PROVIDER_CONFIGURED_MISSING`；检查插件挂载行、运行时 entries 和 provider registry，不要只检查 `cordis.patch.yml` |
| `web_search` / `web_fetch` 报 provider unavailable | 对照 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；依次检查 `enabled`、对应功能开关、`credentialRef` 与本地凭据可用性 |
| Open Design 仍触发 DeepSeek 原生搜索，或请求头缺少 `github_*` | 检查 `dsh plugin --profile open-design list`，不要误查 `headless`；再用 `dsh --profile open-design --dump-default-config` 确认 `dsh-zhipu` 与 `zhipu-web-search-prime`，最后检查安装后新会话的首个 `request/header`。若 Open Design 报 JSONL 解析错误，确认 stdout 只有协议 JSON，插件信息日志应在 stderr |
| 报凭据缺失 | 确认已添加 `zai-coding-cn`；确认设置中的引用名与环境变量或 `${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs` 键一致。完整解析顺序见[凭据与数据边界](behavior.md#凭据与数据边界) |
| 报 `ZHIPU_CONTENT_FILTERED` | 将一次查询缩到一个明确目标，并补充实体、时间范围、地区、指标或来源；不要原样盲重试。行为边界见[搜索工具的接管与说明替换](behavior.md#搜索工具的接管与说明替换) |
| 三个 `github_*` 工具对同一仓库全部失败 | 对照 `ZHIPU_REPO_NOT_FOUND`:zread 只覆盖已收录仓库;核对 `owner/repo` 是否真实存在,未收录的仓库改用 `web_fetch` 直接访问 GitHub |
| reader 关闭后回退抓取报 URL、重定向、大小或内容类型错误 | 对照 [`behavior.md#错误码速查`](behavior.md#错误码速查) 使用公开 HTTP(S) 文本 URL；跨源跳转应先人工核对最终地址再直接请求，不能放宽 provider 策略 |
| 插件页配置表单不出现 | 先读 `/plugins/events` 的 `graph` 帧：`dsh-zhipu` 行不在 → 进程启动时包还没有 `dsh.client` 声明（"非 client 包"判定缓存到重启），只能等自然重启；行在但面板空白 → 用 graph 给出的确切地址 `/plugins/??deepseek-harness-zhipu_plan_tools/client.js&rev=…` 取 bundle，再检查 `package.json` 的 client exports / `dsh.client` 与本插件 `plugins.bundle.config` 的 key（必须是包名） |
| 修改 client 后页面没变化 | 正常情况下 `@deepseek-ai/dsh-client-hmr` 每 500ms stat 轮询会自动换血（`clientModules.rebuilt` → `/plugins/events` SSE → 页面内替换），无需刷新；若仍未变化，确认运行副本已是新构建并刷新现有 GUI。不要启动替代服务器 |
| 双实例或重复注册 | 检查持久、热、桥接行是否误用相同 id；确认重复注册只被幂等保护跳过，其他异常未被吞掉 |
| schema 修改后仍被旧注册覆盖 | 确认旧 Fiber 已卸载且 disposer 清理工具注册；确认运行进程加载的是新构建（重启一次 `dsh web`），不要继续叠加新实例 |
| `web_fetch` 不在工具列表 | DSH v0.1.2 起 Web 端预设默认提供该工具,不出现多见于旧版 DSH 或部署显式改过 `tool-web` 行;按 [`behavior.md#web_fetch-启用边界`](behavior.md#web_fetch-启用边界) 核对 `tool-web.fetch` |
| CLI 报 patch 解析或行冲突 | 检查 patch 顶层是否为数组、行 id 是否遵守三类约定；使用项目 CLI 修复，不直接编辑 profile 配置 |

## 本插件的运行时观察目标

- Loader 中应至多各有一条 `dsh-zhipu`、`dsh-zhipu-hot`、`dsh-zhipu-bridge`，且三者职责不能互换。
- provider registry 应存在智谱 search/reader provider；只看到 `cordis.patch.yml` 的静态配置不算已注册。
- `Tool.listTools` 应随 `zread` 实时出现或移除三个 `github_*`，并随 `search` 在 Agent own scope 切换 `web_search` shadow。
- 客户端 bundle 由 boot graph 通告，地址形如 `/plugins/??deepseek-harness-zhipu_plan_tools/client.js&rev=<rev>`（不带 `??`/`rev` 的形式一律 404，不能当判据）；配置表单缺失时继续检查 `settingsScope` 绑定与 `plugins.bundle.config` 的 key（本包 npm 包名）。
- 宿主进程不保证导出 `DSH_HOME`，凭据解析必须保留 `~/.dsh` 回退；诊断输出不得包含 API Key。
