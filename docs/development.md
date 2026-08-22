# 开发指南（development）

> 本文件是仓库结构、热路径、不可破坏约束、开发经验与测试策略的权威位置。
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

`src/` 是唯一手写程序源码。运行时配置真值位于 `${DSH_HOME:-~/.dsh}/profiles/<profile>`，既不在 DSH 源码 checkout，也不在本仓库的 `node_modules`。

## 热路径选择

先按改动对象选通道，禁止用重启 DSH 代替热更新：

| 场景 | 正确通道 | 验证方式 |
| --- | --- | --- |
| client bundle 内容变化 | 保持既有 `pnpm run dev:web` watcher 时，由 `client-hmr` 轮询构建结果并通过 SSE 热交换；没有 watcher 时构建后刷新现有 GUI | 检查现有 GUI 中设置卡片；不要启动替代服务器 |
| host 源码变化 | 修改 `src/` 后执行 `npm run build`；自监视把真实 `lib/index.js` 加入 `hmr.stashed` 并触发 `partialReload()` | 查运行时工具/provider，而不是只看磁盘产物 |
| 首次热挂载 | 优先走 dsh-zh manifest reconcile；否则由项目 CLI 使用 query-URL 桥接通道 | 使用 CLI `status` 并刷新现有 GUI |
| 自监视尚未安装 | 一次性动态插件对目标文件执行 `hmr.stashed.add(fileUrl)` 与 `hmr.partialReload()` 引导 | 确认目标路径进入 `hmr.configs` |

关键机制：

- Node ESM 缓存键包含完整 URL；`?v=N` 能刷新入口模块。
- query URL 只可靠刷新单文件 bundle；多模块相对导入仍可能命中旧缓存。
- `partialReload` 会遍历配置树，但只重载依赖链命中 `stashed` 的 Fiber。
- Loader 不自动清除自身 `loadCache`。
- 官方 patch-layer watcher 在部分运行版本不可靠；配置树更新优先走 manifest 或动态 Loader 通道。
- Windows 跨目录 symlink 的文件事件不保证传到 symlink 路径；监视真实产物路径。

## 不可破坏的约束

### 包与 client bundle

1. `package.json` 必须保留：
   - `type: module`、`main: lib/index.js`、`types: lib/index.d.ts`；
   - `dsh-zhipu → bin/dsh-zhipu.mjs`；
   - exports `.`、`./client`、`./cordis.patch.yml`、`./package.json`；
   - `dsh.bundle.patch` 与 `dsh.client` 声明。
2. `./package.json` 导出供 client-modules 扫描；删除后可能被静默跳过并导致 client 端点 404。
3. `dsh.client.inject` 填客户端**包名依赖**，浏览器插件 `exports.inject` 填 Cordis **服务名**，二者不可混用。
4. `lib/client.js` 必须是经典脚本 `window.__ModuleLoader__.load({ id, factory })`，禁止顶层 ESM `import` / `export`。
5. client-modules 对“非客户端包”存在进程级负面缓存；首次加载就必须保证导出与 bundle 格式正确。

### 挂载、注册与卸载

6. 行 id 不得复用：持久行 `dsh-zhipu`、临时热行 `dsh-zhipu-hot`、桥接行 `dsh-zhipu-bridge`。
7. `cordis.patch.yml` 必须解析为顶层数组；清空最后一个条目后写回 `[]`，不能只剩注释或 `null`。
8. provider、工具、settings 和 system prompt section 的注册必须幂等；遇到 `already registered` 只跳过预期重复，不能吞掉其他异常。
9. 卸载时所有监听器、定时器、服务包装、Slot、样式、DOM、副作用和 watcher 都必须随当前 Fiber 可逆清理。
10. 只释放 Fiber 不等于删除 Loader 图条目；需要卸载动态条目时，按 `entry.options.id` 调用 `ctx.loader.remove(...)`。
11. 动态插件访问 `ctx.loader` 必须声明 `inject: ['loader']`；`loader.create({ id, name })` 的 `name` 必须是包名，不能是 file URL。

### 凭据、设置与 HMR

