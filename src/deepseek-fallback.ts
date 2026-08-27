/**
 * 内置 DeepSeek 搜索回退 —— 直连 DeepSeek Anthropic-compatible Messages
 * 端点,复用上游 web-search-deepseek 的线上格式:
 *   POST {base}/messages + tools: [web_search_20250305]
 * 从 web_search_tool_result 块提取结果条目,并用 text 块 citations 补
 * snippet(上游 citationSnippets 同款规则:url → cited_text,首见为准)。
 *
 * 用途:设置里关闭智谱搜索后,搜索透明回退到内置 DeepSeek 搜索,
 * 不再报"后端不可用"(configuredId 被 patch 静态 pin 死,web seam 不会
 * 因 available=false 回退内置,见 docs/architecture.md 修复决策)。
 *
 * 凭据:复用内置搜索的 DEEPSEEK_API_KEY(与内置 provider 同一 key,
 * 注意不是 DEEPSEEK_BASE_URL —— 搜索走 Anthropic 格式端点)。
 */
import { DEEPSEEK_FALLBACK_API_KEY_ENV, DEEPSEEK_FALLBACK_API_VERSION, DEEPSEEK_FALLBACK_BASE_URL, DEEPSEEK_FALLBACK_MAX_TOKENS, DEEPSEEK_FALLBACK_MAX_USES, DEEPSEEK_FALLBACK_MODEL, DEEPSEEK_FALLBACK_TIMEOUT_MS } from './constants.js'
import { credentialResolvable, resolveApiKey } from './credentials.js'
import { WEB_PROVIDER_ERROR_CODE, ZhipuError, abortedError, isAbortError } from './errors.js'
import type { HostContext } from './types.js'

/** Messages 响应里 web_search_tool_result 块的最小形状。 */
interface WebSearchToolResultBlock {
  type: 'web_search_tool_result'
  content?: ReadonlyArray<{
    type?: string
    url?: string
    title?: string
    page_age?: string
  }>
}

/** 经函数读取,避免 TypeScript 把 AbortSignal 的可变状态跨 await 永久收窄。 */
function wasAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
}

/** url → cited_text 映射(首见为准),畸形 citation 只跳过不泄漏 TypeError。 */
export function citationSnippets(blocks: ReadonlyArray<unknown>): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null || (block as { type?: unknown }).type !== 'text') continue
    const citations = (block as { citations?: unknown }).citations
    if (!Array.isArray(citations)) continue
    for (const cite of citations) {
      if (typeof cite !== 'object' || cite === null) continue
      const url = (cite as { url?: unknown }).url
      const text = (cite as { cited_text?: unknown }).cited_text
      if (typeof url === 'string' && url.length > 0 && typeof text === 'string' && text.length > 0 && !map.has(url)) {
        map.set(url, text)
      }
    }
  }
  return map
}

/**
 * 执行一次内置 DeepSeek 搜索。返回与 web seam 一致的搜索结果形状。
 * @throws ZhipuError(WEB_PROVIDER_*):凭据缺失、请求失败或结果格式异常。
 */
