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

- 当前版本 `0.1.0`，写在 `package.json` 唯一权威位置；README 徽章与文档同步更新。
- 版本号变更只改 `package.json`，不散落硬编码。

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