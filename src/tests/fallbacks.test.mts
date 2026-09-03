import test from 'node:test'
import assert from 'node:assert/strict'
import { citationSnippets, deepseekFallbackAvailable, deepseekSearch } from '../deepseek-fallback.js'
import { httpFetchFallback } from '../http-fallback.js'
import type { HostContext } from '../types.js'

function credentialContext(): HostContext {
  return {
    get(name: string): unknown {
      if (name === 'credentials') {
        return { resolve: async (ref: string) => ref === 'DEEPSEEK_API_KEY' ? { value: 'test-deepseek-key' } : undefined }
      }
      return undefined
    },
    on: () => () => {},
    effect: () => () => {},
    inject: () => () => {},
  }
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

test('HTTP 回退在网络请求前拒绝显式本机与私网 URL', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    throw new Error('must not fetch')
  }) as typeof fetch
  try {
    for (const url of [
      'http://127.0.0.1/private',
      'http://[::1]/private',
      'http://[::ffff:127.0.0.1]/private',
      'http://[::ffff:0a00:0001]/private',
    ]) {
      await assert.rejects(
        () => httpFetchFallback(url),
        (error: any) => {
          assert.equal(error.code, 'WEB_BLOCKED_URL')
          return true
        },
      )
    }
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTTP 回退拒绝跨源重定向', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('', {
      status: 302,
      headers: { location: 'https://other.example/final' },
    })
  }) as typeof fetch
  try {
    await assert.rejects(
        () => httpFetchFallback('https://example.com/start', undefined, publicLookup),
      (error: any) => {
        assert.equal(error.code, 'WEB_REDIRECT_BLOCKED')
        return true
      },
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTTP 回退保留非 2xx 文本结果并拒绝二进制响应', async () => {
  const originalFetch = globalThis.fetch
  let binary = false
  globalThis.fetch = (async () => binary
    ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })) as typeof fetch
  try {
      const result = await httpFetchFallback('https://example.com/missing', undefined, publicLookup)
    assert.equal(result.statusCode, 404)
    assert.equal(result.body.kind, 'text')
    assert.equal(result.body.content, 'missing')

    binary = true
    await assert.rejects(
        () => httpFetchFallback('https://example.com/file.bin', undefined, publicLookup),
      (error: any) => {
        assert.equal(error.code, 'WEB_UNSUPPORTED_CONTENT_TYPE')
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTTP 回退拒绝 DNS 解析到私网地址', async () => {
  const lookup = async () => [{ address: '10.0.0.8', family: 4 }]
  await assert.rejects(
    () => httpFetchFallback('https://rebind.example.test/', undefined, lookup),
    (error: any) => error.code === 'WEB_BLOCKED_URL' && /rebind\.example\.test/.test(error.message),
  )
})

test('HTTP 回退允许 DNS 解析到公网地址', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch
  try {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
    const result = await httpFetchFallback('https://public.example.test/', undefined, lookup)
    assert.equal(result.body.content, 'ok')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTTP 回退拒绝 DNS 解析失败', async () => {
  const lookup = async () => { throw new Error('NXDOMAIN') }
  await assert.rejects(
    () => httpFetchFallback('https://missing.example.test/', undefined, lookup),
    (error: any) => error.code === 'WEB_BLOCKED_URL' && /missing\.example\.test/.test(error.message),
  )
})

test('DeepSeek citation 映射跳过 null 与畸形条目', () => {
  const snippets = citationSnippets([
    null,
    { type: 'text', citations: [null, { url: null, cited_text: 'bad' }, { url: 'https://example.com/a', cited_text: 'first' }, { url: 'https://example.com/a', cited_text: 'second' }] },
    { type: 'text', citations: {} },
  ])
  assert.deepEqual([...snippets], [['https://example.com/a', 'first']])
})

test('DeepSeek 回退可通过 credentials 服务执行并拒绝畸形 content', async () => {
  const ctx = credentialContext()
  assert.equal(deepseekFallbackAvailable(ctx), true)
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch
  try {
    await assert.rejects(
      () => deepseekSearch(ctx, 'focused query'),
      (error: any) => {
        assert.equal(error.code, 'WEB_PROVIDER_ERROR')
        assert.match(error.message, /content 数组/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
