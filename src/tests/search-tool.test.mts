import test from 'node:test'
import assert from 'node:assert/strict'
import { installSearchToolReplacementForAgent } from '../search-tool.js'
import type { HostContext } from '../types.js'
import type { ZhipuSettings } from '../settings-schema.js'

const settings: ZhipuSettings = {
  enabled: true,
  search: true,
  reader: true,
  zread: false,
  zhPrompt: false,
  credentialRef: 'ZAI_CODING_CN_API_KEY',
}

function scopedContext(
  search: (request: { query: string; maxResults?: number }, signal?: AbortSignal) => Promise<any>,
  onRegister?: (definition: any) => void,
  onDispose?: () => void,
  section?: () => () => void,
): HostContext {
  return {
    get(name: string): unknown {
      if (name === 'tools') {
        return {
          register(definition: any) {
            onRegister?.(definition)
            return () => { onDispose?.() }
          },
        }
      }
      if (name === 'web') return { search }
      if (name === 'systemPrompt') return { section: section ?? (() => () => {}) }
      return undefined
    },
    on: () => () => {},
    effect: () => () => {},
    inject: () => () => {},
  }
}

test('scoped web_search 保留查询上限、结果上限与轮询合并语义', async () => {
  let definition: any
  const calls: Array<{ query: string; maxResults?: number }> = []
  const ctx = scopedContext(async (request) => {
    calls.push(request)
    const prefix = request.query === 'alpha' ? 'a' : 'b'
    return {
      sources: Array.from({ length: 6 }, (_value, index) => ({ url: `https://example.com/${prefix}${index + 1}` })),
      truncated: false,
    }
  }, (value) => { definition = value })
  const dispose = installSearchToolReplacementForAgent({ ctx }, () => settings)
  assert.ok(dispose)
  assert.equal(definition.timeoutMs, 30_000)

  await assert.rejects(
    () => definition.execute({ queries: ['1', '2', '3', '4', '5'] }, {}),
    /at most 4 queries/,
  )

  const result = await definition.execute({ queries: ['alpha', 'beta'] }, {})
  assert.deepEqual(calls.map((call) => call.maxResults), [8, 8])
  assert.deepEqual(
    result.sources.map((source: { url: string }) => source.url),
    [
      'https://example.com/a1', 'https://example.com/b1',
      'https://example.com/a2', 'https://example.com/b2',
      'https://example.com/a3', 'https://example.com/b3',
      'https://example.com/a4', 'https://example.com/b4',
    ],
  )
  assert.equal(result.truncated, true)

  assert.deepEqual(
    definition.presentCall({ queries: ['alpha', 'beta'] }),
    { card: 'generic', title: 'alpha, beta', kind: 'search', rawInput: 'alpha, beta' },
  )
  const meta = definition.output.presentationMeta({ queries: ['alpha', 'beta'] }, result)
  const view = definition.presentResult({ queries: ['alpha', 'beta'] }, { isError: false, meta })
  assert.equal(view.card, 'web')
  assert.equal(view.kind, 'search')
  assert.equal(view.sources.length, 8)
  assert.equal(view.truncated, true)
  dispose()
})

test('scoped web_search 同批失败会中止仍在执行的兄弟请求', async () => {
  let definition: any
  let siblingAborted = false
  const ctx = scopedContext(async (request, signal) => {
    if (request.query === 'fail') throw new Error('first failure')
    return new Promise((_resolve, reject) => {
      const onAbort = (): void => {
        siblingAborted = true
        reject(new Error('sibling aborted'))
      }
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }, (value) => { definition = value })
  const dispose = installSearchToolReplacementForAgent({ ctx }, () => settings)
  assert.ok(dispose)
  await assert.rejects(() => definition.execute({ queries: ['fail', 'slow'] }, {}), /first failure/)
  assert.equal(siblingAborted, true)
  dispose()
})

test('scoped 注册后 section 失败会回滚已注册工具', () => {
  let toolDisposed = 0
  const ctx = scopedContext(
    async () => ({ sources: [], truncated: false }),
    undefined,
    () => { toolDisposed++ },
    () => { throw new Error('section failed') },
  )
  assert.throws(
    () => installSearchToolReplacementForAgent({ ctx }, () => settings),
    /section failed/,
  )
  assert.equal(toolDisposed, 1)
})
