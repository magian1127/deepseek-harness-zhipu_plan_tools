/**
 * 自监视热重载(移植自 ZhiPu_web_search / dsh-zh 的 hot-reload 模式)。
 *
 * 官方 CLI 在 web 模式创建的 watch-only hmr 实例只监视用户 patch 层,
 * 不监视插件源码 —— 不主动注册,改 lib 不会生效。这里把本插件产物注册
 * 为 hmr 的精确监视目标:变化 → 暂存 ESM 缓存清理 → debounce 后驱动官方
 * partialReload(清缓存 → 重新 import → 卸载旧纤维 → apply 新代码)。
 *
 * 关键防坑(playbook 认知要点 3):registerConfig 初始扫描(ignoreInitial:
 * false)的 add 事件必须以 ready 标志忽略,否则注册即自触发 reload 循环。
 * watcher 与 timer 挂在自身 fiber(ctx.effect),重载后由新实例重建。
 */
import { fileURLToPath } from 'node:url'
import type { Disposer, HmrService, HostContext } from './types.js'

/** debounce 窗口:构建脚本连续写多个文件时只触发一次重载。 */
const RELOAD_DEBOUNCE_MS = 150

let reloadTimer: ReturnType<typeof setTimeout> | null = null

export function installSelfHotReload(ctx: HostContext, selfModuleUrl: string): void {
  const hmr = ctx.get('hmr') as HmrService | undefined | null
  if (hmr === undefined || hmr === null) return
  if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') return
  if (hmr.stashed === undefined || typeof hmr.stashed.add !== 'function') return

  const selfPath = fileURLToPath(selfModuleUrl)
  const disposers: Array<Disposer> = []
  let ready = false
  let closed = false

  const schedule = (): void => {
    if (reloadTimer !== null) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void Promise.resolve(hmr.partialReload()).catch(() => {
        // 重载失败保底:下次会话/重启仍会加载新代码。
      })
    }, RELOAD_DEBOUNCE_MS)
  }

  void Promise.resolve(hmr.registerConfig(selfPath, () => {
    // 初始扫描的 add 事件必须忽略,防自触发循环。
    if (!ready || closed) return
    try {
      hmr.stashed.add(selfModuleUrl)
    } catch {
      return
    }
    schedule()
  })).then((disposer: Disposer) => {
    if (closed) {
      void disposer()
      return
    }
    ready = true
    disposers.push(disposer)
  }, () => {
    // 监视注册失败:静默降级(如 hmr 尚未 active 或已被其它实例注册),
    // 改动靠重启生效。
  })

  // 清理必须作为 effect 回调的「返回值」——ctx.effect 会立即调用回调、把其
  // 返回值当作卸载时的 disposer。若把 cleanup 直接写在回调体内,会在注册时
  // 立即执行,顺手把刚建立的 watcher 移除,自监视等于空转。
  ctx.effect(() => {
    return () => {
      closed = true
      if (reloadTimer !== null) {
        clearTimeout(reloadTimer)
        reloadTimer = null
      }
      for (const disposer of disposers.splice(0)) disposer()
    }
  }, 'dsh-zhipu: self hot reload')
}