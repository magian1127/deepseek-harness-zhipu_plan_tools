# deepseek-harness-zhipu_plan_tools

**智谱 MCP 三件套 · DeepSeek Harness 插件**

[中文](README.md) · [English](README.en.md)

<p align="center">
    <img alt="版本 0.1.5" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.5-5965d8">
  <img alt="功能 搜索/读取/仓库" src="https://img.shields.io/badge/%E5%8A%9F%E8%83%BD-%E6%90%9C%E7%B4%A2%20%C2%B7%20%E8%AF%BB%E5%8F%96%20%C2%B7%20%E4%BB%93%E5%BA%93-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

把智谱（GLM Coding Plan）三个 MCP Server 的能力以 **DSH 原生 provider / 工具**形式接入：
内置 `web_search` / `web_fetch` 后端替换为智谱联网搜索与网页读取，并可选注册三个
`github_*` 开源仓库工具。全部设置都在插件卡片中保存并实时生效。

## 功能与设置顺序

在 **DSH 设置 → 插件 → 插件配置** 中展开“智谱工具”。下表严格按卡片从上到下排列：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 启用智谱工具 | 开 | 总开关；关闭后搜索/读取进入兼容回退，仓库工具和相关提示卸载，设置入口保留 |
| 联网搜索（接管 `web_search`） | 开 | 通过智谱 `web_search_prime` 搜索，并替换模型可见的内置搜索说明 |
| 网页读取（接管 `web_fetch`） | 开 | 通过智谱 `webReader` 返回 Markdown；DSH v0.1.2 起 Web 端预设默认提供 `web_fetch`，安装后即生效 |
| 开源仓库工具 | 关 | 注册 `github_search_doc`、`github_get_repo_structure`、`github_read_file` |
| 提示词中文化 | 关 | 将插件注入的提示、工具说明与 github_* 工具错误消息从默认英文切换为中文；工具名不变 |
| 凭据引用名 | `ZAI_CODING_CN_API_KEY` | 只保存引用名，不保存 API Key |

