# 发布流程（release）

> 发布前验证、版本、Git 与 npm 发布的权威位置。
> 实现规则见 `development.md`，发布问题排查见 `troubleshooting.md`。

## 发布前验证

```powershell
npm run typecheck     # 三个 tsconfig 全量
npm run build         # host + client + CLI + tests 产物
node --check lib/index.js
node --check lib/client.js
node --check bin/dsh-zhipu.mjs
npm test              # 构建 + node:test
npm run verify        # 产物存在性 + 语法 + client bundle 格式 + CLI usage
npm pack --dry-run --json   # 校验发布物
```

- 客户端改动刷新页面；host 改动靠自监视热重载。
- npm publish 必须交互式 PowerShell 前台运行（后台会把认证链接脱敏为 `***`，无法完成 2FA）。

## 版本

- 当前版本 `0.1.2`，写在 `package.json` 唯一权威位置；README 徽章与发布说明同步更新。
- 版本号变更只改 `package.json`，不散落硬编码。

## 0.1.2 更新内容

- **搜索查询精度引导**：新增 `tool:web_search:query-guidance` 系统提示，要求模型将搜索收窄为一个明确、可验证的目标，并补充实体、时间、地区、指标、版本或来源等限定。
- **内容过滤错误统一**：新增 `ZHIPU_CONTENT_FILTERED` 错误码；检测到智谱 MCP 的 `contentFilter` 时，返回固定短提示，明确说明查询过于泛化或范围过大，并给出精确化查询建议。
- **保持用户意图**：搜索 provider 继续原样传递查询，不静默改写、不自动重试、不扩大搜索范围，也不回退到其他搜索后端。
- **异常行为沉淀**：记录同一宽泛实时新闻查询可能被上游拒绝或返回 `No results found` 的不稳定行为，避免误判为插件协议错误。
- **测试与校验完善**：补充 MCP 内容过滤、系统提示动态装卸测试，并修正构建产物语法检查与 CLI usage 校验。

## Git 纪律

- 不允许主动执行 `git commit` 或 `git push`；必须先由用户审核并明确批准。
- commit message 必须全中文且以中文开头，英文专业术语放在中文后的括号内。
  - 正确：`默认展开思考（thinking）输出`
  - 错误：`feat: 默认展开思考`
- 默认分支为 `main`。

## npm 发布

```powershell
npm login --registry https://registry.npmjs.org   # 首次/凭证失效时交互登录
npm publish --registry https://registry.npmjs.org
```

- 包名 `deepseek-harness-zhipu_plan_tools` 在官方 registry 未占用。
- 发布到官方 npmjs 时显式指定 registry（本机默认可能指向镜像）。
- 发布后验证:`npm view deepseek-harness-zhipu_plan_tools version --registry https://registry.npmjs.org`。