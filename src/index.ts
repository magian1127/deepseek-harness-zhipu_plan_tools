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

  /** 极简模式(minimal 预设)是“仅持久 shell + str_replace_editor”的双工具组合,
   *  本插件的 web_search 阴影不得注入其中;服务缺席时回退旧行为。 */
  function isMinimalAgent(agentLike: unknown): boolean {
    // 任何判定失败只回退为非极简,绝不向事件总线抛错(Cordis emit 同步串联)。
    try {
      const agentPresets = ctx.get('agentPresets') as
        | { composedPreset?(agentCtx: unknown): string | undefined }
        | undefined
        | null
      if (agentPresets === undefined || agentPresets === null) return false
      if (typeof agentPresets.composedPreset !== 'function') return false
      const agentCtx = (agentLike as { ctx?: unknown } | null)?.ctx
      if (agentCtx === undefined) return false
      return agentPresets.composedPreset(agentCtx) === 'minimal'
    } catch {
      return false
    }
  }

  /** zread 全局工具在极简模式下必须显式隐藏:极简 agent 的继承视图会暴露 host
   *  全局注册的工具(与会话证据里 hashline_read/edit 泄漏同理),只有 restrict
   *  deny 才能保持“仅持久 shell + str_replace_editor”的双工具承诺。 */
  const ZREAD_DENY_NAMES = ['github_search_doc', 'github_get_repo_structure', 'github_read_file'] as const

  interface AgentScopeTools {
    restrict?(filter: { deny: readonly string[] }): Disposer | undefined
  }

  /** 为单个 Agent 建立(或撤销)本插件的表面:非极简 = web_search 阴影;极简 =
   *  deny 全局 github_* 工具(zread 开启时)。先撤旧再按当前状态重建。 */
  function installAgentSurface(agentLike: unknown): void {
    // 先撤销该 agent 已建立的表面(阴影或 deny),再按当前状态决定是否重建。
    // 这样会话中途 recompose(如 cordis -> minimal)后不会残留注入。
    const previous = agentReplacements.get(agentLike)
    if (previous !== undefined) {
      try { previous() } catch { /* 继续按当前状态重建。 */ }
      agentReplacements.delete(agentLike)
    }
    if (!current.enabled) return
    // 极简模式:不注入 web_search 阴影;若 zread 开启,在该 agent 作用域 deny
    // 全局 github_* 工具,维持双工具组合不被本插件突破。deny 与 search 开关无关。
    if (isMinimalAgent(agentLike)) {
      if (current.zread) {
        const agentCtx = (agentLike as { ctx?: HostContext } | null)?.ctx
        if (agentCtx !== undefined) {
          try {
            const scopedTools = agentCtx.get('tools') as AgentScopeTools | undefined | null
            const disposeRestriction = scopedTools?.restrict?.({ deny: ZREAD_DENY_NAMES })
            if (disposeRestriction !== undefined) {
              let active = true
              agentReplacements.set(agentLike, () => {
                if (!active) return
                active = false
                disposeRestriction()
              })
            }
          } catch { /* zread 全局工具未全局注册等场景:忽略,不向事件总线抛错。 */ }
        }
      }
      return
    }
    // 非极简:web_search 阴影(保持既有语义)。
    if (!current.search) return
    // 不突破 preset 的隐藏策略:只有继承视图里原 web_search 可见时才阴影。
    if (tools === undefined || tools === null || typeof tools.get !== 'function') return
    if (tools.get('web_search', agentLike) === undefined) return

    const disposer = installSearchToolReplacementForAgent(agentLike as { ctx: HostContext }, () => current)
    if (disposer !== undefined) agentReplacements.set(agentLike, disposer)
  }

  function mountSearchToolReplacement(): void {
    if (agents === undefined || agents === null) return
    for (const agent of agents.list()) installAgentSurface(agent)
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
        // Agent 表面(web_search 阴影 / 极简 deny):只要 enabled 就要评估,
        // 与 search 开关无关——极简 deny 在 search 关闭时也必须落位。
        if (current.enabled) mountSearchToolReplacement()
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

  // 3.5) agent 生命周期:新 Agent 加入时按预设建立表面(阴影或极简 deny),销毁时清理。
  ctx.on('agent/created', (payload: unknown) => {
    try {
      const agentLike = (payload as { agent?: unknown } | null)?.agent
      if (agentLike === undefined) return
      if (current.enabled) installAgentSurface(agentLike)
    } catch (error: unknown) {
      console.warn(`[${PKG}] agent/created 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  ctx.on('agent/disposed', (payload: unknown) => {
    try {
      const agentLike = (payload as { agent?: unknown } | null)?.agent
      if (agentLike === undefined) return
      const disposer = agentReplacements.get(agentLike)
      if (disposer !== undefined) {
        disposer()
        agentReplacements.delete(agentLike)
      }
    } catch (error: unknown) {
      console.warn(`[${PKG}] agent/disposed 监听失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  // 会话中途更换预设(DSH recompose 后显式 emit 的官方通知):已建立的 web_search
  // 阴影与极简 deny 必须按新 preset 重新评估,否则 cordis -> minimal 会残留注入。
  // agent-preset/selected 带会话标识,精准定位受影响 agent。
  //
  // 注意:绝不能监听 tools/change 来“兜底重查全部 live agent”。工具注册/注销
  // 会同步 emit tools/change(ScopedLayers.effect 的 onChange),而 installAgentSurface
  // 又会注册/注销工具,形成同步无限递归并卡死会话创建(曾导致“装了本插件无法新会话”)。
  // 事件监听器必须绝不抛异常(Cordis emit 同步串联,监听器抛错会中断 DSH 的会话
  // 流程,导致对话卡死);全部内部 try/catch,失败仅记录告警。
  ctx.on('agent-preset/selected', (sessionId: unknown) => {
    try {
      if (!current.enabled) return
      if (agents === undefined || agents === null) return
      const agent = agents.list().find((candidate) => {
        const a = candidate as { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } } | null
        return a?.session?.header?.id === sessionId || a?.session?.id === sessionId || a?.id === sessionId
      })
      if (agent !== undefined) installAgentSurface(agent)
    } catch (error: unknown) {
      console.warn(`[${PKG}] agent-preset/selected 监听失败: ${error instanceof Error ? error.message : String(error)}`)
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
