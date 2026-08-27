/**
 * 自监视热重载(移植自 ZhiPu_web_search / dsh-zh 的 hot-reload 模式)。
 *
 * 官方 CLI 在 web 模式创建的 watch-only hmr 实例只监视用户 patch 层,
 * 不监视插件源码 —— 不主动注册,改 lib 不会生效。这里把本插件产物注册
 * 为 hmr 的精确监视目标:变化 → 暂存 ESM 缓存清理 → debounce 后驱动官方
 * partialReload(清缓存 → 重新 import → 卸载旧纤维 → apply 新代码)。
 *
 * 时序修复(2026-08):web-app bundle 禁用共享 hmr 行,watch-only 实例由
 * launcher 在配置树 settle 之后才创建 —— 本插件(经 bundle 行冷启动)在
 * apply 时 ctx.get('hmr') 必然为 undefined,导致自监视从未注册。修复:
 * 用 ctx.inject(['hmr']) 等待 hmr 服务出现后再注册监视,hmr 缺席时本
 * 插件不被阻塞(能力缺失静默降级,改动靠重启生效)。
 *
 * 关键防坑(playbook 认知要点 3):registerConfig 初始扫描(ignoreInitial:
 * false)的 add 事件必须以 ready 标志忽略,否则注册即自触发 reload 循环。
 * watcher 与 timer 挂在自身 fiber(ctx.effect),重载后由新实例重建。
 */
import { fileURLToPath } from 'node:url'
import type { Disposer, HmrService, HostContext } from './types.js'

/** debounce 窗口:构建脚本连续写多个文件时只触发一次重载。 */
const RELOAD_DEBOUNCE_MS = 150

export function installSelfHotReload(ctx: HostContext, selfModuleUrl: string): void {
  const selfPath = fileURLToPath(selfModuleUrl)
  const disposers: Array<Disposer> = []
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let installing = false
  let ready = false
  let closed = false

  const schedule = (hmr: HmrService): void => {
    if (reloadTimer !== null) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void Promise.resolve(hmr.partialReload()).catch(() => {
        // 重载失败保底:下次会话/重启仍会加载新代码。
      })
    }, RELOAD_DEBOUNCE_MS)
  }

  const install = (hmr: HmrService | undefined | null): void => {
    if (hmr === undefined || hmr === null) return
    if (typeof hmr.registerConfig !== 'function' || typeof hmr.partialReload !== 'function') return
    if (hmr.stashed === undefined || typeof hmr.stashed.add !== 'function') return
    if (ready || installing) return

    installing = true
    let registration: Promise<Disposer>
    try {
      registration = Promise.resolve(hmr.registerConfig(selfPath, () => {
        // 初始扫描的 add 事件必须忽略,防自触发循环。
        if (!ready || closed) return
        try {
          hmr.stashed.add(selfModuleUrl)
        } catch {
          return
        }
        schedule(hmr)
      }))
    } catch {
      installing = false
      return
    }
    void registration.then((disposer: Disposer) => {
      installing = false
      if (closed) {
        void disposer()
        return
      }
      ready = true
      disposers.push(disposer)
    }, () => {
      installing = false
      // 注册失败仅失去本插件自动更新,不改变当前运行实例。
    })
  }

  // 时序修复:bundle 行冷启动时 hmr(watch-only 实例)尚未创建,直接
  // ctx.get 会得到 undefined。先试一次(热挂载场景 hmr 已在),再用
  // inject 等待其出现(冷启动场景)。inject 的 disposer 在 hmr 从未出现
  // 时由 fiber 卸载兜底清理。
  install(ctx.get('hmr') as HmrService | undefined | null)
  ctx.inject(['hmr'], (waitCtx) => {
    install(waitCtx.get('hmr') as HmrService | undefined | null)
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
