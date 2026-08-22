# AGENTS.md

> 本文件只定义仓库级协作规则。用户说明见 [`README.md`](README.md)，详细事实按主题收录于 [`docs/`](docs/)。
> 代码注释和文档以中文为主；上游术语、API、命令和标识符保留原文。

## 文档索引

| 文档 | 唯一职责 |
| --- | --- |
| [`README.md`](README.md) / [`README.en.md`](README.en.md) | 面向用户：功能、安装、卸载、设置与数据边界 |
| [`docs/behavior.md`](docs/behavior.md) | 用户可见行为、默认值、设置语义、边界、失败模式与错误码 |
| [`docs/architecture.md`](docs/architecture.md) | 运行结构、模块契约、架构决策、调研事实与技术路线图 |
| [`docs/development.md`](docs/development.md) | 仓库结构、热路径、不可破坏约束、开发经验与测试策略 |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 按症状诊断、运行时观察与已知环境事实 |
| [`docs/release.md`](docs/release.md) | 发布前验证、版本记录与 npm 发布 |

同一事实只保留一个权威位置，其他文档只写必要摘要并链接：

- 用户可见语义以 [`docs/behavior.md`](docs/behavior.md) 为准；
- 实现规则以 [`docs/development.md`](docs/development.md) 为准；
- 发布步骤以 [`docs/release.md`](docs/release.md) 为准。

## 铁律（最高优先级）

1. **任何时候不允许重启 DSH**（`dsh web` 进程）。需要重启才能生效的改动就是没写对，必须使用 [`docs/development.md#热路径选择`](docs/development.md#热路径选择) 中的热路径。
2. **不得修改 DSH 源码仓库**；它只读，仅供查阅接口与实现。
3. **不得在文档中写入本机绝对路径**（盘符、用户名或具体安装目录）。本地文件使用项目相对路径或 `${DSH_HOME:-~/.dsh}` 下的相对路径；参考项目使用包名或占位符。

## 工程纪律

- 不顺手重构无关代码，不覆盖用户已有改动。
- 本插件的挂载、依赖和临时行只通过项目 CLI 读写，不直接编辑；DSH 自有功能开关按用户文档配置。
- 修改用户可见行为时，同步维护双语用户说明和 [`docs/behavior.md`](docs/behavior.md)；修改实现规则时更新 [`docs/development.md`](docs/development.md)。
- 包格式、挂载行、幂等清理、凭据和 HMR 等硬约束统一见 [`docs/development.md#不可破坏的约束`](docs/development.md#不可破坏的约束)，不要在其他文档复制清单。
- 任何改动后的开发验证见 [`docs/development.md#验证分层`](docs/development.md#验证分层)；发布前执行完整的 [`docs/release.md#发布前验证`](docs/release.md#发布前验证)。
- 部署或运行异常统一从 [`docs/troubleshooting.md`](docs/troubleshooting.md) 开始排查。

## Git 纪律

- 不主动执行 `git commit` 或 `git push`；必须先由用户审核并明确批准。
- commit message 必须全中文且以中文开头；英文专业术语放在中文后的括号内。
  - 正确：`默认展开思考（thinking）输出`
  - 错误：`feat: 默认展开思考`
- 默认分支为 `main`。