卡片默认收起，底部依次为“恢复默认值 / 放弃修改 / 保存”。完整设置语义和关闭后的
回退边界见[行为契约](docs/behavior.md#设置语义)。

### 工作机制

- **搜索/读取 = provider 替换**：注册到 DSH `web` 服务的 provider，由 `cordis.patch.yml`
  把 `web` 行的 `searchProvider` / `fetchProvider` 指向本插件；模型看到的工具名不变
  （`web_search` / `web_fetch`），后端换成智谱。
- **仓库工具 = 原生注册**：三个 `github_*` 工具经 `ctx.tools.register` 注册，带系统提示
  指引与通用卡片，60 秒协作超时；历史中的过期或畸形参数仅降级为通用卡片，不影响会话重放，实际执行仍严格校验参数。
- **凭据**：统一引用 `ZAI_CODING_CN_API_KEY`（智谱 GLM Coding Plan API Key），三层解析
  （DSH 凭据服务 → 环境变量 → `~/.dsh/.credentials.yaml` 直读）；Key 永不写入配置或日志。
  - **尊重 Agent 预设**：极简模式（minimal 预设）是“仅持久 shell + str_replace_editor”的双工具组合，该模式下不注册 `web_search` 阴影；`zread` 开启时还在该 Agent 作用域 deny 全局 `github_*` 工具（该 deny 不依赖 `search` 开关，插件启用即生效），保持双工具承诺。
- **热更新**：Host 侧产物自监视热重载（改 `src/` → `npm run build` 即生效，无需重启）；
  设置 `applies: 'live'` 实时生效。

## 环境要求

- DeepSeek Harness ≥ `0.1.2-rc.1`；Web 使用 `web`，Open Design stdio 使用 `open-design`，DSH 一次性任务可用 `headless`
- Node.js `^22.19.0 || >=24.0.0`
- 智谱 GLM Coding Plan API Key；默认引用名为 `ZAI_CODING_CN_API_KEY`

## 安装

npm 注册表安装：

```sh
# Web GUI：持久安装
dsh plugin --profile web add deepseek-harness-zhipu_plan_tools

# Open Design 的真实 stdio profile
dsh plugin --profile open-design add deepseek-harness-zhipu_plan_tools

# 可选：DSH 自带 headless
dsh plugin --profile headless add deepseek-harness-zhipu_plan_tools

# 仅用于正在运行的 Web GUI 热安装
npx -y deepseek-harness-zhipu_plan_tools install --profile web
```

bundle 按 profile 隔离：Open Design 实际运行 `dsh --profile open-design --stdio`，不是 `headless`。两个非 Web profile 都在下一次短进程启动时加载；`open-design` 的 stdout 是严格 JSONL，本插件信息日志会改走 stderr。

本地源码联调：

```powershell
npm install
node bin/dsh-zhipu.mjs install --profile web --link <项目绝对路径>
dsh plugin --profile open-design add "link:<项目绝对路径>"
dsh plugin --profile headless add "link:<项目绝对路径>"
```

本包 patch 含 `web.config`，项目桥接/临时行只用于 Web 热安装；其它 profile 使用官方持久通道。分别核对：

```sh
npx -y deepseek-harness-zhipu_plan_tools status --profile web
dsh plugin --profile open-design list
dsh --profile open-design --dump-default-config
dsh plugin --profile headless list
```

## 首次使用：添加 zai-coding-cn 提供商

使用本插件前，先在 DSH 设置中添加 `zai-coding-cn` 提供商（一个步骤，安装后只需做一次）：

1. 打开 **DSH 设置 → 模型**；
2. 「提供方」下拉选择 **`zai-coding-cn`**（注意不是海外的 `zai`，本插件走智谱中国区端点 `open.bigmodel.cn`）；

保存后 DSH 会自动使用 `ZAI_CODING_CN_API_KEY` 参数（即配置中 `apiKeyEnv: ZAI_CODING_CN_API_KEY`）
作为该提供商的 API Key——这正是本插件默认的凭据引用名 `credentialRef`。

因此你只需保证 `ZAI_CODING_CN_API_KEY` 已存在于环境变量或 `~/.dsh/.credentials.yaml`，
插件零额外配置即可取到智谱 Coding Plan Key；若你在环境变量中配置了别的名字，可在设置卡片中
把 `credentialRef` 改成对应名字。

Open Design/stock headless 没有设置页面，但同一 `${DSH_HOME:-~/.dsh}` 下共用 `settings.yaml` 与凭据：可先在 Web GUI 保存设置，后续 `open-design` / `headless` 进程读取同一 `dsh-zhipu` 命名空间。

## web_fetch（网页读取）可用性

自 DSH v0.1.2 起，Web 端 agent 预设（standard / ptc / codex）默认在模型工具目录中提供
`web_fetch`。本插件只接管其后端 provider、不改工具开关：安装挂载后 `web_fetch` 默认即走
智谱 `webReader`，无需额外启用步骤。

旧版 DSH（Web 组合尚未默认提供 `web_fetch` 时）才需要在 profile patch
（`~/.dsh/profiles/web/cordis.patch.yml`）中启用：

```yaml
- id: tool-web
  config:
    fetch: true
```

数据边界：开启态抓取在智谱云端执行（本地不连接目标地址，URL 会提交给智谱 MCP）；关闭态
回退本地受限 HTTP(S) 抓取，详见[行为契约](docs/behavior.md#web_fetch-启用边界)。

## 设置与数据

六个字段 `enabled / search / reader / zread / zhPrompt / credentialRef` 按上方卡片顺序存入
DSH `settings.yaml` 的 `dsh-zhipu` 命名空间。API Key 本身不进入该命名空间。

关闭 `search` / `reader` 会实时进入兼容回退（使用 `DEEPSEEK_API_KEY` 的 DeepSeek 搜索、
受限 HTTP(S) 文本抓取），但不会改写 profile 中静态绑定的 provider。要让其他 provider
重新接管仍需卸载本插件；精确边界见[关闭后的回退语义](docs/behavior.md#关闭后的回退语义)。
插件不上传额外数据、不做遥测；网络调用限于智谱官方 MCP、兼容回退端点和用户明确传入的 HTTP(S) 页面。

## 卸载

```sh
dsh plugin --profile web remove deepseek-harness-zhipu_plan_tools
dsh plugin --profile open-design remove deepseek-harness-zhipu_plan_tools
dsh plugin --profile headless remove deepseek-harness-zhipu_plan_tools
# 正在运行的 Web GUI 也可使用：
npx -y deepseek-harness-zhipu_plan_tools remove --profile web
```

卸载按 profile 独立清理；两个短进程 profile 从下一次调用起不再加载。`settings.yaml` 中的值可能保留。

## 开发

```powershell
npm run typecheck   # 三个 tsconfig 全量类型检查
npm run build       # host(lib/)+ client(lib/client.js)+ CLI(bin/)+ tests(.tsbuild/)
npm test            # 构建 + node:test 测试套件
npm run verify      # 产物存在性 + 语法 + client bundle 格式 + CLI usage 冒烟
node scripts/smoke-live.mjs   # 真实 API 冒烟（需要凭据；search/reader/zread）
```

改 `src/` 后运行 `npm run build`；Host 以实际 provider/tool 变化验收，Client 以当前 profile 提供的 bundle 与设置卡验收。复杂 patch 的首次挂载限制见[开发指南](docs/development.md#热路径选择智谱专属例外)。

## 开发文档

- [行为契约](docs/behavior.md)
- [运行架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [故障排查](docs/troubleshooting.md)
- [发布流程](docs/release.md)

## 路线图

技术路线图只在[运行架构](docs/architecture.md#技术路线图)维护；版本与 npm 发布状态只在
[发布流程](docs/release.md)维护。

## License

MIT
