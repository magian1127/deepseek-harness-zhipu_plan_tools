# 故障排查（troubleshooting）

> 按症状排查加载、更新、设置、CLI、热重载与发布问题。
> 错误码含义见 `behavior.md`，工具链排查技法兼作通用手册。

## 症状 → 排查

| 症状 | 排查 |
| --- | --- |
| 工具名/schema 改了但模型看到的是旧的 | ① `Tool.listTools`（inspect 运行时目录）是唯一权威——磁盘 `lib/index.js` 是新代码 ≠ 进程生效，进程跑的是冷启动旧 fiber；② 查 `hmr.configs` 是否含本插件 `lib/index.js` 真实路径 = 自监视是否挂上；③ 查 `hmr.stashed` 是否被塞入 = 变更是否走到「暂存 → partialReload」。都没有 → 自监视空转，见下；手动补救：一次性动态插件 `hmr.stashed.add(fileUrl)` + `hmr.partialReload()` |
| 自监视热重载不生效 | 看插件日志是否「hmr 服务不可用 / 缺少 registerConfig」；确认 `ctx.effect` 的 cleanup 是**返回值**而非回调体语句（cleanup 写在回调体会注册即关闭 watcher） |
| `web_search` 报后端不可用 | 查错误码：`UNAVAILABLE` → 凭据本地检查失败；`CONFIGURED_MISSING` → provider 未注册（插件行没挂上/被卸载） |
| 报 `ZHIPU_CREDENTIAL_MISSING` / `WEB_PROVIDER_CREDENTIAL_MISSING` | ① 确认 DSH 设置 → 模型已添加 `zai-coding-cn` 提供商（API 密钥留空 = 环境认证）；② 确认 `ZAI_CODING_CN_API_KEY` 在环境变量或 `~/.dsh/.credentials.yaml`；③ 若用别的变量名，把设置卡片 `credentialRef` 改成对应名字 |
| 设置卡片不出现 | client.js 端点 404（loader 的 name 必须是包名）；或 DSH < `0.1.0-rc.7`（无 `exposeToClients`）；或 client-modules 负面缓存（结构改错后被永久跳过） |
| 双实例/重复注册 | 挂载行 id 复用导致 loader 启动失败；或依赖幂等保护兜底 |
| 改了 schema 不变 | 旧实例工具注册未卸载，新 schema 被幂等跳过——`hmr.stashed.add(url)` + `partialReload` 清缓存后重挂 |

## 排查工具箱

| 手段 | 用法 | 适用 |
| --- | --- | --- |
| diag() 打点 | 插件内 `appendFileSync(~/.dsh/xx.log, JSON)` 记录 apply/env/检查结果 | 主进程内部状态唯一可靠观测面（默认关闭，排查时开启） |
| GUI 首页侦察 | `http://127.0.0.1:3080/` 的 `__DSH_BOOT__.rev` + entries | 读运行版本与插件清单（localhost 不受沙箱断网影响） |
| 客户端端点 | `Invoke-WebRequest 'http://127.0.0.1:3080/plugins/<pkg>/client.js'` | client bundle 是否被识别 |
| CDP headless 调试 | 独立 Edge `--headless=new --remote-debugging-port=9333`，收 `consoleAPICalled`/`exceptionThrown`，查 `window.__DSH_MODULES__.loadCache` | 页面无报错但插件失效时；只结束自己启动的 headless 进程 |
| 双盲探针 | 同一 patch 放「纯 file URL 行 + query URL 行」各一枚 | 区分「通道死」还是「格式被拒」 |
| 报错类型切换 | `unavailable` ↔ `not registered` 的切换即「配置树是否 update」的信号 | 零成本探测配置树状态 |
| node 一次性探针 | 大文件/复杂提取写成临时 `.mjs` 用 `indexOf`/regex，用完即删 | PowerShell `Get-Content -Raw` 大文件会超时 |

## 已知事实（勿重复踩坑）

- 官方 patch-layer watcher 在当前运行版本可能不生效：写盘后无 compose/update。改配置树走 manifest 通道。
- harness 主进程**不导出 `DSH_HOME`**；任何读凭据/配置的代码必须带 `~/.dsh` 回退。
- 沙箱受限 pwsh **无出站网络**：curl 报 schannel `SEC_E_NO_CREDENTIALS` 属预期；`http://127.0.0.1:3080`（localhost）可用；Node fetch 不走 schannel、出站正常。
- 运行版 rev 未必等于本地 checkout HEAD；GUI 首页 `__DSH_BOOT__.rev` 可读运行版本。
- Windows 上跨目录 symlink 的文件变更事件不一定传导到 symlink 路径的 watcher。
