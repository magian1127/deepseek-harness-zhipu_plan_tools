# deepseek-harness-zhipu_plan_tools

**智谱 MCP 三件套 · DeepSeek Harness 插件**

[中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="版本 0.1.2" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.2-5965d8">
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
| 网页读取（接管 `web_fetch`） | 开 | 通过智谱 `webReader` 返回 Markdown；DSH 默认关闭 `web_fetch`，仍需另行启用该工具 |
| 开源仓库工具 | 关 | 注册 `github_search_doc`、`github_get_repo_structure`、`github_read_file` |
| 提示词中文化 | 关 | 将插件注入的提示与工具说明从默认英文切换为中文；工具名不变 |
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

- DeepSeek Harness Web GUI，profile `web`，≥ `0.1.2-alpha.1`
- Node.js `^22.19.0 || >=24.0.0`
- 智谱 GLM Coding Plan API Key；默认引用名为 `ZAI_CODING_CN_API_KEY`

## 安装

npm 注册表安装：

```sh
# 官方持久通道：自然下一次启动后生效
dsh plugin --profile web add deepseek-harness-zhipu_plan_tools

# 热安装：DSH 正在运行时可立即生效
npx -y deepseek-harness-zhipu_plan_tools install --profile web
```

本地源码联调：

```powershell
npm install          # prepare 自动构建
node bin/dsh-zhipu.mjs install --profile web --link <项目绝对路径>
```

本包 patch 含 `web.config`，不符合 dsh-zh 的简单 manifest reconcile；CLI 会使用本项目的桥接/临时行策略。提示完成后仍需用 `status`、实际 provider/tool 状态和现有 GUI 确认是否挂载：

```sh
npx -y deepseek-harness-zhipu_plan_tools status --profile web
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

## 启用 web_fetch（网页读取）

DSH 预设默认关闭 `web_fetch`（`tool-web` 行 `fetch: false`），本插件不擅自改该开关。
需要网页读取时，在你的 profile patch（`~/.dsh/profiles/web/cordis.patch.yml`）加：

```yaml
- id: tool-web
  config:
    fetch: true
```

之后 `web_fetch` 工具出现并自动走智谱后端。不启用则本功能零感知。

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
# 或
npx -y deepseek-harness-zhipu_plan_tools remove --profile web
```

卸载会清理挂载行与依赖并热卸载（运行中的 DSH 无需重启）；`settings.yaml` 中的
`dsh-zhipu` 值可能保留，重新安装后继续生效。

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
