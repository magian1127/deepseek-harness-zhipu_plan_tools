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
import { ZhipuError, ZHIPU_CONTENT_FILTERED_CODE, ZHIPU_PROVIDER_ERROR_CODE, ZHIPU_REPO_NOT_FOUND_CODE, isAbortError } from './errors.js'
import { createRequire } from 'node:module'

/** MCP 响应体字节上限:超过即中止读取,防止超大响应内存放大。 */
const MCP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

const requirePkg = createRequire(import.meta.url)
let packageVersionCache: string | undefined

/** 包版本(启动后首次调用读一次 package.json;路径不可达时回退 0.0.0)。 */
function packageVersion(): string {
  if (packageVersionCache !== undefined) return packageVersionCache
  try {
    const manifest = requirePkg('../package.json') as { version?: unknown }
    packageVersionCache = typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : '0.0.0'
  } catch {
    packageVersionCache = '0.0.0'
  }
  return packageVersionCache
}

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
  /** 错误消息语言:false → 英文(zread 按 zhPrompt 设置传入);undefined/true → 中文(search/reader 现状)。 */
  zhPrompt?: boolean
}

/** 检测上游的内容安全拒绝标记。 */
function containsContentFilterMarker(value: unknown): boolean {
  if (typeof value === 'string') return /content[\s_-]?filter/i.test(value)
  if (Array.isArray(value)) return value.some((item) => containsContentFilterMarker(item))
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    /content[\s_-]?filter/i.test(key) || containsContentFilterMarker(nested),
  )
}

/** 内容过滤错误:固定短提示,避免把上游长错误传给模型。 */
function contentFilteredError(): ZhipuError {
  return new ZhipuError(
    `[${ZHIPU_CONTENT_FILTERED_CODE}] 智谱查询到敏感词拒绝本次输出。搜索范围不要过于泛化，将请求收窄为一个明确的目标，补充具体实体、时间、地区、指标或来源，用客观、精确的查询重试。`,
    ZHIPU_CONTENT_FILTERED_CODE,
  )
}
/** 构造不携带上游正文的错误;详细内容仅供本地排障且不可枚举。 */
function upstreamError(message: string, code: string, detail?: string): ZhipuError {
  const error = new ZhipuError(message, code)
  if (detail !== undefined && detail.length > 0) {
    Object.defineProperty(error, 'detail', { value: detail.slice(0, 300), enumerable: false })
  }
  return error
}

/** 流式读取响应体并强制字节上限;超限抛固定文案错误(上游正文不进错误消息)。 */
async function readBodyText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > MCP_MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {})
      throw upstreamError(`[${ZHIPU_PROVIDER_ERROR_CODE}] MCP 响应超过 ${MCP_MAX_RESPONSE_BYTES} 字节上限`, ZHIPU_PROVIDER_ERROR_CODE)
    }
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MCP_MAX_RESPONSE_BYTES) {
        throw upstreamError(`[${ZHIPU_PROVIDER_ERROR_CODE}] MCP 响应超过 ${MCP_MAX_RESPONSE_BYTES} 字节上限`, ZHIPU_PROVIDER_ERROR_CODE)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
  }
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
  const timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = (): void => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
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
      // 错误体同样受 8 MiB 上限:超大错误页不整读进内存。读取失败(非超限)回退空文本,
      // 超限抛出的 ZhipuError 原样穿透,不掩盖为网关错误。
      const text = await readBodyText(response).catch(function (error: unknown) {
        if (error instanceof ZhipuError) throw error
        return ''
      })
      if (containsContentFilterMarker(text)) throw contentFilteredError()
      throw upstreamError(
        `[${ZHIPU_PROVIDER_ERROR_CODE}] MCP gateway error (HTTP ${response.status})`,
        ZHIPU_PROVIDER_ERROR_CODE,
        text,
      )
    }
    const text = await readBodyText(response)
    return { text, sessionId: response.headers.get('mcp-session-id') ?? undefined }
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      if (error instanceof ZhipuError && error.code === ZHIPU_CONTENT_FILTERED_CODE) throw error
      if (timedOut) {
        throw new ZhipuError(
          `[${ZHIPU_PROVIDER_ERROR_CODE}] 智谱 MCP 请求超过 ${timeoutMs}ms`,
          ZHIPU_PROVIDER_ERROR_CODE,
          { cause: error },
        )
      }
      if (isAbortError(error)) throw error
      throw upstreamError(
        `[${ZHIPU_PROVIDER_ERROR_CODE}] MCP gateway request failed`,
        ZHIPU_PROVIDER_ERROR_CODE,
        error instanceof Error ? error.message : String(error),
      )
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

