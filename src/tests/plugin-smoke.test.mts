// host 装配冒烟(假 ctx,playbook"假 ctx 单测"手法):
// apply → providers/工具/提示词注册齐全;fiber 清理 → 全部可逆;
// settings watch → zread 开关与提示词动态装卸;默认关闭;
// 关闭 search/reader 后 provider 仍 available(回退语义),调用走回退路径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { installSearchToolReplacementForAgent } from '../search-tool.js'
import type { Disposer, HostContext, WebFetchProviderShape, WebSearchProviderShape } from '../types.js'

interface MockCall { kind: string; idOrName: string; text?: string }

interface RegisteredTool {
  readonly name: string
  presentCall?(args: unknown): unknown
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

interface MockOptions {
  settingsBase?: Record<string, unknown>
  /** 模拟凭据解析结果;默认两个 ref 都可用。 */
  credentialRefs?: Record<string, string | undefined>
}

function createMockContext(options?: MockOptions): {
  ctx: HostContext
  calls: MockCall[]
  live: Set<string>
  tools: Map<string, RegisteredTool>
  searchProvider?: WebSearchProviderShape
  fetchProvider?: WebFetchProviderShape
  fetchCalls: Array<{ url: string }>
  fireSettings: (next: Record<string, unknown>) => void
  runDisposers: () => void
} {
  const calls: MockCall[] = []
  const live = new Set<string>()
  const tools = new Map<string, RegisteredTool>()
  const disposers: Array<() => void> = []
  const fetchCalls: Array<{ url: string }> = []
  let settingsWatch: ((next: Record<string, unknown>) => void) | undefined
  let searchProvider: WebSearchProviderShape | undefined
  let fetchProvider: WebFetchProviderShape | undefined

  const credentialRefs = options?.credentialRefs ?? {
    ZAI_CODING_CN_API_KEY: 'zhipu-test-key',
    DEEPSEEK_API_KEY: 'deepseek-test-key',
  }

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
          registerSearchProvider: (p: WebSearchProviderShape) => {
            searchProvider = p
            return track('searchProvider', p.id, () => { searchProvider = undefined })
          },
          registerFetchProvider: (p: WebFetchProviderShape) => {
            fetchProvider = p
            return track('fetchProvider', p.id, () => { fetchProvider = undefined })
          },
        }
      }
      if (name === 'credentials') {
        return {
          resolve: async (ref: string) => {
            const value = credentialRefs[ref]
            return value === undefined ? undefined : { value }
          },
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
                settingsWatch = (next) => cb({ ...base, ...userOverride, ...next }) // 模拟 schemastery live watch:回调收到完整合并快照
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
    get searchProvider() { return searchProvider },
    get fetchProvider() { return fetchProvider },
    fetchCalls,
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
  // 查询指引已并入 scoped tool:web_search,不再单独注册 query-guidance 段。
  assert.equal(mock.live.has('promptSection:tool:web_search:query-guidance'), false)

  mock.runDisposers()
  assert.equal(mock.live.size, 0)
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

test('组合行 config 关闭 zread:初始即不注册工具', () => {
  const mock = createMockContext()
  apply(mock.ctx, { zread: false })
  assert.equal(mock.live.has('tool:github_search_doc'), false)
  assert.ok(mock.live.has('searchProvider:zhipu-web-search-prime'))
})

test('关闭 search:provider 仍 available,search() 回退到内置 DeepSeek 直连', async () => {
  const mock = createMockContext()
  apply(mock.ctx, { search: false })

  assert.ok(mock.searchProvider)
  assert.equal(mock.searchProvider.available(), true)

  // 回退路径:直接 fetch DeepSeek Messages 端点。
  const originalFetch = globalThis.fetch
  const captured: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init })
    return new Response(JSON.stringify({
      content: [
        { type: 'text', text: 'answer', citations: [{ url: 'https://example.com/a', cited_text: 'snippet a' }] },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'A' }] },
      ],
    }), { status: 200 })
  }) as typeof fetch
  try {
    const result = await mock.searchProvider.search({ query: 'test' })
    assert.equal(captured.length, 1)
    assert.match(captured[0].url, /\/anthropic\/v1\/messages$/)
    assert.deepEqual(result.sources.map((s) => s.url), ['https://example.com/a'])
    assert.equal(result.sources[0].snippet, 'snippet a')
    assert.equal(result.truncated, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('关闭 reader:fetch() 回退到内置 HTTP 抓取', async () => {
  const mock = createMockContext()
  apply(mock.ctx, { reader: false })

  assert.ok(mock.fetchProvider)
  assert.equal(mock.fetchProvider.available(), true)

  const originalFetch = globalThis.fetch
  const captured: Array<{ url: string }> = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    captured.push({ url: String(input) })
    return new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }) as typeof fetch
  try {
    const result = await mock.fetchProvider.fetch({ url: 'https://example.com/page' })
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, 'https://example.com/page')
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.kind, 'html')
    assert.equal(result.body.content, '<html>hello</html>')
    assert.equal(result.truncated, false)
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('zhPrompt 切换:工具 description 与提示词 section 随开关中英切换', () => {
  const mock = createMockContext()
  apply(mock.ctx, { zread: true })

  // 默认英文:工具 description 是英文
  const enTool = mock.tools.get('github_read_file')
  assert.ok(enTool)
  const enToolRecord = mock.tools.get('github_read_file')
  assert.ok(enToolRecord)
  const enDescription = String((enToolRecord as unknown as { description?: unknown }).description ?? '')
  assert.match(enDescription, /Read the full content/)

  // 开启 zhPrompt:zread 工具重装为中文 description
  mock.fireSettings({ zhPrompt: true })
  const zhTool = mock.tools.get('github_read_file')
  assert.ok(zhTool)
  assert.notEqual(zhTool, enTool)
  const zhDescription = String((zhTool as unknown as { description?: unknown }).description ?? '')
  assert.match(zhDescription, /读取 GitHub 仓库中一个文件/)

  // 关闭 zhPrompt 恢复英文(再次重装)
  mock.fireSettings({ zhPrompt: false })
  const backTool = mock.tools.get('github_read_file')
  assert.ok(backTool)
  assert.notEqual(backTool, zhTool)
  const backDescription = String((backTool as unknown as { description?: unknown }).description ?? '')
  assert.match(backDescription, /Read the full content/)
})

test('工具替换:Agent 作用域注册同名 web_search 工具与说明,语言随 zhPrompt', () => {
  // 假 Agent ctx:收集 scoped 注册的工具与 section。
  const registeredTools: Array<Record<string, unknown>> = []
  const registeredSections: Array<{ name: string; order?: number; text: unknown }> = []
  let currentSettings: Record<string, unknown> = { zhPrompt: false }

  const scopedCtx = {
    get(name: string): any {
      if (name === 'tools') {
        return {
          register: (definition: Record<string, unknown>) => {
            registeredTools.push(definition)
            return () => {}
          },
        }
      }
      if (name === 'web') {
        return {
          search: async (request: { query: string }) => ({ sources: [{ url: 'https://example.com/' + request.query }], truncated: false }),
        }
      }
      if (name === 'systemPrompt') {
        return {
          section: (section: { name: string; order?: number; text: unknown }) => {
            registeredSections.push(section)
            return () => {}
          },
        }
      }
      return undefined
    },
  }
  const getSettings = (): unknown => ({ enabled: true, search: true, zread: true, zhPrompt: Boolean(currentSettings.zhPrompt), credentialRef: 'ZAI_CODING_CN_API_KEY' })

  // 默认英文
  let disposer = installSearchToolReplacementForAgent({ ctx: scopedCtx as unknown as HostContext }, getSettings as never)
  assert.ok(disposer)
  const enTool = registeredTools.find((tool) => tool.name === 'web_search')
  assert.ok(enTool)
  assert.match(String(enTool.description), /Search the web for up-to-date information/)
  const enSection = registeredSections.find((section) => section.name === 'tool:web_search')
  assert.ok(enSection)
  const enText = typeof enSection.text === 'function' ? (enSection.text as () => string)() : String(enSection.text)
  assert.match(enText, /Use the web_search tool to search the web through Zhipu/)
  assert.ok(!/discover current information/.test(enText), '说明不得再是内置原版文本')

  // 开启 zhPrompt:重新注册(卸载旧 + 装新)后为中文
  disposer()
  registeredTools.length = 0
  registeredSections.length = 0
  currentSettings = { zhPrompt: true }
  disposer = installSearchToolReplacementForAgent({ ctx: scopedCtx as unknown as HostContext }, getSettings as never)
  assert.ok(disposer)
  const zhTool = registeredTools.find((tool) => tool.name === 'web_search')
  assert.ok(zhTool)
  assert.match(String(zhTool.description), /通过智谱搜索获取网络信息/)
  const zhSection = registeredSections.find((section) => section.name === 'tool:web_search')
  assert.ok(zhSection)
    const zhText = typeof zhSection.text === 'function' ? (zhSection.text as () => string)() : String(zhSection.text)
  assert.match(zhText, /使用 web_search 工具通过智谱/)
  assert.match(zhText, /使用 web_search 工具/)
  disposer()
})
