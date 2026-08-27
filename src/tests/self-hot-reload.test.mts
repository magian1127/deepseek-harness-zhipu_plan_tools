import test from 'node:test'
import assert from 'node:assert/strict'
import { installSelfHotReload } from '../self-hot-reload.js'
import type { Disposer, HmrService, HostContext } from '../types.js'

test('HMR 已可见且 inject 同步回调时只注册一个 watcher', async () => {
  let registerCalls = 0
  let watcherDisposed = 0
  let resolveRegistration: ((dispose: Disposer) => void) | undefined
  const hmr: HmrService = {
    stashed: new Set<string>(),
    registerConfig: async () => {
      registerCalls++
      return new Promise<Disposer>((resolve) => { resolveRegistration = resolve })
    },
    partialReload: async () => undefined,
  }
  const fiberDisposers: Disposer[] = []
  let ctx: HostContext
  ctx = {
    get: (name) => name === 'hmr' ? hmr : undefined,
    on: () => () => {},
    inject: (_deps, callback) => {
      callback(ctx)
      return () => {}
    },
    effect: (setup) => {
      const dispose = setup()
      if (typeof dispose === 'function') fiberDisposers.push(dispose)
      return () => {}
    },
  }

  installSelfHotReload(ctx, import.meta.url)
  assert.equal(registerCalls, 1)
  assert.ok(resolveRegistration)
  resolveRegistration(() => { watcherDisposed++ })
  await new Promise<void>((resolve) => { setImmediate(resolve) })

  for (const dispose of fiberDisposers.splice(0).reverse()) dispose()
  assert.equal(watcherDisposed, 1)
})
