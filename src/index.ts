/**
 * deepseek-harness-zhipu_plan_tools —— host 半边聚合入口。
 *
 * 职责:
 * 1. 注册 search / reader 两个 web provider(常驻,available 联动设置);
 * 2. 按设置动态装卸 3 个 github_* 仓库工具与提示词 section;
 * 3. settings 命名空间 `dsh-zhipu`(applies: live + exposeToClients,
 *    网页设置卡片读写);schemastery 不可用时降级为组合行 config;
 * 4. 自监视热重载(lib 产物变化 → partialReload,改完即生效,不重启);
 * 5. 双行并存(bundle 行 + 热行/桥接行)由幂等注册兜底,单活实例。
 *
 * 热行不做自清理(旧项目实测:patch watcher 生效时删行会触发 re-compose
 * 把自己卸载;不生效时留着也无害)——remove 交给 CLI;重启后冷启动双行
 * 并存同样由幂等保护兜底(沿 ZhiPu_web_search 的已验证策略)。
 */
import { LOCALE_NAMESPACE, PKG, SETTINGS_NAMESPACE } from './constants.js'
import { installSelfHotReload } from './self-hot-reload.js'
import { createSettingsSchema, loadSchemastery, normalizeSettings, type ZhipuSettings } from './settings-schema.js'
import type { Disposer, HostContext, SettingsScopeShape, SystemPromptService, ToolsService } from './types.js'
import { installZhipuReaderProvider } from './zhipu-reader.js'
import { installZhipuSearchProvider } from './zhipu-search.js'
import { installZhipuZreadTools } from './zhipu-zread.js'

export const name = PKG
export const inject = ['web', 'tools', 'systemPrompt', 'settings']

/** github_* 工具的系统提示指引(随 zread 开关与工具同装卸)。 */
const ZREAD_PROMPT_SECTIONS: Array<{ name: string; text: string }> = [
  {
    name: 'tool:github_search_doc',
    text: 'Use the github_search_doc tool to search documentation, issues, and commits of a GitHub repository. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
  },
  {
    name: 'tool:github_get_repo_structure',
    text: 'Use the github_get_repo_structure tool to list a GitHub repository directory structure. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
  },
  {
    name: 'tool:github_read_file',
    text: 'Use the github_read_file tool to read one file in a GitHub repository. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
  },
]

/** web_search 查询编写指引:要求模型先收窄目标,避免提交过于泛化的范围请求。 */
const WEB_SEARCH_QUERY_GUIDANCE = '使用 web_search 前，先把问题收窄为一个明确、可验证的目标。每条查询应尽量包含具体实体或主题、要查的事件/指标，以及必要的时间、地区、版本或来源限定；优先使用少量但有信息量的词。不要直接提交过于泛化或范围过大的查询（例如“AI”“最新新闻”“科技发展”），也不要把多个无关问题拼在一次搜索中。用户要求概览时，按明确主题或类别拆分查询，并为每个查询补充时间范围和关注点；先搜索，再根据结果用更具体的查询迭代。保留用户原意，只补充必要限定，不要把具体问题改写成泛化主题。'

export function apply(ctx: HostContext, config: Record<string, unknown> = {}): void {
  // 基线:组合行 config(归一化);settings 就绪后由 watch 覆盖。
  let current: ZhipuSettings = normalizeSettings(config)

  // 1) providers 常驻注册:available()/调用行为联动最新设置。
  const providerDisposers: Array<() => void> = []
  const searchDispose = installZhipuSearchProvider(ctx, () => current)
  if (searchDispose !== undefined) providerDisposers.push(searchDispose)
  const readerDispose = installZhipuReaderProvider(ctx, () => current)
  if (readerDispose !== undefined) providerDisposers.push(readerDispose)

  // 2) web_search 查询指引与 github_* 工具 + 提示词:按设置动态装卸。
  let toolsDispose: Disposer | undefined
  const promptDisposers: Array<() => void> = []
  const systemPrompt = ctx.get('systemPrompt') as SystemPromptService | undefined | null

  // 搜索查询指引随总开关与 search 接管开关实时装卸,不改写 provider 收到的查询。
  let searchPromptDispose: Disposer | undefined

  function mountSearchGuidance(): void {
    if (searchPromptDispose !== undefined || systemPrompt === undefined || systemPrompt === null) return
    try {
      searchPromptDispose = systemPrompt.section({
        name: 'tool:web_search:query-guidance',
        order: 111,
        text: WEB_SEARCH_QUERY_GUIDANCE,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate|already/i.test(message)) throw error
    }
  }

  function unmountSearchGuidance(): void {
    if (searchPromptDispose === undefined) return
    searchPromptDispose()
    searchPromptDispose = undefined
  }

  function mountZread(): void {
    if (toolsDispose !== undefined) return
    toolsDispose = installZhipuZreadTools(ctx, () => current)
    if (systemPrompt !== undefined && systemPrompt !== null) {
      for (const section of ZREAD_PROMPT_SECTIONS) {
        try {
          promptDisposers.push(systemPrompt.section({ name: section.name, order: 110, text: section.text }))
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          if (!/duplicate|already/i.test(message)) throw error
        }
      }
    }
  }

  function unmountZread(): void {
    if (toolsDispose !== undefined) {
      toolsDispose()
      toolsDispose = undefined
    }
    for (const dispose of promptDisposers.splice(0)) dispose()
  }

  function refresh(): void {
    if (current.enabled && current.search) mountSearchGuidance()
    else unmountSearchGuidance()
    if (current.enabled && current.zread) mountZread()
    else unmountZread()
  }
  refresh()

  // 3) settings 命名空间:注册(live + 客户端可见);watch 驱动刷新。
  const settings = ctx.get('settings') as
    | { register(namespace: string, schema: unknown, options?: Record<string, unknown>): SettingsScopeShape }
    | undefined
    | null
  if (settings !== undefined && settings !== null) {
    const schema = createSettingsSchema(loadSchemastery())
    let scope: SettingsScopeShape | undefined
    if (schema !== null) {
      try {
        scope = settings.register(SETTINGS_NAMESPACE, schema, {
          base: current as unknown as Record<string, unknown>,
          applies: 'live',
          exposeToClients: true,
        })
        // 注册成功后以 schema 填充过的快照为准(默认值齐全)。
        current = normalizeSettings(scope.get())
        refresh()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/duplicate|already/i.test(message)) throw error
        // 双行并存:命名空间已由先到实例注册,本实例沿用组合行 config。
        scope = undefined
      }
    } else {
      console.warn(`[${PKG}] schemastery 不可用(profile 解析失败),设置卡片未注册,按组合行配置工作`)
    }
    if (scope !== undefined) {
      ctx.effect(() => scope!.watch((next) => {
        current = normalizeSettings(next)
        refresh()
      }), `${PKG}: settings watch`)
    }
  }

  // 4) fiber 卸载:清理全部注册(side effects 可逆,AGENTS.md 约束 9)。
  ctx.effect(() => {
    return () => {
      unmountSearchGuidance()
      unmountZread()
      for (const dispose of providerDisposers.splice(0)) dispose()
    }
  }, `${PKG}: fiber teardown`)

  // 5) 自监视热重载:lib/index.js 变化 → partialReload。
  installSelfHotReload(ctx, import.meta.url)

  console.log(`[${PKG}] host 已装配: search=${String(current.search)} reader=${String(current.reader)} zread=${String(current.zread)} (locale ns ${LOCALE_NAMESPACE})`)
}
