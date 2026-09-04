// mcp-http / util 纯函数单测(SSE 帧、双层 JSON、content 合并)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { callMcpTool, contentText, parseRpcFrames } from '../mcp-http.js'
import { parseMaybeDoubleEncoded } from '../util.js'
import { ZHIPU_CONTENT_FILTERED_CODE, ZHIPU_PROVIDER_ERROR_CODE, ZHIPU_REPO_NOT_FOUND_CODE } from '../errors.js'

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

test('MCP isError 工具错误为固定文案且上游文本仅存不可枚举 detail', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call += 1
    if (init?.method === 'DELETE') return new Response('', { status: 200 })
    if (call === 1) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    if (call === 2) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'upstream original failure text' }] } }), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(
      () => callMcpTool('https://example.invalid/mcp', 'test-api-key', 'web_search_prime', { search_query: 'specific topic' }),
      (error: any) => {
        assert.equal(error.code, ZHIPU_PROVIDER_ERROR_CODE)
        assert.match(error.message, /web_search_prime 调用失败: 上游工具返回错误$/)
        assert.doesNotMatch(error.message, /upstream original failure text/)
        const descriptor = Object.getOwnPropertyDescriptor(error, 'detail')
        assert.equal(descriptor?.enumerable, false)
        assert.match(String(descriptor?.value ?? ''), /upstream original failure text/)
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
          // V9 契约：错误消息为固定分类文案，上游原始 message 不再透传（仅存 non-enumerable detail）。
          assert.match(error.message, /web_search_prime 调用失败/)
          assert.doesNotMatch(error.message, /temporary upstream failure/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('MCP 本地超时归类为 provider 错误而不是调用方取消', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    const onAbort = (): void => {
      const error = new Error('aborted by timeout')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })) as typeof fetch
  try {
    await assert.rejects(
      () => callMcpTool(
        'https://example.invalid/mcp',
        'test-api-key',
        'web_search_prime',
        { search_query: 'specific topic' },
        undefined,
        { timeoutMs: 10 },
      ),
      (error: any) => {
        assert.equal(error.code, ZHIPU_PROVIDER_ERROR_CODE)
        assert.match(error.message, /超过 10ms/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('MCP zread repo-not-found 上游错误映射为 ZHIPU_REPO_NOT_FOUND 且随 zhPrompt 切换语言', async () => {
  const originalFetch = globalThis.fetch
  // 实测 zread 上游正文:MCP error -400 双层 JSON,内层 code 1001 / msg "target not found, error: repo not found"。
  const inner = JSON.stringify({ code: 1001, msg: 'target not found, error: repo not found' })
  const upstreamText = `MCP error -400: ${JSON.stringify({ error: { code: '1210', message: inner } })}`

  async function expectRepoNotFound(options: { zhPrompt?: boolean }, message: RegExp): Promise<void> {
    let call = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1
      if (init?.method === 'DELETE') return new Response('', { status: 200 })
      if (call === 1) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
      if (call === 2) return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'test-session' } })
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: upstreamText }] } }), { status: 200 })
    }) as typeof fetch
    try {
      await assert.rejects(
        () => callMcpTool('https://example.invalid/mcp', 'test-api-key', 'search_doc', { repo_name: 'owner/repo', query: 'auth callback' }, undefined, options),
        (error: any) => {
          assert.equal(error.code, ZHIPU_REPO_NOT_FOUND_CODE)
          assert.match(error.message, message)
          assert.doesNotMatch(error.message, /target not found|1210|1001/)
          const descriptor = Object.getOwnPropertyDescriptor(error, 'detail')
          assert.equal(descriptor?.enumerable, false)
          assert.match(String(descriptor?.value ?? ''), /repo not found/)
          return true
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // 默认(不传 zhPrompt,search/reader 现状)与显式 true 均为中文;false 为英文。
  await expectRepoNotFound({}, /^\[ZHIPU_REPO_NOT_FOUND\] 仓库未被智谱收录。请改用其他方式访问 GitHub。$/)
  await expectRepoNotFound({ zhPrompt: true }, /^\[ZHIPU_REPO_NOT_FOUND\] 仓库未被智谱收录。请改用其他方式访问 GitHub。$/)
  await expectRepoNotFound({ zhPrompt: false }, /^\[ZHIPU_REPO_NOT_FOUND\] Repository not indexed by Zhipu\. Use another way to access GitHub\.$/)
})
