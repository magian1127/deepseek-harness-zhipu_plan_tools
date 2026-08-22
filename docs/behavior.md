# 行为契约（behavior）

> 本文件是用户可见行为、默认值、设置语义与失败模式的权威位置。

## 功能与默认值

| 功能 | 默认值 | 说明 |
| --- | --- | --- |
| 联网搜索 | 开 | 内置 `web_search` 后端替换为智谱联网搜索 MCP（`web_search_prime`），中英文源混合返回 |
| 网页读取 | 开（跟随 `web_fetch` 开关） | 内置 `web_fetch` 后端替换为智谱网页读取 MCP（`webReader`，markdown 正文）；DSH 默认关闭 `web_fetch`，部署启用后自动生效 |
| 开源仓库 | 关 | 默认不注册；开启后新增 `github_search_doc` / `github_get_repo_structure` / `github_read_file` 三个模型工具 |
| 设置卡片 | — | DSH 设置 → 插件设置：折叠卡片实时开关各项、配置凭据引用名，中英双语随界面切换 |

## 设置语义

两层设置，均可写 `settings.yaml`：

| 字段 | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | 总开关：关闭 = 搜索/读取后端停用、仓库工具卸载、提示移除；设置入口保留 |
| `search` | bool | `true` | 是否接管 `web_search` 后端。**停用而非回退**——关闭后 `web_search` 报结构化错误；彻底恢复内置需删 mount 行的 `searchProvider` 指向 |
| `reader` | bool | `true` | 是否接管 `web_fetch` 后端，语义同 `search` |
| `zread` | bool | `false` | 是否注册 3 个 `github_*` 工具。默认关闭；开启后可干净装卸，关闭后工具立即从模型工具目录消失 |
| `credentialRef` | string | `ZAI_CODING_CN_API_KEY` | 智谱 Coding Plan API Key 的凭据引用名 |

## 凭据与安全

- **前置步骤**：使用前先在 DSH 设置 → 模型添加 `zai-coding-cn` 提供商（「API 密钥」留空，
  保存后 DSH 自动使用 `ZAI_CODING_CN_API_KEY` 参数，即配置中
  `apiKeyEnv: ZAI_CODING_CN_API_KEY`）——与本插件默认 `credentialRef` 同名，零额外配置。
  注意选 `zai-coding-cn`（中国区）而非海外的 `zai`，本插件走 `open.bigmodel.cn` 端点。
- 统一引用 `ZAI_CODING_CN_API_KEY`（智谱 GLM Coding Plan Key），解析顺序：
  DSH 凭据服务 `resolve()` → 环境变量 → 直读 `~/.dsh/.credentials.yaml`；`available()`
  用同序本地检查、不发网络请求。
- key 永不写入 cordis.yml、日志或错误信息；不做遥测、不上传数据、不注册额外网络端点（仅智谱官方 MCP 端点）。

## 边界与失败模式

- **凭据缺失**：`web_search` 报结构化 unavailable 错误；`web_fetch`（若启用）同理；`github_*` 工具执行时报 `ZHIPU_CREDENTIAL_MISSING`。第一反应：确认已添加 `zai-coding-cn` 提供商，且 `ZAI_CODING_CN_API_KEY` 存在于环境变量或 `~/.dsh/.credentials.yaml`。
- **历史工具调用参数异常**：回放旧的 `github_*` 调用时，展示层会降级为通用卡片而不抛出宿主日志；这不放宽实际执行，缺失或非 `owner/repo` 格式的 `repo_name` 仍会被严格拒绝。
- **取消**：`exec.signal` 全程透传；DELETE 清理失败静默；abort 后不等清理。
- **MCP 会话不复用**：每调用完整生命周期，多 ~1 RTT（留路线图优化）。
- **webReader 正文截断** 200_000 字符（对齐 `DEFAULT_FETCH_MAX_OUTPUT_CHARS`）。
- **`web_fetch` 默认关闭**：DSH 预设 `tool-web` 行 `fetch: false`；未启用时 reader provider 注册但无感知，启用 `fetch: true` 后自动接管。

## 错误码速查

| 码 | 含义 | 第一反应 |
| --- | --- | --- |
| `WEB_PROVIDER_CONFIGURED_MISSING` | 配置的 provider id 未注册 | 插件行没挂上 / 被卸载 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | 已注册但 `available()` false | 凭据本地检查失败（查 `dshHome()` 回退） |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | resolve 阶段拿不到键 | 确认已添加 `zai-coding-cn` 提供商；凭据服务/文件内容问题 |
| `WEB_PROVIDER_ERROR` | provider 调用链失败 | 看 message 的 `[CODE]` 前缀与 cause |
| `ZHIPU_CREDENTIAL_MISSING` | 仓库工具拿不到凭据 | 同上 |
| `ZHIPU_DISABLED` | 仓库工具被设置停用 | 设置页开启 `enabled` + `zread` |
| `WEB_ABORTED` | 调用被中止 | 正常取消路径 |
| `WEB_DUPLICATE_PROVIDER` | 同 id 重复注册 | 双行挂载，需幂等保护 |
| `WEB_PROVIDER_ERROR` | provider 调用链失败 | 看 message 前缀 |
