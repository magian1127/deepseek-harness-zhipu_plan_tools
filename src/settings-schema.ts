/**
 * 设置:插件 Config schema(DSH 0.1.7 起)。
 *
 * 配置值全部声明为本插件导出的 Config(字段 .volatile(),可实时编辑,值
 * 持久化在 profile 行 config);宿主把易变字段物化成引用后随 apply 传入。
 * host 侧用 profile 的 schemastery 构造 schema(与主进程同一实例,沿
 * dsh-zh/hashline 模式);profile 不可用时 Config 导出为 null,宿主跳过
 * schema 校验,config 以普通值传入(降级语义与旧版一致)。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CREDENTIAL_REF } from './constants.js'
import { dshHome } from './credentials.js'

/** 归一化后的设置(未知/缺失值回默认;原子替换,读写无锁)。 */
export interface ZhipuSettings {
  /** 总开关:关闭 = 工具卸载 + providers 停用 + 提示移除,设置入口保留。 */
  enabled: boolean
  /** 是否接管 web_search 后端;关闭后由固定 provider 回退 DeepSeek。 */
  search: boolean
  /** 是否接管 web_fetch 后端;关闭后由固定 provider 回退受限 HTTP 抓取。 */
  reader: boolean
  /** 是否注册 3 个 github_* 仓库工具。 */
  zread: boolean
  /** 提示词中文化:开启后注入的提示词 section 与工具说明用中文。 */
  zhPrompt: boolean
  /** 凭据引用名。 */
  credentialRef: string
}

export const DEFAULT_SETTINGS: ZhipuSettings = {
  enabled: true,
  search: true,
  reader: true,
  zread: false,
  zhPrompt: false,
  credentialRef: DEFAULT_CREDENTIAL_REF,
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/** 把任意来源(组合行 config / settings 快照)归一化为 ZhipuSettings。 */
export function normalizeSettings(value: unknown): ZhipuSettings {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    enabled: asBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    search: asBoolean(source.search, DEFAULT_SETTINGS.search),
    reader: asBoolean(source.reader, DEFAULT_SETTINGS.reader),
    zread: asBoolean(source.zread, DEFAULT_SETTINGS.zread),
    zhPrompt: asBoolean(source.zhPrompt, DEFAULT_SETTINGS.zhPrompt),
    credentialRef: asNonEmptyString(source.credentialRef, DEFAULT_SETTINGS.credentialRef),
  }
}

/** 桌面版 Host(Electron RunAsNode)argv 不带 --profile,profile 固定为 desktop
 * (apps/desktop/src/paths.ts);此时不能落回 web 默认,否则 createRequire 会
 * 锚到 web profile,拿不到与桌面运行时(asar 内)同实例的 DSH 模块。 */
export function profileNameFrom(argv: readonly string[], electronVersion: string | undefined): string {
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  if (electronVersion !== undefined) return 'desktop'
  return 'web'
}

/** 当前 profile 名:--profile 显式值 > 桌面 Host 判定 > 默认 web。 */
export function argvProfile(): string {
  return profileNameFrom(process.argv, process.versions.electron)
}

/** 当前 profile 目录(运行时真值在 ${DSH_HOME:-~/.dsh}/profiles/<name>)。 */
export function localProfileDir(): string {
  return join(dshHome(), 'profiles', argvProfile())
}

let schemasteryCache: any
let schemasteryFailed = false

