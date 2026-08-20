# 开发指南（development）

> 本文件是插件格式、热路径、不可破坏约束、开发经验与测试策略的权威位置。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `src/*.ts` | host 插件源码（入口 `index.ts` + 各模块），编译后生成 `lib/*.js` 与声明文件 |
| `src/client.ts` | 浏览器插件源码，构建为经典脚本 `lib/client.js` |
| `src/bin/` | CLI TypeScript 源码（`.mts`），编译后生成 `bin/*.mjs` |
| `src/tests/*.mts` | node:test 单元测试 |
| `cordis.patch.yml` | 随包发布的持久 bundle 行，行 id `dsh-zhipu` |
| `lib/` `bin/` `.tsbuild/` | 构建产物，Git 忽略，`prepare`/`prepack`/`npm run build` 生成 |

`src/` 是唯一手写源码。运行时真值在 `${DSH_HOME:-~/.dsh}/profiles`，不是 DSH checkout，也不是本仓库 `node_modules`。

## 热路径选择

| 场景 | 通道 |
| --- | --- |
| client bundle 内容变化 | `client-hmr` 500ms 轮询（`clientModules.rebuilt` → SSE）；未跑 dev:web watcher 时刷新页面 |
| host 侧代码迭代 | 改 `src/` → `npm run build` → 自监视热重载（`registerConfig` 精确监视 lib 产物 + `stashed.add` + 150ms debounce `partialReload`） |
| 首次热挂载 | dsh-zh manifest reconcile 或 query-URL 桥接包 |
| 自监视还不存在（首次） | 一次性动态插件执行 `hmr.stashed.add(fileUrl)` + `hmr.partialReload()` 引导 |

## 不可破坏的约束

**package.json 与发布形态**：

1. 以下声明缺一不可：`type: module`、`main: lib/index.js`、`types: lib/index.d.ts`；bin（`dsh-zhipu → bin/dsh-zhipu.mjs`）；exports 含 `.`、`./client`、`./cordis.patch.yml`、`./package.json`；`dsh.bundle.patch → ./cordis.patch.yml`；`dsh.client`（web 平台、立即加载、依赖包名）。`./package.json` 导出用于 client-modules 扫描，缺失时插件可能被静默跳过并 404。
2. `dsh.client.inject` 写客户端**包名依赖**；浏览器插件的 `exports.inject` 写 Cordis **服务名**。两者不可混写。
3. `lib/client.js` 必须保持经典脚本格式 `window.__ModuleLoader__.load({ id, factory })`，禁止 ESM `import`/`export`。
4. client-modules **负面缓存**：包名一旦被判定"非客户端包"，同进程永久缓存。第一次就把格式写对。

**挂载与注册**：

5. 挂载行 id 不得复用：持久行 `dsh-zhipu`、临时热行 `dsh-zhipu-hot`、桥接行 `dsh-zhipu-bridge`。
6. 所有注册（provider/工具/settings/systemPrompt 节）必须**幂等保护**：遇 `already registered` 跳过而非抛错。
7. 卸载必须干净：只释放 Fiber 不会删 Loader 图条目，需按包名 `ctx.loader.remove(entry.options.id)`。
8. `cordis.patch.yml` 必须解析为**顶层数组**；只有注释会解析为 null；删除最后一个条目后写回 `[]`。

**运行时行为**：

9. 所有监听器、定时器、服务包装、Slot、样式、DOM 副作用、watcher 必须随当前 Fiber 可逆清理。
10. 凭据永不进配置；key 不写日志、不进错误信息。
11. `dshHome()` 回退不可删：非空白 `$DSH_HOME` → `~/.dsh`。
12. 客户端只向 `settings.plugin.item` 贡献配置卡片并使用官方 `settingsScope`；不添加自定义网络请求、遥测或独立持久数据。
13. Host 源码热更新只用官方 HMR 的精确路径注册与 `partialReload`；`registerConfig` 初始扫描的 add 事件必须忽略。

## 开发经验

### 本项目实测踩坑

