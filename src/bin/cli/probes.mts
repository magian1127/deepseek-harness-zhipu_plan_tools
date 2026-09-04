// profile / 运行中 dsh 的探测函数(移植自 dsh-zh probes.mts)。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addManagedRow, hasManagedRow, hotRowBlock, patchPath, removeManagedRow } from '../patch-row.mjs'
import { DSH_ZH_PKG, PKG } from './constants.mjs'
import { profileDir } from './paths.mjs'

export { addManagedRow, hasManagedRow, hotRowBlock, removeManagedRow }

/** 运行中的 dsh web 是否可达(默认 3080)。 */
export function serverAlive(port: number = 3080): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { clearTimeout(timer) })
  } catch {
    return Promise.resolve(false)
  }
}

async function homeHtml(port: number): Promise<string> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 2500)
    return await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .finally(() => { clearTimeout(timer) })
  } catch {
    return ''
  }
}

/**
 * 在启动图 HTML 中匹配包 id。精确匹配原样保留;失败后依次尝试宽松变体
 * (冒号后空格、JSON 内嵌转义、去空白)。均未命中且页面非空时返回 undefined:
 * 序列化格式可能已变化,探测未定,调用方不得当作"未挂载"而误删用户挂载行。
 */
function graphIncludesId(html: string, pkg: string): boolean | undefined {
  if (html.includes(`"id":"${pkg}"`)) return true
  if (html.includes(`"id": "${pkg}"`)) return true
  if (html.includes(`\\"id\\":\\"${pkg}\\"`)) return true
  if (html.replace(/\s+/g, '').includes(`"id":"${pkg}"`)) return true
  return html.length === 0 ? false : undefined
}

/** 运行中的 dsh web 启动图里是否已挂着本插件(任意通道);undefined = 探测未定。 */
export async function liveGraphHasPlugin(port: number = 3080): Promise<boolean | undefined> {
  return graphIncludesId(await homeHtml(port), PKG)
}

/** 运行中的 dsh web 是否挂着 dsh-zh(在场 = manifest 翻转通道可热挂);undefined = 探测未定。 */
export async function liveGraphHasDshZh(port: number = 3080): Promise<boolean | undefined> {
  return graphIncludesId(await homeHtml(port), DSH_ZH_PKG)
}

/** profile 的 bundles 列表是否已包含本插件(持久 bundle 通道就绪)。 */
export function bundlesHasPlugin(name: string = 'web'): boolean {
  const path = join(profileDir(name), 'package.json')
  if (!existsSync(path)) return false
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    return (manifest.dsh?.profile?.bundles ?? []).includes(PKG)
  } catch {
    return false
  }
}

/** patch 文件是否存在(供 status 展示路径)。 */
export function patchExists(name: string = 'web'): boolean {
  return existsSync(patchPath(name))
}
