// CLI 参数解析与命令分发(通道逻辑按 PLAN 架构决策 10)。
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { PKG, type ParsedCliArgs, type ProfileManifest } from './constants.mjs'
import { manifestPath } from './paths.mjs'
import { addManagedRow, hasManagedRow, hotRowBlock, removeManagedRow } from './probes.mjs'
import { bundlesHasPlugin, liveGraphHasDshZh, liveGraphHasPlugin, serverAlive } from './probes.mjs'
import { runDshPlugin } from './invocations.mjs'

function parseArgs(argv: string[]): ParsedCliArgs {
  let profile = 'web'
  let link: string | null = null
  let port = 3080
  const rest: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' && argv[i + 1] !== undefined) {
      profile = argv[i + 1]
      i += 1
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      port = parseInt(argv[i + 1], 10)
      if (!Number.isInteger(port) || port < 1 || port > 65535) port = 3080
      i += 1
    } else if (arg === '--link' && argv[i + 1] !== undefined) {
      link = isAbsolute(argv[i + 1]) ? argv[i + 1] : resolve(process.cwd(), argv[i + 1])
      i += 1
    } else {
      rest.push(arg)
    }
  }
  return { profile, link, port, rest }
}

export async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'install') {
    const { profile, link, port, rest: extra } = parseArgs(rest)
    const spec = link !== null ? `link:${link}` : extra[0] ?? PKG
    console.log(`[${PKG}] install ${spec} -> profile "${profile}"`)
    const code = runDshPlugin(profile, ['add', spec])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖安装失败(退出码 ${code})`)
      process.exitCode = code
      return
    }
    // 持久通道:dsh.bundle 声明会让 dsh plugin add 把本包编进 bundles。
    if (!bundlesHasPlugin(profile)) {
      console.warn(`[${PKG}] 警告:bundles 未包含本插件,裸 dsh plugin add 后重启也不会挂载(版本可能过旧)`)
    }
    // 防重复:运行中已挂载(任意通道)→ 只清残留热行,不写新行。
    const liveHere = await liveGraphHasPlugin(port)
    if (liveHere === true) {
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] 检测到运行中已挂载本插件;已清理临时挂载行,下次启动只走 bundle 行`)
      } else {
        console.log(`[${PKG}] 检测到运行中已挂载本插件;无需写入挂载行`)
      }
      return
    }
    if (liveHere === undefined) {
      console.log(`[${PKG}] 自动探测未能确认挂载状态,请人工核实插件列表;按未挂载继续(写入为幂等操作)`)
    }
    if (await serverAlive(port)) {
      if ((await liveGraphHasDshZh(port)) === true) {
        // 热通道 ①:dsh-zh 在场,其 manifest reconcile(watchFile 1s 轮询 +
        // 500ms debounce,先 removed 后 added)会对刚才的 manifest 变化热挂。
        console.log(`[${PKG}] dsh web 运行中且 dsh-zh 在场:manifest 翻转已提交,约 1-3 秒内热挂载,刷新网页即生效(无需重启)`)
      } else {
        // 热通道 ②:写临时热行。当前运行版本官方 patch watcher 可能不生效,
        // 如实提示;冷启动必然生效(bundle 行 + 热行并存由幂等注册兜底)。
        addManagedRow(hotRowBlock(), profile)
        console.log(`[${PKG}] dsh web 运行中(dsh-zh 不在场):已写入临时热行`)
        console.log(`[${PKG}] 若数秒后未热挂载,说明当前运行版本的 patch watcher 不生效——冷启动后必然生效(重启后 bundle 行与热行并存,注册幂等保护兜底单活实例)`)
      }
    } else {
      // 服务没在跑:不写任何临时行,保证下次启动只有 bundle 一行。
      if (removeManagedRow(profile)) {
        console.log(`[${PKG}] dsh web 未运行:已清理临时挂载行`)
      }
      console.log(`[${PKG}] dsh web 未运行:bundle 通道已就绪,下次启动后生效`)
    }
    return
  }
  if (cmd === 'remove') {
    const { profile } = parseArgs(rest)
    console.log(`[${PKG}] remove from profile "${profile}"`)
    const removedRow = removeManagedRow(profile)
    console.log(removedRow
      ? `[${PKG}] 已删除挂载行;运行中的 dsh web 会立即热卸载(无需重启)`
      : `[${PKG}] 挂载行不存在(可能已是卸载状态)`)
    const code = runDshPlugin(profile, ['remove', PKG])
    if (code !== 0) {
      console.error(`[${PKG}] 依赖清理失败(退出码 ${code})——挂载行已移除,插件已不在运行`)
      process.exitCode = code
      return
    }
    console.log(`[${PKG}] 卸载完成:依赖与挂载行均已清理`)
    return
  }
  if (cmd === 'status') {
    const { profile, port } = parseArgs(rest)
    const manifestFilePath = manifestPath(profile)
    let manifest: ProfileManifest = {}
    if (existsSync(manifestFilePath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestFilePath, 'utf8'))
      } catch (error) {
        console.error(`[${PKG}] 无法读取 profile manifest: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
        return
      }
    }
    const dep = manifest.dependencies?.[PKG]
    const live = await liveGraphHasPlugin(port)
    const dshZh = await liveGraphHasDshZh(port)
    console.log(`[${PKG}] status (profile "${profile}")`)
    console.log(`  依赖:        ${dep ?? '(未安装)'}`)
    console.log(`  运行中:      ${live === true ? '已挂载' : live === false ? '未挂载' : '探测未定(请人工核实插件列表)'}`)
    console.log(`  bundle 通道: ${bundlesHasPlugin(profile) ? '已就绪(重启自动挂载)' : '未就绪'}`)
    console.log(`  临时热行:    ${hasManagedRow(profile) ? '存在(重启由幂等保护兜底)' : '无'}`)
    console.log(`  dsh-zh:      ${dshZh === true ? '在场(manifest 翻转热挂通道可用)' : dshZh === false ? '不在场(热挂依赖官方 patch watcher)' : '探测未定(请人工核实)'}`)
    return
  }
  console.log(`[${PKG}] 用法:`)
  console.log(`  npx -y ${PKG} install [--profile web] [--link <目录>] [--port 3080]`)
  console.log(`  npx -y ${PKG} remove  [--profile web]`)
  console.log(`  npx -y ${PKG} status  [--profile web] [--port 3080]`)
  process.exitCode = 2
}