// DSH 0.1.7-rc 的组合批次经模块 hooks 管线并行动态 import 官方插件的 ESM；
// 同步 require(esm)（包括 schemastery CJS 入口内部的 require）会撞 Node 的
// 「not yet fully loaded」：管线被当前同步栈阻塞，重试永远等不到加载完成。
// 因此用 require.resolve 系只做解析（不求值、无竞态），并优先取 exports 的
// import 条目做异步 import：整条依赖链（schemastery → cosmokit）都排进同
// 一条管线串行交付，天然无竞态；顶层 await 保证 Config 构造前实例已就绪。
function profileEntryPath(requireFromProfile: NodeRequire, name: string): string {
  const requireEntry: string = requireFromProfile.resolve(name)
  try {
    const manifestPath: string = requireFromProfile.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>
      main?: unknown
    }
    const selfExport: unknown = manifest?.exports?.['.']
    const entry = typeof selfExport === 'string'
      ? selfExport
      : typeof selfExport === 'object' && selfExport !== null
        ? (selfExport as { import?: unknown; default?: unknown }).import ?? (selfExport as { default?: unknown }).default
        : undefined
    if (typeof entry === 'string') return resolve(dirname(manifestPath), entry)
    if (typeof manifest?.main === 'string') return resolve(dirname(manifestPath), manifest.main)
  } catch {
    // exports 不可读时退回 require 条目。
  }
  return requireEntry
}

try {
  const requireFromProfile = createRequire(join(localProfileDir(), 'package.json'))
  const entry = profileEntryPath(requireFromProfile, '@deepseek-ai/schemastery')
  const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown } | null | undefined
  schemasteryCache = mod !== null && mod !== undefined && mod.default !== undefined ? mod.default : mod
} catch {
  schemasteryCache = undefined
}

/**
 * 静态 Config 用的 schemastery 实例。在 profile 模块解析上下文中加载；
 * 预载失败时走同步兜底（脱离 profile 的测试/CLI 环境），再失败为 null
 * （降级为无 schema，Config 导出 undefined）。
 */
export function loadSchemastery(): any {
  if (schemasteryCache !== undefined) return schemasteryCache
  if (schemasteryFailed) return null
  try {
    const mod = createRequire(join(localProfileDir(), 'package.json'))('@deepseek-ai/schemastery')
    schemasteryCache = mod !== null && mod !== undefined && mod.default !== undefined ? mod.default : mod
  } catch {
    schemasteryFailed = true
    return null
  }
  return schemasteryCache
}

/** 标记 volatile(插件页实时编辑)。profile hoisted 的 schemastery 可能是
 *  3.18.2(无 .volatile() 方法,宿主 0.1.7 需要 3.18.3):此时直接给字段
 *  schema 打 meta.volatile 标记——宿主 volatileForm/diff 读的就是 meta,
 *  表单照常投影。注意 schema 实例是 function 类型,不能用 typeof 'object'
 *  守卫;旧版 resolve 不物化引用,变更按「重挂载生效」(功能完整,仅非原地)。 */
function volatileField(field: any): any {
  if (field === null || field === undefined) return field
  if (typeof field.volatile === 'function') return field.volatile()
  field.meta = { ...(field.meta ?? {}), volatile: true }
  return field
}

/** 构造设置 schema(schemastery 实例由调用方注入;返回 null 表示不可用)。
 *  全部字段 volatile:插件页可实时编辑,宿主以引用物化、不经重启生效。 */
export function createSettingsSchema(z: any): any {
  if (z === null || z === undefined || typeof z.object !== 'function') return null
  return z.object({
    enabled: volatileField(z.boolean().default(DEFAULT_SETTINGS.enabled)),
    search: volatileField(z.boolean().default(DEFAULT_SETTINGS.search)),
    reader: volatileField(z.boolean().default(DEFAULT_SETTINGS.reader)),
    zread: volatileField(z.boolean().default(DEFAULT_SETTINGS.zread)),
    zhPrompt: volatileField(z.boolean().default(DEFAULT_SETTINGS.zhPrompt)),
    credentialRef: volatileField(z.string().default(DEFAULT_SETTINGS.credentialRef)),
  })
}

/** 把宿主传入的 config 去引用成普通值快照:volatile 字段(带 .get() 的引用)
 *  读出当前值,普通字段(无 schema 时的降级路径)原样保留。 */
export function dereferenceConfig(config: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    result[key] = value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
      ? (value as { get(): unknown }).get()
      : value
  }
  return result
}
