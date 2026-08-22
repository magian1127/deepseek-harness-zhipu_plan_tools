# 故障排查（troubleshooting）

> 本文件只负责“症状 → 诊断动作”。
> 错误码和用户可见语义见 [`behavior.md`](behavior.md)；热路径和实现硬约束见 [`development.md`](development.md)；发布故障见 [`release.md`](release.md)。

## 快速分流

1. 先记录完整错误码，不要只看自然语言消息。
2. 再确认运行中的版本与插件条目；磁盘构建产物不是运行时生效的证据。
3. 按下表定位；涉及行为含义时跳转到 [`behavior.md#错误码速查`](behavior.md#错误码速查)，涉及 HMR 时跳转到 [`development.md#热路径选择`](development.md#热路径选择)。
4. 全程使用热路径，禁止重启 DSH。

## 症状索引

| 症状 | 最短诊断路径 |
| --- | --- |
| 工具名或 schema 修改后仍是旧版 | 用运行时 `Tool.listTools` 确认真值；检查 `hmr.configs` 是否包含真实 `lib/index.js`、变更时是否进入 `hmr.stashed`。缺失时按[热路径](development.md#热路径选择)修复自监视或执行一次性引导 |
| host 自监视无反应 | 查插件日志中的 HMR 服务与 `registerConfig`；确认 `ctx.effect` 返回 cleanup，而不是注册时直接执行 cleanup；确认监视的是实际文件而非跨目录 symlink |
| `web_search` / `web_fetch` 报 provider 未注册 | 对照 `WEB_PROVIDER_CONFIGURED_MISSING`；检查插件挂载行、运行时 entries 和 provider registry，不要只检查 `cordis.patch.yml` |
| `web_search` / `web_fetch` 报 provider unavailable | 对照 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；依次检查 `enabled`、对应功能开关、`credentialRef` 与本地凭据可用性 |
| 报凭据缺失 | 确认已添加 `zai-coding-cn`；确认设置中的引用名与环境变量或 `${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs` 键一致。完整解析顺序见[凭据与数据边界](behavior.md#凭据与数据边界) |
| 报 `ZHIPU_CONTENT_FILTERED` | 将一次查询缩到一个明确目标，并补充实体、时间范围、地区、指标或来源；不要原样盲重试。行为边界见[搜索查询约定](behavior.md#搜索查询约定) |
| 设置卡片不出现 | 请求插件 client 端点；若 404，检查 Loader `name` 是否为包名、`package.json` 的 client exports / `dsh.client` 是否完整；再检查 DSH 是否支持 `exposeToClients` 以及是否命中过负面缓存 |
| 修改 client 后页面没变化 | 先确认是否已有 `pnpm run dev:web` watcher；有则检查 client HMR 事件，无则重新构建并刷新现有 GUI。不要启动替代服务器 |
| 双实例或重复注册 | 检查持久、热、桥接行是否误用相同 id；确认重复注册只被幂等保护跳过，其他异常未被吞掉 |
| schema 修改后仍被旧注册覆盖 | 确认旧 Fiber 已卸载且 disposer 清理工具注册，再通过 `stashed` + `partialReload` 重挂；不要继续叠加新实例 |
| `web_fetch` 根本不在工具列表 | 这是 DSH 独立开关；按 [`behavior.md#web_fetch-启用边界`](behavior.md#web_fetch-启用边界) 启用 `tool-web.fetch` |
| CLI 报 patch 解析或行冲突 | 检查 patch 顶层是否为数组、行 id 是否遵守三类约定；使用项目 CLI 修复，不直接编辑 profile 配置 |

## 运行时观察工具

| 工具 | 观察内容 | 注意事项 |
| --- | --- | --- |
| GUI 启动信息 | 现有 GUI 首页 `window.__DSH_BOOT__.rev` 与 entries 可确认运行版本和插件清单 | 运行版不一定等于本地源码 checkout |
| client 端点 | `Invoke-WebRequest 'http://127.0.0.1:3080/plugins/<包名>/client.js'` | 只访问现有服务；不要另起 DSH server |
| 运行时工具目录 | `Tool.listTools` 或等价 inspect 能力 | 是模型实际可见 schema 的权威来源 |
| HMR 状态 | `hmr.configs`、`hmr.stashed` 与 partial reload 日志 | 用来区分“没监视”“没暂存”“没重载” |
| 受控诊断日志 | 临时记录 apply、环境和检查结果到 `${DSH_HOME:-~/.dsh}` 下的诊断文件 | 默认关闭，禁止写凭据；排查完成后清理 |
| 独立 CDP 调试 | 自己启动的 headless 浏览器可采集 console、exception 与 module load cache | 只结束自己启动的浏览器进程 |
| 双盲探针 | 同一测试配置使用普通 file URL 与带 query URL 的独立行 | 只用于区分通道失效与格式拒绝，使用唯一临时 id |

## 已知环境事实

- 官方 patch-layer watcher 在部分运行版本可能写盘后不触发 compose/update；配置树变化优先走 manifest reconcile 或动态 Loader。
- 宿主进程不保证导出 `DSH_HOME`；任何凭据或 profile 路径解析都必须带 `~/.dsh` 回退。
- 受限 PowerShell 可能没有出站网络，而 localhost 仍可访问；shell 的失败不能直接证明宿主内 Node `fetch` 也失败。
- 运行版本以 GUI 启动信息为准，不以本地 DSH checkout HEAD 代替。
- Windows 跨目录 symlink 的文件事件可能不传递；HMR 应监视真实构建产物。
- 动态 Cordis 插件中的未捕获异步异常可能影响宿主；诊断探针不得通过 `throw` 回传结果。
