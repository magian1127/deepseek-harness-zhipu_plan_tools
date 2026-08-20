// host 装配冒烟(假 ctx,playbook"假 ctx 单测"手法):
// apply → providers/工具/提示词注册齐全;fiber 清理 → 全部可逆;
// settings watch → zread 开关动态装卸。
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import type { Disposer, HostContext } from '../types.js'

interface MockCall { kind: string; idOrName: string }

function createMockContext(options?: { settingsBase?: Record<string, unknown> }): {
  ctx: HostContext
  calls: MockCall[]
  live: Set<string>
  fireSettings: (next: Record<string, unknown>) => void
  runDisposers: () => void
} {
  const calls: MockCall[] = []
  const live = new Set<string>()
  const disposers: Array<() => void> = []
  let settingsWatch: ((next: Record<string, unknown>) => void) | undefined

  const track = (kind: string, idOrName: string, dispose: () => void): Disposer => {
    calls.push({ kind, idOrName })
    live.add(`${kind}:${idOrName}`)
    return () => {
      live.delete(`${kind}:${idOrName}`)
      dispose()
    }
  }

  const ctx: HostContext = {
    get(name: string): any {
      if (name === 'web') {
        return {
          registerSearchProvider: (p: { id: string }) => track('searchProvider', p.id, () => {}),
          registerFetchProvider: (p: { id: string }) => track('fetchProvider', p.id, () => {}),
        }
      }
      if (name === 'tools') {
        return { register: (t: { name: string }) => track('tool', t.name, () => {}) }
      }
      if (name === 'systemPrompt') {
        return { section: (s: { name: string }) => track('promptSection', s.name, () => {}) }
      }
      if (name === 'settings') {
        const userOverride = options?.settingsBase ?? {}
        return {
          register(_ns: string, _schema: unknown, registerOptions: Record<string, unknown>) {
            assert.equal(registerOptions.applies, 'live')
            assert.equal(registerOptions.exposeToClients, true)
            const base = registerOptions.base as Record<string, unknown>
            return {
              // 模拟 schemastery:base(组合行 config)填默认后作为快照,
              // 再叠加用户覆盖。
              get: () => ({ ...base, ...userOverride }),
              watch(cb: (next: Record<string, unknown>) => void) {
                settingsWatch = cb
                return () => { settingsWatch = undefined }
              },
            }
          },
        }
      }
      return undefined
    },
    on: () => () => {},
    effect(dispose: () => void | (() => void)) {
      const inner = dispose() ?? (() => {})
      disposers.push(inner)
      return () => {}
    },
    inject: () => () => {},
  }

  return {
    ctx,
    calls,
    live,
    fireSettings: (next) => { settingsWatch?.(next) },
    runDisposers: () => { for (const d of disposers.splice(0)) d() },
  }
}

test('apply 装配:providers + 3 工具 + 3 提示词;清理全部可逆', () => {
  const mock = createMockContext()
  apply(mock.ctx, {})

  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
  assert.ok(mock.live.has('fetchProvider:zhipu-web-reader'))
  assert.ok(mock.live.has('tool:github_search_doc'))
  assert.ok(mock.live.has('tool:github_get_repo_structure'))
  assert.ok(mock.live.has('tool:github_read_file'))
  assert.ok(mock.live.has('promptSection:tool:github_search_doc'))

  mock.runDisposers()
  assert.equal(mock.live.size, 0)
})

test('settings watch:zread 关闭即卸载工具与提示词,providers 常驻', () => {
  const mock = createMockContext({ settingsBase: {} })
  apply(mock.ctx, {})
  assert.ok(mock.live.has('tool:github_search_doc'))

  mock.fireSettings({ zread: false })
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.equal(mock.live.has('promptSection:tool:github_search_doc'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))

  mock.fireSettings({ zread: true })
  assert.ok(mock.live.has('tool:github_search_doc'))

  mock.fireSettings({ enabled: false })
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
})

test('组合行 config 关闭 zread:初始即不注册工具', () => {
  const mock = createMockContext()
  apply(mock.ctx, { zread: false })
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
})
