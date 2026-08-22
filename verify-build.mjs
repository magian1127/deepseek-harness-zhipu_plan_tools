// 构建产物校验:存在性 + 语法 + client bundle 格式 + CLI usage 冒烟。
// 用法:node verify-build.mjs(在 npm run build 之后执行)。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failed = 0
function check(label, ok) {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`)
  if (!ok) failed += 1
}

console.log('[verify-build] 产物存在性')
const artifacts = [
  'lib/index.js',
  'lib/index.d.ts',
  'lib/client.js',
  'lib/client.d.ts',
  'bin/dsh-zhipu.mjs',
  'bin/cli/main.mjs',
  'bin/patch-row.mjs',
]
for (const artifact of artifacts) {
  check(artifact, existsSync(join(root, artifact)))
}

console.log('[verify-build] 语法检查')
for (const file of ['lib/index.js', 'lib/client.js', 'bin/dsh-zhipu.mjs', 'bin/cli/main.mjs', 'bin/patch-row.mjs']) {
  if (!existsSync(join(root, file))) continue
  const res = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' })
  check(`node --check ${file}`, res.status === 0)
}

console.log('[verify-build] client bundle 格式(经典脚本,禁 ESM)')
const clientText = existsSync(join(root, 'lib/client.js')) ? readFileSync(join(root, 'lib/client.js'), 'utf8') : ''
check('window.__ModuleLoader__.load 头', clientText.includes('window.__ModuleLoader__.load'))
check('包 id', /id:\s*['"]deepseek-harness-zhipu_plan_tools['"]/.test(clientText))
check('无 ESM export 语句(顶层)', !/^export\s/m.test(clientText) || clientText.includes('__ModuleLoader__'))

console.log('[verify-build] CLI usage 冒烟(退出码 2)')
const usage = spawnSync(process.execPath, [join(root, 'bin/dsh-zhipu.mjs')], { stdio: 'inherit' })
const cliText = readFileSync(join(root, 'bin/cli/main.mjs'), 'utf8')
check('无参数退出码 2 且打印用法', usage.status === 2 && cliText.includes('用法'))

if (failed > 0) {
  console.error(`[verify-build] ${failed} 项失败`)
  process.exit(1)
}
console.log('[verify-build] 全部通过')
