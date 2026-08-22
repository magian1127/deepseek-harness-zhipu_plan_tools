// mcp-http / util 纯函数单测(SSE 帧、双层 JSON、content 合并)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { callMcpTool, contentText, parseRpcFrames } from '../mcp-http.js'
import { parseMaybeDoubleEncoded } from '../util.js'
import { ZHIPU_CONTENT_FILTERED_CODE, ZHIPU_PROVIDER_ERROR_CODE } from '../errors.js'

test('parseRpcFrames 解析 SSE 帧', () => {
  const sse = ['event:message', 'data:{"jsonrpc":"2.0","id":1,"result":{"a":1}}', '', 'data:not-json', 'data:{"jsonrpc":"2.0","id":2,"result":{"b":2}}'].join('\r\n')
  const frames = parseRpcFrames(sse)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].id, 1)
  assert.equal(frames[1].result.b, 2)
})

test('parseRpcFrames 解析纯 JSON 响应', () => {
  const frames = parseRpcFrames('{"jsonrpc":"2.0","id":1,"result":"ok"}')
  assert.equal(frames.length, 1)
  assert.equal(frames[0].result, 'ok')
})

test('parseRpcFrames 空与非 JSON 输入返回空数组', () => {
  assert.deepEqual(parseRpcFrames(''), [])
  assert.deepEqual(parseRpcFrames('event:ping\n:keepalive'), [])
})

test('contentText 合并文本块并忽略非文本', () => {
  const result = { content: [{ type: 'text', text: 'a' }, { type: 'image', text: 'skip' }, { type: 'text', text: 'b' }, null] }
  assert.equal(contentText(result), 'a\nb')
  assert.equal(contentText(undefined), '')
})

test('parseMaybeDoubleEncoded 剥双层 JSON', () => {
  const inner = JSON.stringify({ title: 't', content: 'c' })
  const double = JSON.stringify(inner)
  assert.deepEqual(parseMaybeDoubleEncoded(double), { title: 't', content: 'c' })
})

test('parseMaybeDoubleEncoded 单层与裸字符串', () => {
  assert.deepEqual(parseMaybeDoubleEncoded('{"a":1}'), { a: 1 })
  assert.equal(parseMaybeDoubleEncoded('plain text'), 'plain text')
  // 单层 JSON 字符串(内层不是 JSON)保持字符串。
  assert.equal(parseMaybeDoubleEncoded(JSON.stringify('just a string')), 'just a string')
})


test('MCP 内容过滤错误使用固定短提示', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call += 1
    const method = init?.method
    if (method === 'DELETE') return new Response('', { status: 200 })
    if (call === 1) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    if (call === 2) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    return new Response(JSON.stringify({ contentFilter: [{ level: 1, role: 'search' }], error: { code: 1301, message: 'system detected broad query' } }), { status: 400 })
  }) as typeof fetch
  try {
    await assert.rejects(
      () => callMcpTool('https://example.invalid/mcp', 'test-api-key', 'web_search_prime', { search_query: 'latest news' }),
      (error: any) => {
        assert.equal(error.code, ZHIPU_CONTENT_FILTERED_CODE)
        assert.equal(error.message, '[ZHIPU_CONTENT_FILTERED] 智谱查询到敏感词拒绝本次输出。搜索范围不要过于泛化，将请求收窄为一个明确的目标，补充具体实体、时间、地区、指标或来源，用客观、精确的查询重试。')
        assert.doesNotMatch(error.message, /system detected broad query|test-api-key|latest news/)
        assert.equal(error.name, 'ZhipuError')
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('MCP content 块内容过滤错误同样使用固定短提示', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call += 1
    if (init?.method === 'DELETE') return new Response('', { status: 200 })
    if (call === 1) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    if (call === 2) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { isError: true, contentFilter: [{ role: 'search' }], content: [{ type: 'text', text: 'upstream original message' }] } }), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(
      () => callMcpTool('https://example.invalid/mcp', 'test-api-key', 'web_search_prime', { search_query: 'latest news' }),
      (error: any) => {
        assert.equal(error.code, ZHIPU_CONTENT_FILTERED_CODE)
        assert.equal(error.message, '[ZHIPU_CONTENT_FILTERED] 智谱查询到敏感词拒绝本次输出。搜索范围不要过于泛化，将请求收窄为一个明确的目标，补充具体实体、时间、地区、指标或来源，用客观、精确的查询重试。')
        assert.doesNotMatch(error.message, /upstream original message/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('MCP JSON-RPC 普通错误仍使用 provider 错误码', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call += 1
    if (init?.method === 'DELETE') return new Response('', { status: 200 })
    if (call === 1) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    if (call === 2) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'temporary upstream failure' } }), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(
      () => callMcpTool('https://example.invalid/mcp', 'test-api-key', 'web_search_prime', { search_query: 'specific topic 2026' }),
      (error: any) => {
        assert.equal(error.code, ZHIPU_PROVIDER_ERROR_CODE)
        assert.match(error.message, /temporary upstream failure/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