12. API Key 永不写入配置、日志或错误信息。
13. `dshHome()` 的非空 `$DSH_HOME` → `~/.dsh` 回退不可删除；宿主进程环境不能假定与当前 shell 相同。
14. 客户端只向 `settings.plugin.item` 注入卡片并使用官方 `settingsScope`；不增加自定义网络请求、遥测或独立持久数据。
15. host 热更新只使用官方 HMR 的精确路径注册、`stashed` 和 `partialReload`；`registerConfig` 初始扫描产生的 add 事件必须忽略，避免自触发循环。
16. `ctx.effect(callback)` 的 callback 必须**返回** disposer；不能把清理动作直接写在 callback 体内，否则注册时即执行。
17. 动态 Cordis 插件的异步回调不得抛出未捕获异常；异常可能逃逸到宿主事件循环。诊断通过日志、返回值或受控文件记录结果。

## 实现经验

### Schema 与工具调用

- `ToolDefinition.parameters` 使用顶层 `type: 'object'`、`properties`、`required` 数组的 JSON Schema 形态。误用属性内 `required: true` 会让调用层解析不到参数。
- `defineTool` 的 `output.schema` 同样使用纯 JSON Schema；不要与 schemastery 简写混淆。
- 验收工具参数必须走一次 DSH 实际调用管线，不能只依赖 TypeScript 或语法检查。
- `repo_name` 的执行校验保持 `owner/repo`；历史展示可降级，但不能放宽实际 schema。

### 运行时与客户端

- `ctx.get('service')` 在 apply 阶段可能为空；服务晚到时监听 `internal/service` 后重试。
- 浏览器嵌套 Fiber 中 `ctx.inject([...], callback)` 可能不激活；优先同步 `ctx.get()` 并处理缺失状态。
- 订阅快照 store 后立即主动检查一次；`useSyncExternalStore.getSnapshot()` 必须返回稳定语义的新快照引用。
- host 与 client 各自维护默认值时，改名后全仓库搜索旧名和新名，避免跨端漂移。
- `node --check` 只查语法，不会发现未定义变量或服务形状错误。

### 安装与解析

- 持续开发使用 CLI 的 `--link <项目路径>`；不要在文档或脚本硬编码本机绝对路径。
- `.npmrc` 的 `omit=peer` 用于避免 link 安装时在插件根生成第二份宿主 peer。
- `file:` 安装会把可运行快照物化到 profile，不保留源码目录的热重载关系。
- 动态插件环境没有普通 `require`，文件系统也可能是宿主包装 API；优先使用已声明服务和外部 localhost 观测面。

### 上游异常分类

宽泛搜索可能被上游以 `contentFilter` 拒绝，也可能返回 `No results found`。这不是判断协议参数错误的充分依据。实现只识别结构化过滤信号并映射稳定错误码；具体用户行为以 [`behavior.md#搜索查询约定`](behavior.md#搜索查询约定) 和 [`behavior.md#错误码速查`](behavior.md#错误码速查) 为准。

## 测试策略

- **纯逻辑单测**：覆盖设置归一化、schema、凭据文件解析和 patch 行操作。
- **假 Context 装配测试**：直接调用插件 `apply(fakeCtx)`，验证注册、动态装卸与可逆清理。
- **mock MCP 端到端**：用本地 `node:http` 服务承接真实请求形状，覆盖 initialize、SSE/JSON、错误映射、取消和清理。
- **构建契约验证**：检查产物存在、Node 语法、经典 client bundle 格式和 CLI usage。
- **真实管线验收**：涉及服务形状、模型参数或远端 MCP 时，以现有 DSH GUI 中的真实调用为最终依据；不得为验收重启 DSH。

## 验证分层

避免在多个文档复制命令清单：

1. 开发中先运行与改动最接近的类型检查和测试；
2. 提交审核前至少运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run verify`；
3. 发布前再执行 [`release.md#发布前验证`](release.md#发布前验证) 的完整序列和打包检查。

若任一步失败，先定位失败原因；不要用重启、跳过检查或重复执行掩盖问题。
