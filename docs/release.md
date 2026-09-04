# 发布流程（release）

> 本文件是本插件发布前验证、版本记录与 npm 发布的权威位置。日常开发规则见 [`development.md`](development.md)；仓库协作边界只在工作区 `AGENTS.md` 维护。

## 发布前验证

在仓库根目录依次执行，任何一步失败都停止发布并修复：

```powershell
npm run typecheck
npm run build
node --check lib/index.js
node --check lib/client.js
node --check bin/dsh-zhipu.mjs
npm test
npm run verify
npm pack --dry-run --json
```

检查结果至少应证明：

- host、client、CLI 与测试产物可构建；
- Node 产物语法有效；
- client bundle 保持经典 `window.__ModuleLoader__.load(...)` 格式；
- CLI 无参数 usage 冒烟符合约定；
- npm tarball 只包含预期发布文件，不含凭据、日志或本机路径。

涉及用户界面或运行时行为的版本，还要在**现有** DSH GUI 中完成真实验收：client 改动确认实际 bundle 后刷新页面，host 改动依赖自监视局部重载；不得重启 DSH，也不得启动替代服务。本插件复杂 patch 的例外见 [`development.md#热路径选择智谱专属例外`](development.md#热路径选择智谱专属例外)。

## 版本来源

`package.json` 的 `version` 是当前版本号的唯一权威来源。发版时同步检查：

- 双语 README 徽章与用户说明；
- 本文件的对应版本记录；
- `npm pack --dry-run --json` 中的包名、版本和文件清单。

不要在其他技术文档维护“当前版本”副本。

## 版本记录
### 0.1.5

- zread 上游"repo not found"(仓库未被收录或不存在)映射为稳定错误码 `ZHIPU_REPO_NOT_FOUND`,错误消息提示改用其他方式访问 GitHub,不再笼统折叠为"上游工具返回错误";错误脱敏边界不变,上游原文仍只存不可枚举 `detail`;
- 同步 behavior / troubleshooting / development 文档。
- `github_*` 工具执行路径的错误消息随 `zhPrompt` 切换:默认英文,开启后中文;search/reader 的 web 错误消息不受影响。
- 搜索 provider 按请求 `maxResults` 预裁剪智谱超量返回的来源,seam 不再触发截断标记,UI 不再显示「来源列表已截断」。
- scoped `web_search` 合并来源上限从 8 放宽为 12(智谱上游固定返回 10 条,单次查询全部展示给模型与来源面板)。

### 0.1.4

- 对齐 DSH v0.1.2-rc.1:官方 Web 端 agent 预设默认提供 `web_fetch`,「安装后需另行启用 fetch」的旧语义全面修正(behavior / 双语 README / patch 与源码注释 / 设置卡文案 / troubleshooting),并补开启态云端抓取的数据边界说明;
- 搜索失败错误消息补实际请求端点(智谱 MCP / DeepSeek 回退),对齐官方 v0.1.2 起报告端点的行为,错误脱敏边界不变;
- 环境要求提升为 DSH Web GUI ≥ 0.1.2-rc.1。

### 0.1.3

- 恢复系统提示词注入(撤销 df667fd);注入文本与工具说明改为英文对齐内置工具,新增 `zhPrompt` 设置:开启后注入文本与 `github_*` 工具说明切换为中文,实时生效;
- `search` 开启时在 Agent 作用域阴影全局内置 `web_search` 工具与 `tool:web_search` 说明(沿 hashline scoped-shadow 模式),说明同样随 `zhPrompt` 切换中英;
- 修正 web_search 说明:改为一段自写文本(体现智谱后端,含使用与查询要点),不再翻译内置原版简介,也不再单独注入 query-guidance section;
- 修复关闭开关后无法搜索的问题:`search` / `reader` 关闭后由 provider 内部透明回退(内置 DeepSeek 搜索直连 + 直接 HTTP 抓取),不再报后端不可用,无需重启 DSH;
- 修复自监视热重载时序 bug(hmr 延迟创建,改用 ctx.inject 等待);
- 同步更新 behavior / architecture / development 文档与双语 README 中的相关描述。

### 0.1.2

- 加入 `web_search` 查询精度指引，鼓励明确目标与必要限定；
- 将上游结构化 `contentFilter` 映射为 `ZHIPU_CONTENT_FILTERED`；
- 保持查询原样传递，不自动重试、扩大范围或切换后端；
- 增加内容过滤与提示动态装卸测试，并完善构建产物和 CLI usage 校验。

上述行为的现行契约见 [`behavior.md#搜索工具的接管与说明替换`](behavior.md#搜索工具的接管与说明替换) 与 [`behavior.md#错误码速查`](behavior.md#错误码速查)，实现结构见 [`architecture.md`](architecture.md)。版本记录只说明“发生了什么”，不复制完整行为定义。

## npm 发布

1. 确认用户已审核工作区差异，并明确批准提交和发布动作。
2. 首次登录或凭证失效时，在交互式前台执行：

   ```powershell
   npm login --registry https://registry.npmjs.org
   ```

3. 完成[发布前验证](#发布前验证)后发布：

   ```powershell
   npm publish --registry https://registry.npmjs.org
   ```

4. 从官方 registry 核验实际版本：

   ```powershell
   npm view deepseek-harness-zhipu_plan_tools version --registry https://registry.npmjs.org
   ```

显式指定官方 registry，避免本机默认镜像影响登录、发布或查询。npm 需要浏览器认证或 2FA 时保持前台交互，避免后台输出隐藏认证链接。
