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

/** 运行中的 dsh web 启动图里是否已挂着本插件(任意通道)。 */
export async function liveGraphHasPlugin(port: number = 3080): Promise<boolean> {
  return (await homeHtml(port)).includes(`"id":"${PKG}"`)
}

/** 运行中的 dsh web 是否挂着 dsh-zh(在场 = manifest 翻转通道可热挂)。 */
export async function liveGraphHasDshZh(port: number = 3080): Promise<boolean> {
  return (await homeHtml(port)).includes(`"id":"${DSH_ZH_PKG}"`)
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
