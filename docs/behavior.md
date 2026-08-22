# 行为契约（behavior）

> 本文件是用户可见行为、默认值、设置语义、失败模式与错误码的权威位置。
> 安装和卸载入口见 [`README.md`](../README.md)；实现原理见 [`architecture.md`](architecture.md)；遇到故障从 [`troubleshooting.md`](troubleshooting.md) 开始。

## 功能与默认值

| 功能 | 插件默认值 | 用户可见行为 |
| --- | --- | --- |
| 联网搜索 | 开 | 接管内置 `web_search` 后端，调用智谱 `web_search_prime`，返回中英文混合来源 |
| 网页读取 provider | 开 | 接管内置 `web_fetch` 后端，调用智谱 `webReader` 并返回 Markdown 正文；但 DSH 的 `web_fetch` 工具默认关闭，需另行启用 |
| 开源仓库工具 | 关 | 开启后注册 `github_search_doc`、`github_get_repo_structure`、`github_read_file` |
| 设置卡片 | 始终保留 | 位于 DSH 设置 → 插件设置；支持实时开关、凭据引用和中英界面 |

### 搜索查询约定

插件随搜索开关动态注入查询指引，要求模型：

- 每条查询围绕一个明确、可验证的目标；
- 尽量补充实体或主题、事件或指标，以及必要的时间、地区、版本或来源限定；
- 将概览请求按主题拆分，不把多个无关问题拼入一次搜索；
- 保留用户意图，只补充必要限定。

provider 会原样发送最终查询，不静默改写、不自动重试、不扩大范围，也不回退到其他搜索后端。

## 设置语义

设置存储在 DSH `settings.yaml` 的 `dsh-zhipu` 命名空间，修改实时生效：

| 字段 | 类型 | 默认值 | 语义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。关闭后搜索和读取 provider 停用、仓库工具与提示卸载；设置入口保留 |
| `search` | boolean | `true` | 是否接管 `web_search`。关闭是**停用而非回退**，见下文 |
| `reader` | boolean | `true` | 是否接管 `web_fetch`。关闭同样是停用而非回退 |
| `zread` | boolean | `false` | 是否注册三个 `github_*` 工具；关闭后立即从模型工具目录移除 |
| `credentialRef` | string | `ZAI_CODING_CN_API_KEY` | 智谱 GLM Coding Plan API Key 的凭据引用名 |

`search` 或 `reader` 关闭后，挂载配置仍指向本插件 provider，因此对应内置工具会报告后端不可用。若要恢复 DSH 内置后端，必须从挂载行移除对应的 `searchProvider` 或 `fetchProvider` 指向，而不只是关闭设置。

## 凭据与数据边界

### 首次配置

使用前在 **DSH 设置 → 模型** 添加中国区 `zai-coding-cn` 提供商，而不是海外 `zai`。该提供商通过 `apiKeyEnv: ZAI_CODING_CN_API_KEY` 引用环境认证，与插件的默认 `credentialRef` 一致。

确保该引用存在于环境变量或 `${DSH_HOME:-~/.dsh}/.credentials.yaml`；若使用其他变量名，在插件设置卡片修改 `credentialRef`。

### 解析与安全

实际调用按以下顺序解析凭据：

1. DSH credentials 服务；
2. 当前进程环境变量；
3. `${DSH_HOME:-~/.dsh}/.credentials.yaml` 的 `refs` 段。

provider 的 `available()` 只检查环境变量与凭据文件，不发网络请求。API Key 不写入插件配置、日志或错误信息；插件不做遥测、不上传额外数据，也不注册智谱官方 MCP 之外的网络端点。

## `web_fetch` 启用边界

DSH 预设的 `tool-web` 行通常为 `fetch: false`。插件只设置 reader provider，绝不擅自打开工具开关。要使用网页读取，在 profile patch 中启用：

```yaml
- id: tool-web
  config:
    fetch: true
```

启用后 `web_fetch` 自动走智谱 reader；未启用时 provider 虽已注册，但工具不可见、无额外调用。

## 调用边界与失败模式

- **凭据缺失**：搜索/读取报告 `WEB_PROVIDER_CREDENTIAL_MISSING`；仓库工具报告 `ZHIPU_CREDENTIAL_MISSING`。先检查 `zai-coding-cn` 与 `credentialRef` 对应的环境变量或凭据文件。
- **历史工具参数异常**：回放旧 `github_*` 调用时，展示层降级为通用卡片；实际执行仍严格校验，`repo_name` 必须是 `owner/repo`。
- **取消**：`AbortSignal` 全程透传；调用中止后不等待 MCP 会话清理，DELETE 清理失败不覆盖原结果。
- **会话生命周期**：每次调用独立完成 MCP 初始化、调用和清理，当前不复用连接，额外约有一次握手往返。
- **网页正文上限**：`webReader` 正文最多保留 200,000 字符，超出时返回 `truncated: true`。
- **搜索内容过滤**：上游返回结构化 `contentFilter` 时，插件统一映射为 `ZHIPU_CONTENT_FILTERED`，返回固定短提示，引导将搜索收窄到明确目标并补充实体、时间、地区、指标或来源。不会自动重试或切换后端。

## 错误码速查

下表同时列出插件自身错误码和可能由 DSH web 层返回的集成错误码：

| 错误码 | 来源与含义 | 第一反应 |
| --- | --- | --- |
| `WEB_PROVIDER_CONFIGURED_MISSING` | DSH：配置指向的 provider 未注册 | 检查插件挂载行和加载状态 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | DSH：provider 已注册但 `available()` 为 false | 检查总开关、功能开关和本地凭据 |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | 插件：搜索/读取解析不到凭据 | 检查 `credentialRef`、环境变量和凭据文件 |
| `WEB_PROVIDER_ERROR` | 插件或 DSH：搜索/读取传输、解析或 provider 调用失败 | 查看消息中的错误码前缀与 cause |
| `WEB_ABORTED` | 搜索/读取调用被取消 | 正常取消路径；检查调用方 signal |
| `WEB_DUPLICATE_PROVIDER` | DSH：同一 provider id 被重复注册 | 检查是否存在双挂载并确认幂等保护 |
| `ZHIPU_CREDENTIAL_MISSING` | 仓库工具解析不到凭据 | 同凭据检查步骤 |
| `ZHIPU_DISABLED` | 仓库工具执行时已被设置停用 | 开启 `enabled` 和 `zread` |
| `ZHIPU_PROVIDER_ERROR` | 仓库 MCP 的传输、协议或上游调用失败 | 查看消息前缀与 cause |
| `ZHIPU_ABORTED` | 仓库工具调用被取消 | 正常取消路径；检查调用方 signal |
| `ZHIPU_CONTENT_FILTERED` | 智谱 MCP 内容过滤拒绝了当前请求 | 缩小范围并补充具体限定后重试 |
