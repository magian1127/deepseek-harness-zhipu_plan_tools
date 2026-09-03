/**
 * web_search 工具与说明的 Agent 作用域阴影。在 Agent 自身作用域注册
 * 同名工具与 tool:web_search section,替换全局 tool-web 的模型可见表面。
 * index.ts 负责确认原工具在该 Agent 的继承视图中可见,避免突破 preset
 * 的隐藏策略。
 */
import type { Disposer, HostContext } from './types.js'
import type { ZhipuSettings } from './settings-schema.js'
import type { SettingsGetter } from './zhipu-search.js'
import { registerWithTakeover } from './registration.js'
import { escapeMarkdownLinkText, foldExternalInlineText, sanitizeExternalUrl } from './util.js'

const SEARCH_MAX_QUERIES = 4
const SEARCH_MAX_RESULTS = 8
const SEARCH_TIMEOUT_MS = 30_000

interface WebSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

interface SearchResult {
  content?: string
  sources: ReadonlyArray<WebSource>
  truncated: boolean
}

interface AgentLike {
  ctx: HostContext
}

interface ScopeTools {
  register(definition: unknown): Disposer
}

interface ScopeWeb {
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<SearchResult>
}

interface Localized {
  en: string
  zh: string
}

const WEB_SEARCH_TOOL_DESC: Localized = {
  en: 'Search the web for up-to-date information through Zhipu. Provide 1–4 focused queries in the required queries array; returns an optional summary answer plus a list of source URLs. Zhipu applies sensitive-result filtering, so search queries should not be overly broad and need precise wording.',
  zh: '通过智谱搜索获取网络信息。在必填的 queries 数组中提供 1–4 条聚焦的查询; 返回可选的摘要回答和来源 URL 列表。智谱会有敏感结果过滤, 搜索条不应过于宽泛, 需要精确描述。',
}

const QUERIES_PARAM_DESC: Localized = {
  en: 'Required search queries; accepts 1–4 items and merges their results.',
  zh: '必填搜索查询;接受 1–4 条并合并结果。',
}

const WEB_SEARCH_SECTION: Localized = {
  en: 'Use the web_search tool to search the web through Zhipu. Provide 1–4 focused queries in the required queries array; Zhipu applies sensitive-result filtering, so before searching, narrow each query to a clear, verifiable goal — name the entity or topic, the event or metric to look up, and any necessary time, region, version, or source limits. Avoid broad, open-ended queries and do not merge unrelated questions into one search. Run an initial search first, then iterate with more specific follow-up queries based on the results, and interpret the returned sources yourself. Keep the user\'s intent intact: add only necessary qualifiers. Cite the relevant URLs as markdown links.',
  zh: '使用 web_search 工具通过智谱进行网络搜索。在必填的 queries 数组中提供 1–4 条聚焦的查询; 智谱会有敏感结果过滤, 搜索前, 将每条查询收窄为明确、可验证的目标, 注明实体或主题、待查事件或指标, 以及必要的时间、地区、版本或来源限定。避免泛化、无边界查询, 也不要将无关问题合并。先进行初步搜索, 再根据结果用更具体的查询迭代，并自行解读返回来源。保留用户原意, 只补充必要限定。引用相关 URL 时使用 Markdown 链接。',
}

function pick(localized: Localized, settings: ZhipuSettings): string {
  return settings.zhPrompt ? localized.zh : localized.en
}

/** 对齐内置 tool-web:拒绝越界/空查询,并按首次出现顺序去重。 */
function parseQueries(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('queries must contain at least one query')
  }
  if (value.length > SEARCH_MAX_QUERIES) {
    throw new Error(`queries must contain at most ${SEARCH_MAX_QUERIES} queries`)
  }
  if (value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error('each query must be a non-empty string')
  }
  return [...new Set(value.map((item) => (item as string).trim()))]
}

/** 对齐内置 tool-web:按 rank 轮询合并、URL 去重并限制总来源数。 */
function mergeSources(results: ReadonlyArray<SearchResult>, queries: string[]): SearchResult {
  const seen = new Set<string>()
  const sources: WebSource[] = []
  const ranks = Math.max(0, ...results.map((result) => result.sources.length))
  let dropped = false

  merge: for (let rank = 0; rank < ranks; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source === undefined) continue
      const url = String(source.url ?? '').trim()
      if (url.length === 0 || seen.has(url)) continue
      seen.add(url)
      if (sources.length === SEARCH_MAX_RESULTS) {
        dropped = true
        break merge
      }
      sources.push(source)
    }
  }

  const contents = results.flatMap((result, index) => {
    if (result.content === undefined || result.content.length === 0) return []
    return [`### ${queries[index] ?? ''}\n\n${result.content}`]
  })
  return {
    ...contents.length > 0 ? { content: contents.join('\n\n') } : {},
    sources,
    truncated: dropped || results.some((result) => result.truncated),
  }
}

