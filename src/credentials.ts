/**
 * 凭据解析:三层兜底 —— credentials 服务 → 环境变量 → 直读凭据文件。
 *
 * 关键修复点(沿 ZhiPu_web_search 2026-08 复盘):harness 主进程不导出
 * `DSH_HOME`,home 解析必须带 `~/.dsh` 回退,与官方 resolveDshHome 语义
 * 对齐(显式配置 > $DSH_HOME > ~/.dsh,空白视为未设置)。曾因缺此回退
 * 导致 provider 恒 unavailable(AGENTS.md 约束 11)。
 *
 * key 永不写入配置、日志或错误信息(AGENTS.md 约束 10)。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CredentialsService, HostContext } from './types.js'
import {
  WEB_PROVIDER_CREDENTIAL_MISSING_CODE,
  ZHIPU_CREDENTIAL_MISSING_CODE,
  ZhipuError,
} from './errors.js'

/** DSH 凭据文件名(相对 DSH 主目录)。 */
const CREDENTIALS_FILE = '.credentials.yaml'

/**
 * DSH 主目录:非空白的 `$DSH_HOME`,否则回退官方默认 `~/.dsh`。
 * 与官方 `resolveDshHome`(@deepseek-ai/dsh-home-paths)语义一致。
 */
export function dshHome(): string {
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.trim().length > 0) return envHome
  return join(homedir(), '.dsh')
}

/** 当前进程环境是否有该凭据。 */
function credentialInEnvironment(ref: string): boolean {
  const value = process.env[ref]
  return value !== undefined && value.length > 0
}

/** 凭据文件是否存有该键(只读取 refs 段,支持 YAML 常见标量写法)。 */
function credentialInFile(ref: string, home: string = dshHome()): string | undefined {
  try {
    const lines = readFileSync(join(home, CREDENTIALS_FILE), 'utf8').split(/\r?\n/)
    let inRefs = false
    for (const line of lines) {
      if (!inRefs) {
        if (/^refs:\s*(?:#.*)?$/.test(line)) inRefs = true
        continue
      }
      // refs 段结束于下一个顶层 YAML 键。
      if (line.length > 0 && !/^\s/.test(line)) break
      const match = /^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line)
      if (match === null || match[1] !== ref) continue
      let value = match[2]
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        try { value = JSON.parse(value) as string } catch { value = value.slice(1, -1) }
      } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        value = value.slice(1, -1).replace(/''/g, "'")
      } else {
        value = value.replace(/\s+#.*$/, '').trim()
      }
      return value.length > 0 ? value : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 本地可用性检查(官方契约:cheap local check,不得发网络请求)。
 * 凭据文件可热更新,因此每次调用现查,不缓存。
 */
export function credentialAvailable(ref: string): boolean {
  return credentialInEnvironment(ref) || credentialInFile(ref) !== undefined
}

/**
 * provider 的同步可用性:本地已知凭据存在,或 credentials 服务可在执行时解析。
 * 服务存在不代表指定 ref 必然存在;缺失时由执行路径返回稳定错误码。
 */
export function credentialResolvable(ctx: HostContext | undefined, ref: string): boolean {
  return ctx?.get('credentials') != null || credentialAvailable(ref)
}

/**
 * 解析 API key:优先 credentials 服务(官方解析链,含热更新),回退
 * 环境变量,再回退直读 `~/.dsh/.credentials.yaml`。
 *
 * @param scope 'web' 走官方 WebError 语义码,'tool' 走本插件码。
 * @throws ZhipuError(*_CREDENTIAL_MISSING)三层都拿不到时。
 */
export async function resolveApiKey(
  ctx: HostContext | undefined,
  ref: string,
  scope: 'web' | 'tool',
  signal?: AbortSignal,
): Promise<string> {
  // 1) credentials 服务(可选服务:缺失时静默跳过)。
  const credentials = ctx?.get('credentials') as CredentialsService | undefined | null
  if (credentials !== undefined && credentials !== null) {
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved !== undefined && resolved !== null && resolved.value.length > 0) {
        return resolved.value
      }
    } catch {
      // 服务失败继续走回退,不掩盖后续错误。
    }
  }
  if (signal?.aborted === true) throw aborting(scope)

  // 2) 环境变量。
  const envValue = process.env[ref]
  if (envValue !== undefined && envValue.length > 0) return envValue

  // 3) 直读凭据文件(带 ~/.dsh 回退)。
  const fileValue = credentialInFile(ref)
  if (fileValue !== undefined && fileValue.length > 0) return fileValue

  const code = scope === 'web' ? WEB_PROVIDER_CREDENTIAL_MISSING_CODE : ZHIPU_CREDENTIAL_MISSING_CODE
  throw new ZhipuError(
    `[${code}] 未找到凭据 ${ref},请先在凭据配置($HOME/.dsh/.credentials.yaml)或环境变量中设置对应 API Key`,
    code,
  )
}

function aborting(scope: 'web' | 'tool'): ZhipuError {
  const code = scope === 'web' ? 'WEB_ABORTED' : 'ZHIPU_ABORTED'
  return new ZhipuError(`[${code}] 智谱调用已中止`, code)
}
