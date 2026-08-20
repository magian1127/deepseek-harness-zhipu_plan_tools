/**
 * 智谱网页读取 fetchProvider —— 注册到 `ctx.web` 的抓取后端。
 *
 * webReader 返回 markdown 正文(双层 JSON 编码:content 字符串 → parse
 * 两次),映射为 WebFetchResult{ body: { kind: 'text' } } —— text kind 在
 * 官方 web_fetch 工具层直通,不再本地 turndown 转换,质量优于内置 http
 * provider。
 *
 * 跟随部署开关:DSH 预设 tool-web 行默认 fetch: false,本 provider 注册
 * 但无感知;部署启用 fetch 后自动接管(见 cordis.patch.yml 注释)。
 */
import { READER_FETCH_TIMEOUT_SECONDS, READER_MAX_CONTENT_CHARS, READER_MCP_URL, READER_PROVIDER_ID } from './constants.js'
import { credentialAvailable, resolveApiKey } from './credentials.js'
import { WEB_PROVIDER_ERROR_CODE, ZhipuError, isAbortError } from './errors.js'
import { callMcpTool, contentText } from './mcp-http.js'
import type { Disposer, HostContext, WebFetchProviderShape, WebService } from './types.js'
import type { ZhipuSettings } from './settings-schema.js'
import type { SettingsGetter } from './zhipu-search.js'
import { parseMaybeDoubleEncoded } from './util.js'

/** webReader 结果的最小形状(实测:双层 JSON 编码字符串剥出后)。 */
interface ReaderPayload {
  title?: unknown
  url?: unknown
  content?: unknown
}

/** 读取正文截断上限(对齐 tool-web 的 DEFAULT_FETCH_MAX_OUTPUT_CHARS)。 */
function clampContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= READER_MAX_CONTENT_CHARS) return { content, truncated: false }
  return { content: content.slice(0, READER_MAX_CONTENT_CHARS), truncated: true }
}

/**
 * 注册智谱网页读取 provider。幂等:同 id 已注册时跳过。
 * @returns 卸载函数;web 服务缺失时返回 undefined。
 */
export function installZhipuReaderProvider(ctx: HostContext, getSettings: SettingsGetter): Disposer | undefined {
  const web = ctx.get('web') as WebService | undefined | null
  if (web === undefined || web === null) return undefined

  const provider: WebFetchProviderShape = {
    id: READER_PROVIDER_ID,
    available(): boolean {
      const settings = getSettings()
      return settings.enabled && settings.reader && credentialAvailable(settings.credentialRef)
    },
    async fetch(request, signal) {
      const url = String(request.url ?? '').trim()
      if (url.length === 0) throw new Error('url must be a non-empty string')

      const settings = getSettings()
      const apiKey = await resolveApiKey(ctx, settings.credentialRef, 'web', signal)

      let result: any
      try {
        result = await callMcpTool(
          READER_MCP_URL, apiKey, 'webReader',
          {
            url,
            return_format: 'markdown',
            retain_images: false,
            timeout: READER_FETCH_TIMEOUT_SECONDS,
          },
          signal,
        )
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw error
        throw error instanceof ZhipuError
          ? error
          : new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 智谱网页读取请求失败: ${error instanceof Error ? error.message : String(error)}`, WEB_PROVIDER_ERROR_CODE, { cause: error })
      }

      // content 为 JSON 字符串(实测双层编码),剥出 {title,url,content}。
      const payload = parseMaybeDoubleEncoded(contentText(result)) as ReaderPayload | string
      if (typeof payload !== 'object' || payload === null) {
        throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 智谱网页读取结果格式异常`, WEB_PROVIDER_ERROR_CODE)
      }
      const rawContent = typeof payload.content === 'string' ? payload.content : ''
      if (rawContent.length === 0) {
        throw new ZhipuError(`[${WEB_PROVIDER_ERROR_CODE}] 智谱网页读取返回空正文: ${url}`, WEB_PROVIDER_ERROR_CODE)
      }

      const { content, truncated } = clampContent(rawContent)
      const finalUrl = typeof payload.url === 'string' && payload.url.length > 0 ? payload.url : url
      // webReader 的失败以 MCP error 上报;成功即资源可读,HTTP 状态固定 200。
      return {
        url: finalUrl,
        statusCode: 200,
        body: { kind: 'text', content },
        truncated,
      }
    },
  }

  const dispose = (() => {
    try {
      return web.registerFetchProvider(provider)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already registered/i.test(message)) return () => {}
      throw error
    }
  })()
  return () => { dispose() }
}