/** 多查询任一失败时取消同批兄弟请求,等待全部 settle 后抛首个错误。 */
async function runQueries(web: ScopeWeb, queries: string[], signal?: AbortSignal): Promise<SearchResult> {
  if (queries.length === 1) {
    return web.search({ query: queries[0] as string, maxResults: SEARCH_MAX_RESULTS }, signal)
  }

  const controller = new AbortController()
  const batchSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  const results: SearchResult[] = []
  let firstFailure: { error: unknown } | undefined
  const searches = queries.map(async (query, index) => {
    try {
      results[index] = await web.search({ query, maxResults: SEARCH_MAX_RESULTS }, batchSignal)
    } catch (error: unknown) {
      if (firstFailure === undefined) firstFailure = { error }
      controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(searches)
  if (firstFailure !== undefined) throw firstFailure.error
  return mergeSources(results, queries)
}

function disposeAll(disposers: Array<Disposer>): void {
  for (const dispose of disposers.splice(0).reverse()) {
    try { dispose() } catch { /* 清理其余注册。 */ }
  }
}

interface SearchMeta {
  sources: WebSource[]
  truncated: boolean
  answer?: string
}

function displayQueries(args: unknown): string[] {
  const value = (args as { queries?: unknown } | null | undefined)?.queries
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function projectMeta(value: SearchResult): SearchMeta {
  return {
    sources: value.sources.map((source) => ({
      url: source.url,
      ...source.title !== undefined ? { title: source.title } : {},
      ...source.snippet !== undefined ? { snippet: source.snippet } : {},
      ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
    })),
    truncated: value.truncated,
    ...value.content !== undefined ? { answer: value.content } : {},
  }
}

function isWebSource(value: unknown): value is WebSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { url, title, snippet, publishedAt } = value as Record<string, unknown>
  return typeof url === 'string'
    && (title === undefined || typeof title === 'string')
    && (snippet === undefined || typeof snippet === 'string')
    && (publishedAt === undefined || typeof publishedAt === 'string')
}

function parseMeta(value: unknown): SearchMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { sources, truncated, answer } = value as Record<string, unknown>
  if (!Array.isArray(sources) || !sources.every(isWebSource) || typeof truncated !== 'boolean') return undefined
  if (answer !== undefined && typeof answer !== 'string') return undefined
  return { sources, truncated, ...answer !== undefined ? { answer } : {} }
}

/** 在单个 Agent 作用域注册 web_search 工具与说明。 */
export function installSearchToolReplacementForAgent(
  agent: AgentLike,
  getSettings: SettingsGetter,
): Disposer | undefined {
  const scopedCtx = agent.ctx
  const tools = scopedCtx.get('tools') as ScopeTools | undefined | null
  const web = scopedCtx.get('web') as ScopeWeb | undefined | null
  const systemPrompt = scopedCtx.get('systemPrompt') as
    | { section(section: { name: string; order?: number; text: string | ((context: unknown) => string) }): Disposer }
    | undefined
    | null
  if (tools === undefined || tools === null || web === undefined || web === null) return undefined

  const disposers: Disposer[] = []
  const settingsSnapshot = getSettings()
  const definition = {
    name: 'web_search',
    description: pick(WEB_SEARCH_TOOL_DESC, settingsSnapshot),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['queries'],
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: pick(QUERIES_PARAM_DESC, settingsSnapshot),
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sources', 'truncated'],
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['url'],
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: formatResult(value) }],
      presentationMeta: (_args: unknown, value: SearchResult) => projectMeta(value),
    },
    timeoutMs: SEARCH_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args: unknown) => {
      const queries = displayQueries(args)
      if (queries.length === 0) return undefined
      const title = queries.join(', ')
      return { card: 'generic', title, kind: 'search', rawInput: title }
    },
    presentResult: (args: unknown, result: unknown) => {
      const record = result as { isError?: unknown; meta?: unknown } | null | undefined
      if (record?.isError === true) return undefined
      const meta = parseMeta(record?.meta)
      if (meta === undefined) return undefined
      const title = displayQueries(args).join(', ') || 'Web search'
      return {
        card: 'web',
        kind: 'search',
        title,
        sources: meta.sources,
        truncated: meta.truncated,
        ...meta.answer !== undefined ? { answer: meta.answer } : {},
      }
    },
    async execute(args: unknown, exec: { signal?: AbortSignal }) {
      const queries = parseQueries((args as Record<string, unknown> | undefined)?.queries)
      return runQueries(web, queries, exec.signal)
    },
  }

  disposers.push(registerWithTakeover(
    () => tools.register(definition),
    'tool:web_search',
  ))

  try {

    if (systemPrompt !== undefined && systemPrompt !== null) {
      disposers.push(systemPrompt.section({
        name: 'tool:web_search',
        order: 110,
        text: () => pick(WEB_SEARCH_SECTION, getSettings()),
      }))
    }
  } catch (error: unknown) {
    disposeAll(disposers)
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    disposeAll(disposers)
  }
}

/** 结果渲染沿用内置工具的信息结构；外部 title/snippet/URL 经不可信内容净化（V11）。 */
function formatResult(value: unknown): string {
  const result = value as SearchResult | null | undefined
  if (result === null || result === undefined) return ''
  const parts: string[] = []
  if (typeof result.content === 'string' && result.content.length > 0) parts.push(result.content)
  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const title = typeof source.title === 'string' && source.title.length > 0 ? source.title : source.url
      const meta = [source.snippet, source.publishedAt === undefined ? undefined : `(${source.publishedAt})`]
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .map((item) => foldExternalInlineText(item))
      const safeUrl = sanitizeExternalUrl(String(source.url ?? ''))
      const safeTitle = escapeMarkdownLinkText(String(title ?? ''))
      // URL 未过白名单（非 http(s)/含控制字符/结构异常）时退化为纯文本，不构造可点击链接。
      const link = safeUrl === null ? safeTitle : `[${safeTitle}](${safeUrl})`
      return `- ${link}${meta.length > 0 ? ` — ${meta.join(' ')}` : ''}`
    })
    parts.push(`Sources:\n${lines.join('\n')}`)
  } else if (result.content === undefined || result.content.length === 0) {
    parts.push('No results found.')
  }
  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources. Refine the query for more.)`)
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}
