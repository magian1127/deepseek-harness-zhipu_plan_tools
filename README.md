# deepseek-harness-zhipu_plan_tools

**智谱 MCP 三件套 · DeepSeek Harness 插件**

[中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="版本 0.1.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.0-5965d8">
  <img alt="功能 搜索/读取/仓库" src="https://img.shields.io/badge/%E5%8A%9F%E8%83%BD-%E6%90%9C%E7%B4%A2%20%C2%B7%20%E8%AF%BB%E5%8F%96%20%C2%B7%20%E4%BB%93%E5%BA%93-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

把智谱(GLM Coding Plan)三个 MCP Server 的能力以 **DSH 原生 provider / 工具**形式接入:
内置 `web_search` / `web_fetch` 后端替换为智谱联网搜索与网页读取,新增三个 `github_*`
开源仓库工具;全部功能可在设置页折叠卡片中实时开关。视觉理解 MCP 已完成调研,
列入[路线图](#路线图)。

## 功能

| 功能 | 默认值 | 说明 |
| --- | --- | --- |
| 联网搜索 | 开 | 内置 `web_search` 后端替换为智谱联网搜索 MCP(`web_search_prime`),中英文源混合返回 |
| 网页读取 | 开(跟随 web_fetch 开关) | 内置 `web_fetch` 后端替换为智谱网页读取 MCP(`webReader`),直接返回 markdown 正文(优于本地 HTML 转换);DSH 默认关闭 `web_fetch`,部署启用后自动生效 |
| 开源仓库 | 开 | 新增 `github_search_doc`(搜仓库文档/issue/commit)、`github_get_repo_structure`(目录结构)、`github_read_file`(读文件)三个模型工具 |
| 设置卡片 | — | DSH 设置 → 插件设置:折叠卡片实时开关各项、配置凭据引用名,中英双语随界面切换 |

### 工作机制

- **搜索/读取 = provider 替换**:注册到 DSH `web` 服务的 provider,由 `cordis.patch.yml`
  把 `web` 行的 `searchProvider` / `fetchProvider` 指向本插件;模型看到的工具名不变
  (`web_search` / `web_fetch`),后端换成智谱。
- **仓库工具 = 原生注册**:三个 `github_*` 工具经 `ctx.tools.register` 注册,带系统提示
  指引与通用卡片,60 秒协作超时。
- **凭据**:统一引用 `ZAI_CODING_CN_API_KEY`(智谱 GLM Coding Plan API Key),三层解析
  (DSH 凭据服务 → 环境变量 → `~/.dsh/.credentials.yaml` 直读);key 永不写入配置或日志。
- **热更新**:host 侧产物自监视热重载(改 `src/` → `npm run build` 即生效,无需重启);
  设置 `applies: 'live'` 实时生效。

## 环境要求

- DeepSeek Harness Web GUI,profile `web`,≥ `0.1.0-rc.7`(设置卡片需要
  `settings.register` 的 `exposeToClients` 支持)
- Node.js `^22.19.0 || >=24.0.0`
- 智谱 GLM Coding Plan API Key(`ZAI_CODING_CN_API_KEY`),添加方式见
  [首次使用](#首次使用添加-zai-coding-cn-提供商)

## 安装

发布后(推荐):

```sh
# 官方通道:安装后按提示热挂载或重启一次
dsh plugin --profile web add deepseek-harness-zhipu_plan_tools

# 热安装:DSH 正在运行时可立即生效
npx -y deepseek-harness-zhipu_plan_tools install --profile web
```

本地源码联调:

```powershell
npm install          # prepare 自动构建
node bin/dsh-zhipu.mjs install --profile web --link <项目绝对路径>
```

CLI 会自动选择热通道:dsh-zh 在运行图中时由其 manifest reconcile 热挂载(约 1-3 秒,
刷新网页生效);否则写入临时热行并如实提示。查看状态:

```sh
npx -y deepseek-harness-zhipu_plan_tools status --profile web
```

## 首次使用：添加 zai-coding-cn 提供商

使用本插件前,先在 DSH 设置中添加 `zai-coding-cn` 提供商(一个步骤,安装后只需做一次):

1. 打开 **DSH 设置 → 模型**;
2. 「提供方」下拉选择 **`zai-coding-cn`**(注意不是海外的 `zai`,本插件走智谱中国区端点 `open.bigmodel.cn`);
3. 「API 密钥」**留空**即可(留空 = 使用环境认证),点保存。

保存后 DSH 会自动使用 `ZAI_CODING_CN_API_KEY` 参数(即配置中 `apiKeyEnv: ZAI_CODING_CN_API_KEY`)
作为该提供商的 API Key——这正是本插件默认的凭据引用名 `credentialRef`。

因此你只需保证 `ZAI_CODING_CN_API_KEY` 已存在于环境变量或 `~/.dsh/.credentials.yaml`,
插件零额外配置即可取到智谱 Coding Plan Key;若你在环境变量中配置了别的名字,可在设置卡片中
把 `credentialRef` 改成对应名字。

## 启用 web_fetch(网页读取)

DSH 预设默认关闭 `web_fetch`(`tool-web` 行 `fetch: false`),本插件不擅自改该开关。
需要网页读取时,在你的 profile patch(`~/.dsh/profiles/web/cordis.patch.yml`)加:

```yaml
- id: tool-web
  config:
    fetch: true
```

之后 `web_fetch` 工具出现并自动走智谱后端。不启用则本功能零感知。

## 设置与数据

| 数据 | 存储位置 |
| --- | --- |
| enabled / search / reader / zread / credentialRef | DSH `settings.yaml`,命名空间 `dsh-zhipu` |

- **总开关 `enabled`**:关闭 = 搜索/读取后端停用、仓库工具卸载、提示移除;设置入口保留。
- **`search` / `reader` 是停用而非回退**:关闭后 `web_search` / `web_fetch` 报"后端不可用"
  结构化错误;彻底恢复内置后端需从挂载行删除 `searchProvider` / `fetchProvider` 指向。
- **`zread` 可干净装卸**:关闭后工具立即从模型工具目录消失。
- 不上传数据、不做遥测、不注册额外网络端点(仅智谱官方 MCP 端点)。

## 卸载

```sh
dsh plugin --profile web remove deepseek-harness-zhipu_plan_tools
# 或
npx -y deepseek-harness-zhipu_plan_tools remove --profile web
```

卸载会清理挂载行与依赖并热卸载(运行中的 DSH 无需重启);`settings.yaml` 中的
`dsh-zhipu` 值可能保留,重新安装后继续生效。

## 开发

```powershell
npm run typecheck   # 三个 tsconfig 全量类型检查
npm run build       # host(lib/)+ client(lib/client.js)+ CLI(bin/)+ tests(.tsbuild/)
npm test            # 构建 + node:test(22 项:核心层/行管理/设置/schema 对齐/装配冒烟)
npm run verify      # 产物存在性 + 语法 + client bundle 格式 + CLI usage 冒烟
node scripts/smoke-live.mjs   # 真实 API 冒烟(需要凭据;search/reader/zread)
```

热迭代循环(不重启 DSH):改 `src/` → `npm run build` → 自监视热重载自动生效;
客户端改动在 `pnpm run dev:web` watcher 下自动推送,否则刷新页面。

## 开发文档

- [行为契约](docs/behavior.md)
- [运行架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [故障排查](docs/troubleshooting.md)
- [发布流程](docs/release.md)

## 路线图

- **视觉理解 MCP(vision)**:8 个官方工具(`analyze_image`、`video_analysis`、OCR、
  UI 转代码、图表分析、双图 diff 等),实现为 GLM-4.6V `chat/completions` 原生工具;
  端点、消息结构、prompt 来源与模型选项(含 `glm-4.6v-flash`)已调研存档于 docs/architecture.md。
- MCP 会话复用(减少每调用一次握手往返)。
- npm 发布(包规格已就绪,`npm pack --dry-run` 校验通过)。

## License

MIT
