/**
 * 智谱联网搜索 searchProvider —— 注册到 `ctx.web` 的搜索后端。
 *
 * 移植自 deepseek-harness-ZhiPu_web_search 已修复版本(dshHome 回退 +
 * 幂等注册),curl 子进程换 Node 全局 fetch(mcp-http 共用客户端),
 * 并接入设置:enabled/search 停用语义(available false;真正回退内置
 * 需删 patch 行,README 写明)。
 */
import { SEARCH_MCP_URL, SEARCH_PROVIDER_ID } from './constants.js'
import { credentialAvailable, resolveApiKey } from './credentials.js'
import { WEB_PROVIDER_CREDENTIAL_MISSING_CODE, WEB_PROVIDER_ERROR_CODE, ZhipuError, isAbortError } from './errors.js'
import { callMcpTool, contentText } from './mcp-http.js'
import type { Disposer, HostContext, WebSearchProviderShape, WebService } from './types.js'
import type { ZhipuSettings } from './settings-schema.js'
import { parseMaybeDoubleEncoded } from './util.js'

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
      // 本地存在性检查,不发网络请求:设置开启且凭据本地可见才可用。
      const settings = getSettings()
      return settings.enabled && settings.search && credentialAvailable(settings.credentialRef)
    },
    async search(request, signal) {
      const query = String(request.query ?? '').trim()
      if (query.length === 0) throw new Error('query must be a non-empty string')

      const settings = getSettings()
      const apiKey = await resolveApiKey(ctx, settings.credentialRef, 'web', signal)

      let result: any
      try {
        result = await callMcpTool(SEARCH_MCP_URL, apiKey, 'web_search_prime', { search_query: query }, signal)
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw error
        throw error instanceof ZhipuError
          ? error
          : new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 智谱搜索请求失败: ${error instanceof Error ? error.message : String(error)}`, WEB_PROVIDER_ERROR_CODE, { cause: error })
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
      // maxResults 由 web seam 统一截断,provider 不重复裁剪。
      return { sources, truncated: false }
    },
  }

  const dispose = (() => {
    try {
      return web.registerSearchProvider(provider)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already registered/i.test(message)) return () => {}
      throw error
    }
  })()
  return () => { dispose() }
}

// 供 reader 复用的错误码再导出(保持模块自洽)。
export { WEB_PROVIDER_CREDENTIAL_MISSING_CODE }
