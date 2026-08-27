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
import { installSearchToolReplacementForAgent } from './search-tool.js'
import { installZhipuReaderProvider } from './zhipu-reader.js'
import { installZhipuSearchProvider } from './zhipu-search.js'
import { installZhipuZreadTools } from './zhipu-zread.js'

export const name = PKG
export const inject = ['web', 'tools', 'systemPrompt', 'settings', 'agents']

/** github_* 工具的系统提示指引(随 zread 开关与工具同装卸;中英文随 zhPrompt 切换)。 */
const ZREAD_PROMPT_SECTIONS: Array<{ name: string; en: string; zh: string }> = [
  {
    name: 'tool:github_search_doc',
      en: 'Use the github_search_doc tool to search documentation, issues, and commits of a GitHub repository. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
      zh: '使用 github_search_doc 工具搜索 GitHub 仓库的文档、issue 与 commit。repo_name 需传 "owner/repo" 格式(如 "vitejs/vite"),不要传裸仓库名。',
  },
  {
    name: 'tool:github_get_repo_structure',
      en: 'Use the github_get_repo_structure tool to list a GitHub repository directory structure. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
      zh: '使用 github_get_repo_structure 工具查看 GitHub 仓库的目录结构。repo_name 需传 "owner/repo" 格式(如 "vitejs/vite"),不要传裸仓库名。',
  },
  {
    name: 'tool:github_read_file',
      en: 'Use the github_read_file tool to read one file in a GitHub repository. Pass repo_name as "owner/repo" (e.g. "vitejs/vite"), never a bare repo name.',
      zh: '使用 github_read_file 工具读取 GitHub 仓库中的一个文件。repo_name 需传 "owner/repo" 格式(如 "vitejs/vite"),不要传裸仓库名。',
  },
]

export function apply(ctx: HostContext, config: Record<string, unknown> = {}): void {
  // 基线:组合行 config(归一化);settings 就绪后由 watch 覆盖。
  let current: ZhipuSettings = normalizeSettings(config)

  // 1) providers 常驻注册:available()/调用行为联动最新设置。
  const providerDisposers: Array<() => void> = []
  const searchDispose = installZhipuSearchProvider(ctx, () => current)
  if (searchDispose !== undefined) providerDisposers.push(searchDispose)
  const readerDispose = installZhipuReaderProvider(ctx, () => current)
  if (readerDispose !== undefined) providerDisposers.push(readerDispose)

  // 2) web_search 阴影与 github_* 工具/提示词按设置动态装卸。
  let toolsDispose: Disposer | undefined
  const promptDisposers: Array<() => void> = []
  const tools = ctx.get('tools') as ToolsService | undefined | null
  const agents = ctx.get('agents') as { list(): unknown[] } | undefined | null
  const agentReplacements = new Map<unknown, Disposer>()

  function replaceSearchToolFor(agentLike: unknown): void {
    if (!current.enabled || !current.search) return
    // 不突破 preset 的隐藏策略:只有继承视图里原 web_search 可见时才阴影。
    if (tools === undefined || tools === null || typeof tools.get !== 'function') return
    if (tools.get('web_search', agentLike) === undefined) return

    const previous = agentReplacements.get(agentLike)
    if (previous !== undefined) {
      try { previous() } catch { /* 继续尝试恢复新注册。 */ }
      agentReplacements.delete(agentLike)
    }
    const disposer = installSearchToolReplacementForAgent(agentLike as { ctx: HostContext }, () => current)
    if (disposer !== undefined) agentReplacements.set(agentLike, disposer)
  }

  function mountSearchToolReplacement(): void {
    if (agents === undefined || agents === null) return
    for (const agent of agents.list()) replaceSearchToolFor(agent)
  }

  function unmountSearchToolReplacement(): void {
    const disposers = [...agentReplacements.values()]
    agentReplacements.clear()
    for (const disposer of disposers.reverse()) {
      try { disposer() } catch { /* 清理其余 Agent 注册。 */ }
    }
  }

  const systemPrompt = ctx.get('systemPrompt') as SystemPromptService | undefined | null

  function mountZread(): void {
    if (toolsDispose !== undefined) return
    toolsDispose = installZhipuZreadTools(ctx, () => current)
    if (systemPrompt !== undefined && systemPrompt !== null) {
      for (const section of ZREAD_PROMPT_SECTIONS) {
        try {
            promptDisposers.push(systemPrompt.section({ name: section.name, order: 110, text: () => current.zhPrompt ? section.zh : section.en }))
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

    // 工具 description 随 zhPrompt 切换,变化时重装 zread 工具(提示词 section
    // 的 text 是函数,不需要重装)。
    let mountedZhPrompt: boolean | undefined
    function refresh(): void {
      if (current.enabled && current.zread) {
        if (mountedZhPrompt !== current.zhPrompt) {
          unmountZread()
          mountZread()
          mountedZhPrompt = current.zhPrompt
        } else {
          mountZread()
        }
      } else {
        unmountZread()
        mountedZhPrompt = undefined
      }
        // web_search 工具替换:随 enabled && search 装卸;mount 自带重装语义。
        if (current.enabled && current.search) mountSearchToolReplacement()
        else unmountSearchToolReplacement()
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

  // 3.5) agent 生命周期:新 Agent 加入时若替换开启则安装,销毁时清理。
  ctx.on('agent/created', (payload: unknown) => {
    const agentLike = (payload as { agent?: unknown } | null)?.agent
    if (agentLike === undefined) return
    if (current.enabled && current.search) replaceSearchToolFor(agentLike)
  })
  ctx.on('agent/disposed', (payload: unknown) => {
    const agentLike = (payload as { agent?: unknown } | null)?.agent
    if (agentLike === undefined) return
    const disposer = agentReplacements.get(agentLike)
    if (disposer !== undefined) {
      disposer()
      agentReplacements.delete(agentLike)
    }
  })
  // 4) fiber 卸载:清理全部注册(side effects 可逆,AGENTS.md 约束 9)。
  ctx.effect(() => {
    return () => {
        unmountZread()
        unmountSearchToolReplacement()
        for (const dispose of providerDisposers.splice(0)) dispose()
    }
  }, `${PKG}: fiber teardown`)

  // 5) 自监视热重载:lib/index.js 变化 → partialReload。
  installSelfHotReload(ctx, import.meta.url)

  console.log(`[${PKG}] host 已装配: search=${String(current.search)} reader=${String(current.reader)} zread=${String(current.zread)} (locale ns ${LOCALE_NAMESPACE})`)
}
