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
import { join } from 'node:path'
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

/** 当前 profile 名:沿 dsh-zh 的 argv 探测,默认 web。 */
export function argvProfile(): string {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return 'web'
}

/** 当前 profile 目录(运行时真值在 ${DSH_HOME:-~/.dsh}/profiles/<name>)。 */
export function localProfileDir(): string {
  return join(dshHome(), 'profiles', argvProfile())
}

let schemasteryCache: any
let schemasteryFailed = false

/**
 * 同步加载 profile 里的 schemastery(CJS 分支)。Config 导出需要
 * schemastery schema;用 profile 的 require 上下文解析,避免本包显式依赖。
 */
export function loadSchemastery(): any {
  if (schemasteryCache !== undefined) return schemasteryCache
  if (schemasteryFailed) return null
  try {
    const requireFromProfile = createRequire(join(localProfileDir(), 'package.json'))
    const mod = requireFromProfile('@deepseek-ai/schemastery')
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
