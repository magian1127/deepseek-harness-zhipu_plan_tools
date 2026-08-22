# 发布流程（release）

> 本文件是发布前验证、版本记录与 npm 发布的权威位置。
> 日常开发验证见 [`development.md#验证分层`](development.md#验证分层)，Git 协作规则见 [`../AGENTS.md#git-纪律`](../AGENTS.md#git-纪律)。

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

涉及用户界面或运行时行为的版本，还要在**现有** DSH GUI 中完成真实验收：client 改动按开发热路径推送或刷新页面，host 改动依赖自监视局部重载；不得重启 DSH，也不得启动替代服务。热路径细节见 [`development.md#热路径选择`](development.md#热路径选择)。

## 版本来源

`package.json` 的 `version` 是当前版本号的唯一权威来源。发版时同步检查：

- 双语 README 徽章与用户说明；
- 本文件的对应版本记录；
- `npm pack --dry-run --json` 中的包名、版本和文件清单。

不要在其他技术文档维护“当前版本”副本。

## 版本记录

### 0.1.2

- 加入 `web_search` 查询精度指引，鼓励明确目标与必要限定；
- 将上游结构化 `contentFilter` 映射为 `ZHIPU_CONTENT_FILTERED`；
- 保持查询原样传递，不自动重试、扩大范围或切换后端；
- 增加内容过滤与提示动态装卸测试，并完善构建产物和 CLI usage 校验。

上述行为的现行契约见 [`behavior.md#搜索查询约定`](behavior.md#搜索查询约定) 与 [`behavior.md#错误码速查`](behavior.md#错误码速查)，实现结构见 [`architecture.md`](architecture.md)。版本记录只说明“发生了什么”，不复制完整行为定义。

## npm 发布

1. 确认用户已审核工作区差异，并按 [`AGENTS.md`](../AGENTS.md) 的规则明确批准提交和发布动作。
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
