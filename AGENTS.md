# AGENTS.md

> 本文件只定义仓库级工作规则。用户说明见 `README.md`，详细事实按主题放在 `docs/`。
> 代码注释和文档以中文为主；引用上游术语、API、命令和标识符时保留原文。

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| [`README.md`](README.md) / [`README.en.md`](README.en.md) | 面向用户：功能、安装、卸载、设置与数据边界 |
| [`docs/behavior.md`](docs/behavior.md) | 用户可见行为、默认值、设置语义、边界与失败模式、错误码 |
| [`docs/architecture.md`](docs/architecture.md) | 运行结构、模块契约、关键架构决策、调研事实与路线图 |
| [`docs/development.md`](docs/development.md) | 仓库结构、热路径、不可破坏约束、开发经验与测试策略 |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 按症状排查、排查工具箱、已知事实 |
| [`docs/release.md`](docs/release.md) | 发布前验证、版本、Git 与 npm 发布 |

同一事实只保留一个权威位置：用户可见行为以 `docs/behavior.md` 为准，实现规则以
`docs/development.md` 为准。其它文档只做摘要并链接，不复制大段内容。

## 铁律（最高优先级）

1. **任何时候不允许重启 DSH**（`dsh web` 进程）。需要重启才能生效的改动就是没写对，
   必须找到并使用热重载路径（见 `docs/development.md`）。
2. **任何人不得修改 DSH 源码仓库**：只读，仅作参考。
3. **任何人不得在文档中写入本机绝对路径**（驱动器盘符、用户名、具体安装目录等）。
   引用本地文件一律用「项目内相对路径」或「`${DSH_HOME:-~/.dsh}` 下的相对路径」，
   参考项目一律用包名/占位符描述，不写绝对路径。

## 不可破坏的约束

平台硬性依赖，破坏会导致加载失败、挂载失败或数据越界。完整清单见
`docs/development.md`，要点：

- `lib/client.js` 必须保持经典脚本格式 `window.__ModuleLoader__.load({ id, factory })`，
  禁止 ESM `import`/`export`。
- `package.json` 必须保留 `./package.json`、`./client`、`./cordis.patch.yml` 导出与
  `dsh.bundle.patch`、`dsh.client` 声明。
- 挂载行 id 不得复用：持久行 `dsh-zhipu`、临时热行 `dsh-zhipu-hot`、桥接行 `dsh-zhipu-bridge`。
- 所有注册必须幂等保护；卸载按 `ctx.loader.remove(entry.options.id)` 清 Loader 图条目。
- 凭据永不进配置、不写日志、不进错误信息；`dshHome()` 回退不可删。

## 工程纪律

- 不顺手重构无关代码，不覆盖用户已有改动；profile 配置只通过项目 CLI 读写，不直接编辑。
- 修改用户可见行为时同步更新 `README.md` 与 `docs/behavior.md`；
  修改实现规则时更新 `docs/development.md`，其它事实落到对应 `docs/` 主题。

## 修改与验证

任何文件改动后执行：

```powershell
npm run typecheck
npm run build
node --check lib/index.js
node --check lib/client.js
node --check bin/dsh-zhipu.mjs
npm test
npm run verify          # 产物存在性 + client bundle 格式 + CLI usage
```

发布前再执行 `npm pack --dry-run --json`，完整步骤见 `docs/release.md`。
部署诊断统一见 `docs/troubleshooting.md`。

## Git 纪律

- 不允许主动执行 `git commit` 或 `git push`；必须先由用户审核并明确批准。
- commit message 必须全中文且以中文开头，英文专业术语放在中文后的括号内。
  - 正确：`默认展开思考（thinking）输出`
  - 错误：`feat: 默认展开思考`
- 默认分支为 `main`。