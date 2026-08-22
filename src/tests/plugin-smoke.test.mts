// host 装配冒烟(假 ctx,playbook"假 ctx 单测"手法):
// apply → providers/工具/提示词注册齐全;fiber 清理 → 全部可逆;
// settings watch → zread 开关动态装卸;默认关闭。
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import type { Disposer, HostContext } from '../types.js'

interface MockCall { kind: string; idOrName: string; text?: string }

interface RegisteredTool {
  readonly name: string
  presentCall?(args: unknown): unknown
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

function createMockContext(options?: { settingsBase?: Record<string, unknown> }): {
  ctx: HostContext
  calls: MockCall[]
  live: Set<string>
  tools: Map<string, RegisteredTool>
  fireSettings: (next: Record<string, unknown>) => void
  runDisposers: () => void
} {
  const calls: MockCall[] = []
  const live = new Set<string>()
  const tools = new Map<string, RegisteredTool>()
  const disposers: Array<() => void> = []
  let settingsWatch: ((next: Record<string, unknown>) => void) | undefined

  const track = (kind: string, idOrName: string, dispose: () => void, text?: string): Disposer => {
    calls.push({ kind, idOrName, ...(text === undefined ? {} : { text }) })
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
        return {
          register: (tool: RegisteredTool) => {
            tools.set(tool.name, tool)
            return track('tool', tool.name, () => { tools.delete(tool.name) })
          },
        }
      }
      if (name === 'systemPrompt') {
        return { section: (s: { name: string; text?: string }) => track('promptSection', s.name, () => {}, s.text) }
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
    tools,
    fireSettings: (next) => { settingsWatch?.(next) },
    runDisposers: () => { for (const d of disposers.splice(0)) d() },
  }
}

test('apply 装配:providers 常驻;zread 默认关闭;清理全部可逆', () => {
  const mock = createMockContext()
  apply(mock.ctx, {})

  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
  assert.ok(mock.live.has('fetchProvider:zhipu-web-reader'))
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.equal(mock.live.has('promptSection:tool:github_search_doc'), false)
  const guidance = mock.calls.find((call) => call.idOrName === 'tool:web_search:query-guidance')
  assert.ok(guidance)
  assert.match(guidance.text ?? '', /明确、可验证的目标/)
  assert.match(guidance.text ?? '', /具体实体或主题/)
  assert.match(guidance.text ?? '', /时间、地区、版本或来源限定/)
  assert.match(guidance.text ?? '', /过于泛化或范围过大/)
  assert.match(guidance.text ?? '', /多个无关问题/)
  assert.ok(!mock.live.has('promptSection:tool:web_search'))

  mock.runDisposers()
  assert.equal(mock.live.size, 0)
  assert.equal(mock.calls.some((call) => call.idOrName === 'tool:web_search:query-guidance'), true)
})

test('settings watch:zread 关闭即卸载工具与提示词,providers 常驻', () => {
  const mock = createMockContext({ settingsBase: {} })
  apply(mock.ctx, { zread: true })
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


test('search 关闭时移除查询指引,重新开启时恢复', () => {
  const mock = createMockContext()
  apply(mock.ctx, { search: true })
  assert.ok(mock.live.has('promptSection:tool:web_search:query-guidance'))

  mock.fireSettings({ search: false })
  assert.equal(mock.live.has('promptSection:tool:web_search:query-guidance'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))

  mock.fireSettings({ search: true })
  assert.ok(mock.live.has('promptSection:tool:web_search:query-guidance'))
  mock.runDisposers()
})

test('组合行 config 关闭 zread:初始即不注册工具', () => {
  const mock = createMockContext()
  apply(mock.ctx, { zread: false })
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
})

test('畸形历史调用只降级展示，执行仍严格拒绝', async () => {
  const mock = createMockContext()
  apply(mock.ctx, { zread: true })

  const tool = mock.tools.get('github_read_file')
  assert.ok(tool)
  assert.deepEqual(
    tool.presentCall?.({ repo_name: 'vitejs/vite', file_path: 'src/index.ts' }),
    { card: 'generic', title: 'vitejs/vite/src/index.ts', kind: 'fetch', rawInput: 'vitejs/vite src/index.ts' },
  )
  assert.equal(tool.presentCall?.({ file_path: 'scripts/generate-readme.mjs' }), undefined)
  await assert.rejects(
    tool.execute({ file_path: 'scripts/generate-readme.mjs' }, {}),
    /repo_name must look like "owner\/repo"/,
  )
})
