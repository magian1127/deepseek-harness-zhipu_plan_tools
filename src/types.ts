/**
 * 宿主服务的最小鸭子类型。
 *
 * 刻意不 import 任何 @deepseek-ai 包:bundle 加载时 link 包运行在宿主自己的
 * Node 进程里,@deepseek-ai 运行时类不保证对工作区包可见(见 hashline 的
 * peer 解析说明与 ZhiPu_web_search/types.ts 的同类取舍)。错误类按官方
 * HarnessError 运行时形状 { name, code, cause } 同构实现,见 errors.ts。
 */

/** Cordis disposer:注销注册项(本插件只使用同步返回的 () => void)。 */
export type Disposer = () => void

/** 本插件用到的宿主上下文:只用 get / on / effect / inject 四个成员。 */
export interface HostContext {
  get(name: string): any
  on(event: string, listener: (...args: any[]) => void): () => void
  effect(dispose: () => void | (() => void), label?: string): () => void
  inject(deps: string[], callback: (ctx: HostContext) => void): () => void
}

/** 凭据解析服务的最小形状(与 @deepseek-ai/dsh-credentials 运行时约定一致)。 */
export interface ResolvedCredential {
  readonly value: string
  readonly source?: string
}

export interface CredentialsService {
  resolve(ref: string): Promise<ResolvedCredential | undefined>
}

/** web 服务:search/fetch provider 注册(与 @deepseek-ai/dsh-web 契约一致)。 */
export interface WebSearchProviderShape {
  readonly id: string
  available(): boolean
  search(
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{
    content?: string
    sources: ReadonlyArray<{
      url: string
      title?: string
      snippet?: string
      publishedAt?: string
    }>
    truncated: boolean
  }>
}

export interface WebFetchProviderShape {
  readonly id: string
  available(): boolean
  fetch(
    request: { url: string },
    signal?: AbortSignal,
  ): Promise<{
    url: string
    statusCode: number
    body: { kind: 'html' | 'text'; content: string }
    truncated: boolean
  }>
}

export interface WebService {
  registerSearchProvider(provider: WebSearchProviderShape): Disposer
  registerFetchProvider(provider: WebFetchProviderShape): Disposer
}

/** tools 服务:模型工具注册(defineTool 的产物形状)。 */
export interface ToolDefinitionShape {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: any): Array<unknown>
    presentationMeta?(args: unknown, value: any): unknown
  }
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): unknown
  presentResult?(args: unknown, result: unknown): unknown
}

export interface ToolsService {
  register(tool: ToolDefinitionShape): Disposer
}

/** systemPrompt 服务:工具指引 section。 */
export interface SystemPromptService {
  section(section: { name: string; order?: number; text: string }): Disposer
}

/** settings 服务:命名空间注册(rc.7+,exposeToClients 支持设置卡片)。 */
export interface SettingsScopeShape {
  get(): Record<string, unknown>
  watch(callback: (next: Record<string, unknown>) => void): Disposer
}

export interface SettingsRegisterOptions {
  base?: Record<string, unknown>
  applies?: 'live' | 'restart'
  exposeToClients?: boolean
}

export interface SettingsService {
  register(
    namespace: string,
    schema: unknown,
    options?: SettingsRegisterOptions,
  ): SettingsScopeShape
}

/** hmr 服务:自监视热重载(官方 vendor/hmr)。 */
export interface HmrService {
  registerConfig(path: string, onChange: () => void): Promise<Disposer>
  partialReload(): Promise<unknown>
  readonly stashed: Set<string>
}

/** loader 服务:卸载时按 id 移除 Loader 图条目。 */
export interface LoaderService {
  remove(id: string): Promise<void> | void
}
