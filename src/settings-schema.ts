/**
 * 设置:组合行 config(基线)→ settings 命名空间 `dsh-zhipu`(实时)。
 *
 * host 侧用 profile 的 schemastery 构造 schema(与主进程同一实例,沿
 * dsh-zh/hashline 模式);profile 不可用时降级——不注册设置 UI,功能按
 * 组合行传入的 config 工作(hashline 同款降级语义)。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DEFAULT_CREDENTIAL_REF } from './constants.js'
import { dshHome } from './credentials.js'

/** 归一化后的设置(未知/缺失值回默认;原子替换,读写无锁)。 */
export interface ZhipuSettings {
  /** 总开关:关闭 = 工具卸载 + providers 停用 + 提示移除,设置入口保留。 */
  enabled: boolean
  /** 是否接管 web_search 后端(停用而非回退,回退需删 patch 行)。 */
  search: boolean
  /** 是否接管 web_fetch 后端(停用而非回退)。 */
  reader: boolean
  /** 是否注册 3 个 github_* 仓库工具。 */
  zread: boolean
  /** 凭据引用名。 */
  credentialRef: string
}

export const DEFAULT_SETTINGS: ZhipuSettings = {
  enabled: true,
  search: true,
  reader: true,
  zread: true,
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
 * 同步加载 profile 里的 schemastery(CJS 分支)。settings.register 需要
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

/** 构造设置 schema(schemastery 实例由调用方注入;返回 null 表示不可用)。 */
export function createSettingsSchema(z: any): any {
  if (z === null || z === undefined || typeof z.object !== 'function') return null
  return z.object({
    enabled: z.boolean().default(DEFAULT_SETTINGS.enabled),
    search: z.boolean().default(DEFAULT_SETTINGS.search),
    reader: z.boolean().default(DEFAULT_SETTINGS.reader),
    zread: z.boolean().default(DEFAULT_SETTINGS.zread),
    credentialRef: z.string().default(DEFAULT_SETTINGS.credentialRef),
  })
}
