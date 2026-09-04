/**
 * 智谱联网搜索 searchProvider —— 注册到 `ctx.web` 的搜索后端。
 *
 * 移植自 deepseek-harness-ZhiPu_web_search 已修复版本(dshHome 回退 +
 * 幂等注册),curl 子进程换 Node 全局 fetch(mcp-http 共用客户端)。
 * 并接入设置:enabled/search 开启走智谱,关闭后透明回退内置 DeepSeek
 * 搜索(deepseek-fallback 直连),不再报后端不可用。
 */
import { SEARCH_MCP_URL, SEARCH_PROVIDER_ID } from './constants.js'
import { credentialResolvable, resolveApiKey } from './credentials.js'
import { deepseekFallbackAvailable, deepseekSearch } from './deepseek-fallback.js'
import { WEB_PROVIDER_ERROR_CODE, ZHIPU_CONTENT_FILTERED_CODE, ZhipuError, isAbortError } from './errors.js'
import { callMcpTool, contentText } from './mcp-http.js'
import type { Disposer, HostContext, WebSearchProviderShape, WebService } from './types.js'
import type { ZhipuSettings } from './settings-schema.js'
import { parseMaybeDoubleEncoded } from './util.js'
import { registerWithTakeover } from './registration.js'

/** 设置读取器:总是读最新快照(原子替换,无锁)。 */
export type SettingsGetter = () => ZhipuSettings

/** web_search_prime 条目的最小形状。 */
interface SearchItem {
  link?: unknown
  title?: unknown
  content?: unknown
  publishedAt?: unknown
}

/**
 * 注册智谱搜索 provider。幂等:同 id 已注册(双行并存)时跳过,
 * 由已注册实例承担功能。
 * @returns 卸载函数;web 服务缺失时返回 undefined。
 */
export function installZhipuSearchProvider(ctx: HostContext, getSettings: SettingsGetter): Disposer | undefined {
  const web = ctx.get('web') as WebService | undefined | null
  if (web === undefined || web === null) return undefined

  const provider: WebSearchProviderShape = {
    id: SEARCH_PROVIDER_ID,
    available(): boolean {
      // Web seam 要求 available() 同步且不得网络请求。开启态看智谱凭据;
      // 关闭态看内置 DeepSeek 凭据(回退模式仍被选中,由 search() 分流)。
      const settings = getSettings()
      const zhipu = settings.enabled && settings.search
      return zhipu ? credentialResolvable(ctx, settings.credentialRef) : deepseekFallbackAvailable(ctx)
    },
    async search(request, signal) {
      const query = String(request.query ?? '').trim()
      if (query.length === 0) throw new Error('query must be a non-empty string')

      const settings = getSettings()
      if (!(settings.enabled && settings.search)) {
        // 回退模式:内置 DeepSeek 搜索直连(不改写查询)。
        return deepseekSearch(ctx, query, signal)
      }
      const apiKey = await resolveApiKey(ctx, settings.credentialRef, 'web', signal)

      let result: any
      try {
        result = await callMcpTool(SEARCH_MCP_URL, apiKey, 'web_search_prime', { search_query: query }, signal)
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw error
        if (error instanceof ZhipuError && error.code === ZHIPU_CONTENT_FILTERED_CODE) throw error
        throw new ZhipuError(
            `[${WEB_PROVIDER_ERROR_CODE}] 智谱搜索请求失败 (${SEARCH_MCP_URL}): ${error instanceof Error ? error.message : String(error)}`,
          WEB_PROVIDER_ERROR_CODE,
          { cause: error },
        )
      }

      // content 是 JSON 字符串(可能双层编码),剥出条目数组。
      const items = parseMaybeDoubleEncoded(contentText(result))
      if (!Array.isArray(items)) {
        throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 智谱搜索结果格式异常`, WEB_PROVIDER_ERROR_CODE)
      }

      const sources = (items as SearchItem[])
        .map((it) => {
          const url = typeof it.link === 'string' ? it.link : ''
          return {
            url,
            ...(typeof it.title === 'string' && it.title.length > 0 ? { title: it.title } : {}),
            ...(typeof it.content === 'string' && it.content.length > 0 ? { snippet: it.content } : {}),
            ...(typeof it.publishedAt === 'string' && it.publishedAt.length > 0 ? { publishedAt: it.publishedAt } : {}),
          }
        })
          .filter((s) => s.url.length > 0)
        // 上游 web_search_prime 无结果条数参数(schema 实测,additionalProperties:false),
        // 超量返回固定发生;按 request.maxResults 预裁剪,使 seam 的 capSources 不触发
        // (truncated 语义限定为 seam 丢弃来源,provider 预裁剪时 seam 无丢弃,报告 false)。
        // 被裁来源本就不会进入模型视野,无信息损失;对齐官方 Exa provider 的做法。
        const cap = typeof request.maxResults === 'number' && request.maxResults > 0
          ? request.maxResults
          : undefined
        const capped = cap !== undefined && sources.length > cap ? sources.slice(0, cap) : sources
        return { sources: capped, truncated: false }
    },
  }

  const dispose = registerWithTakeover(
    () => web.registerSearchProvider(provider),
    `web-search-provider:${SEARCH_PROVIDER_ID}`,
  )
  return () => { dispose() }
}
