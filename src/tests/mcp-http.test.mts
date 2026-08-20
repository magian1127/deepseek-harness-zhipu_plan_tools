// mcp-http / util 纯函数单测(SSE 帧、双层 JSON、content 合并)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { contentText, parseRpcFrames } from '../mcp-http.js'
import { parseMaybeDoubleEncoded } from '../util.js'

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