async function deepseekSearchOnce(ctx: HostContext, query: string, signal?: AbortSignal): Promise<{
  sources: ReadonlyArray<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
  truncated: boolean
}> {
  const apiKey = await resolveApiKey(ctx, DEEPSEEK_FALLBACK_API_KEY_ENV, 'web', signal)
  if (wasAborted(signal)) throw abortedError('web', signal)
  const endpoint = `${DEEPSEEK_FALLBACK_BASE_URL}/messages`
  const body = {
    model: DEEPSEEK_FALLBACK_MODEL,
    max_tokens: DEEPSEEK_FALLBACK_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: DEEPSEEK_FALLBACK_MAX_USES }],
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        'authorization': `Bearer ${apiKey}`,
        'anthropic-version': DEEPSEEK_FALLBACK_API_VERSION,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    if (wasAborted(signal) || isAbortError(error)) throw error
    throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 内置 DeepSeek 搜索请求失败: ${error instanceof Error ? error.message : String(error)}`, WEB_PROVIDER_ERROR_CODE, { cause: error })
  }

  if (!response.ok) {
    const status = response.status
    let message = `DeepSeek API error (HTTP ${status})`
    try {
      const parsed = await response.json() as { error?: unknown; message?: unknown }
      const errorDetail = parsed.error
      const detail = typeof errorDetail === 'string' ? errorDetail
        : (errorDetail as { message?: unknown } | null | undefined)?.message
      if (typeof detail === 'string' && detail.length > 0) message = detail
      else if (typeof parsed.message === 'string' && parsed.message.length > 0) message = parsed.message
    } catch (error: unknown) {
      if (wasAborted(signal) || isAbortError(error)) throw error
      // 非 JSON 错误体(网关 5xx/429):保留 HTTP 状态信息。
    }
    throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] ${message}`, WEB_PROVIDER_ERROR_CODE)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error: unknown) {
    if (wasAborted(signal) || isAbortError(error)) throw error
    throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 内置 DeepSeek 搜索返回不可解析的响应体: ${error instanceof Error ? error.message : String(error)}`, WEB_PROVIDER_ERROR_CODE, { cause: error })
  }

  const content = typeof payload === 'object' && payload !== null
    ? (payload as { content?: unknown }).content
    : undefined
  if (!Array.isArray(content)) {
    throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] DeepSeek 响应缺少 content 数组`, WEB_PROVIDER_ERROR_CODE)
  }
  const blocks = content.filter((block): block is { type?: string } => typeof block === 'object' && block !== null)
  const resultBlocks = blocks.filter((block): block is WebSearchToolResultBlock => block.type === 'web_search_tool_result')
  if (resultBlocks.length === 0) {
    throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] DeepSeek 未返回 web_search_tool_result 块,请求可能未触发原生搜索`, WEB_PROVIDER_ERROR_CODE)
  }

  const snippets = citationSnippets(blocks)
  const seen = new Set<string>()
  const sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }> = []
  for (const block of resultBlocks) {
    const items = Array.isArray(block.content) ? block.content : []
    for (const item of items) {
      if (item === null || typeof item !== 'object' || item.type !== 'web_search_result') continue
      const url = typeof item.url === 'string' ? item.url : ''
      if (url.length === 0 || seen.has(url)) continue
      seen.add(url)
      const snippet = snippets.get(url)
      sources.push({
        url,
        ...(typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
        ...(snippet !== undefined && snippet.length > 0 ? { snippet } : {}),
        ...(typeof item.page_age === 'string' && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}),
      })
    }
  }
  return { sources, truncated: false }
}

/** 给直接 provider 调用提供独立的网络超时,不依赖外层 tool policy。 */
export async function deepseekSearch(ctx: HostContext, query: string, signal?: AbortSignal): Promise<{
  sources: ReadonlyArray<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
  truncated: boolean
}> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, DEEPSEEK_FALLBACK_TIMEOUT_MS)
  const onOuterAbort = (): void => { controller.abort(signal?.reason) }
  if (signal?.aborted === true) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    return await deepseekSearchOnce(ctx, query, controller.signal)
  } catch (error: unknown) {
    if (signal?.aborted === true) throw abortedError('web', signal, error)
    if (timedOut) {
      throw new ZhipuError(
        `[${WEB_PROVIDER_ERROR_CODE}] 内置 DeepSeek 搜索超过 ${DEEPSEEK_FALLBACK_TIMEOUT_MS}ms`,
        WEB_PROVIDER_ERROR_CODE,
        { cause: error },
      )
    }
    if (error instanceof ZhipuError) throw error
    if (isAbortError(error)) throw abortedError('web', controller.signal, error)
    throw new ZhipuError(
      `[${WEB_PROVIDER_ERROR_CODE}] 内置 DeepSeek 搜索请求失败: ${error instanceof Error ? error.message : String(error)}`,
      WEB_PROVIDER_ERROR_CODE,
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 内置搜索回退可用性:本地凭据已知存在,或 credentials 服务可在执行时解析。
 * available() 保持同步且不发网络请求;真正缺失时由 search() 返回稳定错误码。
 */
export function deepseekFallbackAvailable(ctx?: HostContext): boolean {
  return credentialResolvable(ctx, DEEPSEEK_FALLBACK_API_KEY_ENV)
}
