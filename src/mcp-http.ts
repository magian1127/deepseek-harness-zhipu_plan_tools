/**
 * 智谱 MCP Streamable HTTP 客户端(Node 全局 fetch 实现)。
 *
 * 协议:JSON-RPC over HTTP ——
 *   initialize(响应头带回 Mcp-Session-Id)
 *   → notifications/initialized(fire-and-forget)
 *   → tools/call
 *   → DELETE 终止会话(尽力而为,短超时,abort 后不等待)
 *
 * 三个 remote MCP(search / reader / zread)共用;端点与超时常量见
 * constants.ts。会话不复用:每次 call 完整生命周期,与旧项目一致
 * (多 ~1 RTT 可接受,复用留路线图)。
 */
import { MCP_TERMINATE_TIMEOUT_MS, MCP_TIMEOUT_MS } from './constants.js'
import { ZhipuError, ZHIPU_PROVIDER_ERROR_CODE, isAbortError } from './errors.js'

/** 一次会话的对外接口。 */
export interface McpSession {
  /** 调用一个 MCP 工具,返回 tools/call 的 result 对象(未解包 content)。 */
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any>
  /** 尽力终止会话;不得抛出、不得阻塞主流程。 */
  dispose(): Promise<void>
}

interface HttpOptions {
  /** 单次请求超时(毫秒),默认 60s。 */
  timeoutMs?: number
  /** User-Agent 标识。 */
  userAgent?: string
}

/** 单次 HTTP 请求:组合外部 signal 与本地超时,任一触发即中止;finally 清理。 */
async function request(
  endpoint: string,
  apiKey: string,
  sessionId: string | undefined,
  method: 'POST' | 'DELETE',
  body: string | undefined,
  options: HttpOptions,
  signal?: AbortSignal,
): Promise<{ text: string; sessionId: string | undefined }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? MCP_TIMEOUT_MS)
  const onExternalAbort = (): void => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(sessionId === undefined ? {} : { 'Mcp-Session-Id': sessionId }),
        ...(method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } : {}),
        'User-Agent': options.userAgent ?? 'dsh-zhipu/0.1',
      },
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ZhipuError(
        `[${ZHIPU_PROVIDER_ERROR_CODE}] 智谱 MCP HTTP ${response.status}: ${text.slice(0, 300)}`,
        ZHIPU_PROVIDER_ERROR_CODE,
      )
    }
    const text = await response.text()
    return { text, sessionId: response.headers.get('mcp-session-id') ?? undefined }
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] 智谱 MCP 请求失败: ${message}`, ZHIPU_PROVIDER_ERROR_CODE, { cause: error })
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onExternalAbort)
  }
}

/** 从 SSE 或纯 JSON 文本解析出全部 JSON-RPC 帧。 */
export function parseRpcFrames(text: string): any[] {
  const frames: any[] = []
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      frames.push(JSON.parse(trimmed))
    } catch {
      // 非合法 JSON,继续找 data: 行。
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    try {
      frames.push(JSON.parse(t.slice(5).trim()))
    } catch {
      // 忽略非 JSON 行(心跳/注释)。
    }
  }
  return frames
}

/** 在帧序列中找 id 匹配的响应;找不到时退回第一个带 result/error 的帧。 */
function pickFrame(frames: any[], id: number): any | undefined {
  for (const frame of frames) {
    if (frame !== null && typeof frame === 'object' && frame.id === id) return frame
  }
  return frames.find((frame) => frame !== null && typeof frame === 'object' && (frame.result !== undefined || frame.error !== undefined))
}

/** 校验帧并返回 result;RPC error / isError:true 归类为 provider 错误。 */
function frameResult(frame: any | undefined, context: string): any {
  if (frame === undefined) {
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: 无响应`, ZHIPU_PROVIDER_ERROR_CODE)
  }
  if (frame.error !== undefined) {
    throw new ZhipuError(
      `[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: ${JSON.stringify(frame.error).slice(0, 300)}`,
      ZHIPU_PROVIDER_ERROR_CODE,
    )
  }
  const result = frame.result
  if (result === undefined) {
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: ${JSON.stringify(frame).slice(0, 300)}`, ZHIPU_PROVIDER_ERROR_CODE)
  }
  if (result.isError === true) {
    const blocks = Array.isArray(result.content) ? result.content : []
    const msg = blocks.map((b: any) => (b === null || b === undefined ? '' : String(b.text ?? ''))).filter(Boolean).join(' ')
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: ${msg || '未知错误'}`, ZHIPU_PROVIDER_ERROR_CODE)
  }
  return result
}

/**
 * 建立一次 MCP 会话并返回调用接口。每次 `call` 都走完整生命周期
 * (initialize → initialized → tools/call → DELETE 清理);调用方无需
 * 显式 dispose(接口保留以满足 finally 习惯)。重复 call 各自建新会话。
 */
export async function createMcpSession(
  endpoint: string,
  apiKey: string,
  options: HttpOptions = {},
): Promise<McpSession> {
  return {
    async call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
      // 1) initialize:拿会话 id。
      const initBody = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dsh-zhipu', version: '0.1.0' },
        },
      })
      const init = await request(endpoint, apiKey, undefined, 'POST', initBody, options, signal)
      const sessionId = init.sessionId
      if (sessionId === undefined) {
        throw new ZhipuError(
          `[${ZHIPU_PROVIDER_ERROR_CODE}] 智谱 MCP 初始化失败: ${init.text.slice(0, 300)}`,
          ZHIPU_PROVIDER_ERROR_CODE,
        )
      }

      try {
        // 2) initialized 通知:fire-and-forget,失败由随后的 tools/call 兜底。
        await request(
          endpoint, apiKey, sessionId, 'POST',
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          options, signal,
        ).catch(() => undefined)

        // 3) tools/call。
        const callBody = JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: tool, arguments: args },
        })
        const outcome = await request(endpoint, apiKey, sessionId, 'POST', callBody, options, signal)
        return frameResult(pickFrame(parseRpcFrames(outcome.text), 2), `智谱 MCP ${tool} 调用失败`)
      } finally {
        // 4) DELETE 终止:尽力而为;已中止时不再等待清理(否则推迟中止结果)。
        const aborted = signal !== undefined && signal.aborted
        const cleanup = request(
          endpoint, apiKey, sessionId, 'DELETE', undefined,
          { ...options, timeoutMs: MCP_TERMINATE_TIMEOUT_MS },
        ).then(() => undefined, () => undefined)
        if (aborted) void cleanup
        else await cleanup
      }
    },
    async dispose(): Promise<void> {
      // 会话在每次 call 内自清理;接口保留以满足调用方的 finally 习惯。
    },
  }
}

/**
 * 便捷封装:一次会话一次调用(search/reader/zread 的标准用法),
 * 返回 tools/call 的原始 result(content 解包由调用方决定)。
 */
export async function callMcpTool(
  endpoint: string,
  apiKey: string,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  options: HttpOptions = {},
): Promise<any> {
  const session = await createMcpSession(endpoint, apiKey, options)
  return session.call(tool, args, signal)
}

/** 合并 result.content 的文本块(只取 type 为 text 或无 type 的块,忽略 image 等非文本)。 */
export function contentText(result: any): string {
  const blocks = Array.isArray(result?.content) ? result.content : []
  return blocks
    .filter((b: any) => b !== null && b !== undefined && (b.type === undefined || b.type === 'text'))
    .map((b: any) => String(b.text ?? ''))
    .filter(Boolean)
    .join('\n')
}