0. **`ToolDefinition.parameters` 必须是 JSON Schema 形态**（顶层 `type:'object'` + `properties` + `required` 数组）——鸭子类型裸注册若用 schemastery 简写（属性内 `required: true`），**调用层解析不出参数、模型永远收到空参数且无报错**。验收必须在 DSH 管线内带参真实调用。
1. **`defineTool` 的 `output.schema` 是纯 JSON Schema**：`required` 必须在顶层数组；与 `parameters` 的 schemastery 简写方言不同。
2. **query URL 热挂载只对单文件 bundle 有效**：`?v=N` 仅让入口 miss ESM 缓存，多模块包的相对导入仍命中旧缓存。本项目 host 侧 tsdown 打成单文件 `lib/index.js`。
3. **`loader.create` 的 `name` 必须是包名**（非 file URL）：否则 client.js 端点 404。
4. **动态 Cordis 插件访问 `ctx.loader` 必须声明 `inject: ['loader']`**。
5. **可靠的热挂载通道是动态插件的 `ctx.loader.create({ id, name })`**（dsh-zh 自迁移同款）。
6. **动态插件沙箱无 `require`、fs 是包装 API**：主进程内观测优先走 webServer 路由 + 外部 HTTP 读取。
7. **`ctx.effect` 的 cleanup 必须写成回调体的「返回值」，不是回调体语句**：`ctx.effect(cb)` 会立即调用 `cb` 并把它**返回值**当作卸载 disposer。若把清理动作直接写在回调体内，会在注册时立即执行——本项目 `self-hot-reload.ts` 曾因此「注册完 watcher 就被自己关闭」，自监视空转。正确写法：`ctx.effect(() => { return () => { …清理… } })`。
8. **动态 Cordis 插件里 `throw` 会崩掉宿主进程**：定时器/异步回调里的未捕获异常会逃逸到父进程事件循环。诊断探针永远不要用 `throw` 传结果——改走 `console.log`/返回值/落盘日志。

### 热重载与运行时

- Node ESM 缓存键 = 完整 URL 含 query；`?v=N` 是热加载新代码的合法钥匙。
- `partialReload` 遍历配置树全部插件，但只重载依赖链命中 `stashed` 的。
- loader 自身从不清 `loadCache`。
- shell 环境 ≠ 主进程环境：注入变量（`DSH_*`）是解析结果，不是继承证据。
- `ctx.get('xxx')` 在 apply 时可能为 undefined（服务晚于插件出现）——监听 `internal/service` 重试。
- 浏览器侧嵌套 fiber 的 `ctx.inject([...], cb)` 可能不激活——优先同步 `ctx.get()`。
- 订阅快照 store 后立即主动执行一次检查。

### client 半边

- 客户端不能引用主机端常量；两端各自定义默认值常量，提交前全仓库 grep 确认无跨端引用。
- `node --check` 只验证语法不查未定义变量；改名后必须全局搜索旧名新名。
- `useSyncExternalStore` 要求 `getSnapshot()` 返回新引用。
- 网页配置卡片要求 DSH ≥ `0.1.0-rc.7`。

### 安装与 peer 解析

- `link:` 持续开发前先建 peer junction，再 `dsh plugin --profile web add "link:<本项目绝对路径>"`。
- `.npmrc` `omit=peer` 防止 link 安装时在插件根生成第二份 `dsh-llm`。
- `file:` 普通安装把可运行快照物化到 profile，不保留热重载。

## 测试策略

- **假 ctx 单测**：node 里 `m.apply(fakeCtx)` 直接调插件方法，与运行时解耦（修复验证首选）。
- **同正则验证**：用与代码逐字符相同的正则去验配置文件。
- **mock server 端到端**：`node:http` mock + 真插件挂真 Context，断言请求形状。
- 修改任何文件后按序验证：`npm run typecheck` → `npm run build` → `node --check` 产物 → 单测 → `npm pack --dry-run --json`。
- 真实模型请求/工具调用是最终验收；语法检查不能覆盖全部运行时服务形状。