/** 校验帧并返回 result;RPC error / isError:true 归类为 provider 错误(en=英文消息,默认中文)。 */
function frameResult(frame: any | undefined, context: string, en: boolean): any {
function frameResult(frame: any | undefined, context: string): any {
    if (frame === undefined) {
      throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: ${en ? 'no response' : '无响应'}`, ZHIPU_PROVIDER_ERROR_CODE)
    }
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: 无响应`, ZHIPU_PROVIDER_ERROR_CODE)
  }
  if (frame.error !== undefined) {
    if (containsContentFilterMarker(frame.error)) throw contentFilteredError()
      throw upstreamError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}`, ZHIPU_PROVIDER_ERROR_CODE, JSON.stringify(frame.error))
  }
  const result = frame.result
  if (result === undefined) {
    if (containsContentFilterMarker(frame)) throw contentFilteredError()
      throw upstreamError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}`, ZHIPU_PROVIDER_ERROR_CODE, JSON.stringify(frame))
  }
  if (result.isError === true) {
    if (containsContentFilterMarker(result)) throw contentFilteredError()
      const blocks = Array.isArray(result.content) ? result.content : []
      const upstreamText = blocks.map((b: any) => (b === null || b === undefined ? '' : String(b.text ?? ''))).filter(Boolean).join(' ')
      // zread 上游"仓库未收录"错误(实测正文为 MCP error -400 双层 JSON,内层 msg 含
      // "repo not found"):映射为可操作错误码,避免模型把"仓库不存在/未收录"当成
      // 服务故障盲目重试。漏检时安全降级为下方通用 provider 错误。
      if (/repo\s+not\s+found/i.test(upstreamText)) {
        throw upstreamError(
          en
            ? `[${ZHIPU_REPO_NOT_FOUND_CODE}] Repository not indexed by Zhipu. Use another way to access GitHub.`
            : `[${ZHIPU_REPO_NOT_FOUND_CODE}] 仓库未被智谱收录。请改用其他方式访问 GitHub。`,
          ZHIPU_REPO_NOT_FOUND_CODE,
          upstreamText,
        )
      }
      throw upstreamError(`[${ZHIPU_PROVIDER_ERROR_CODE}] ${context}: ${en ? 'upstream tool returned an error' : '上游工具返回错误'}`, ZHIPU_PROVIDER_ERROR_CODE, upstreamText)
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
          clientInfo: { name: 'dsh-zhipu', version: packageVersion() },
        },
      })
      const init = await request(endpoint, apiKey, undefined, 'POST', initBody, options, signal)
      const sessionId = init.sessionId
      if (sessionId === undefined) {
        if (containsContentFilterMarker(init.text)) throw contentFilteredError()
          throw upstreamError(
            `[${ZHIPU_PROVIDER_ERROR_CODE}] MCP gateway initialization failed`,
            ZHIPU_PROVIDER_ERROR_CODE,
            init.text,
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
        const frames = parseRpcFrames(outcome.text)
        const frame = pickFrame(frames, 2)
        if (frame === undefined && containsContentFilterMarker(outcome.text)) throw contentFilteredError()
          return frameResult(frame, options.zhPrompt === false ? `Zhipu MCP ${tool} call failed` : `智谱 MCP ${tool} 调用失败`, options.zhPrompt === false)
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
