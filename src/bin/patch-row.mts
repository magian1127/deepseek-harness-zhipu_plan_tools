/**
 * profile patch 挂载行的幂等读写(标记文本层)—— CLI 专用,自包含
 * (dshHome 与行 id 内联,不 import host 模块;host/CLI 两侧常量同步由
 * tests/patch-row.test.mts 对齐断言守护)。
 *
 * 编辑策略:只追加/删除本插件自己的 `# dsh-zhipu:begin/end` 标记块,
 * 绝不重写用户其它内容;文件始终是合法的顶层 YAML 数组(空时保留 `[]`)。
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BRIDGE_ROW_ID, BUNDLE_ROW_ID, HOT_ROW_ID, PKG, ROW_BEGIN, ROW_END } from './cli/constants.mjs'

/**
 * DSH 主目录:非空白 `$DSH_HOME`,否则回退官方默认 `~/.dsh`
 * (与官方 resolveDshHome 语义一致;harness 主进程不导出 DSH_HOME)。
 */
export function dshHome(): string {
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.trim().length > 0) return envHome
  return join(homedir(), '.dsh')
}

/** 与 DSH launcher 的 resolveProfileDir 保持一致的 flat profile 名校验。 */
export function validateProfileName(name: string): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name === 'node_modules') {
    throw new Error(`invalid profile name ${JSON.stringify(name)}; use a flat name such as "web"`)
  }
  return name
}

/** 新建 patch 文件时的说明头。 */
const NEW_FILE_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists).
`

/** profile 的 patch 文件路径。 */
export function patchPath(profile: string = 'web'): string {
  return join(dshHome(), 'profiles', validateProfileName(profile), 'cordis.patch.yml')
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 原子写入:同目录临时文件 + rename,失败时清理临时文件,避免中断截断 patch。 */
function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (error: unknown) {
    try {
      unlinkSync(tmp)
    } catch {
      // 临时文件已不存在,忽略。
    }
    throw error
  }
}

/** 锁参数:退避 25ms、总上限 5s;超过 30s 的锁视为崩溃残留并回收。 */
const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 5_000
const LOCK_STALE_MS = 30_000

/** 同步退避(CLI 场景阻塞可接受;Atomics.wait 是 Node 主线程的标准同步睡眠)。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 获取 patch 写锁(同目录 `<patch>.lock`,排他创建)后执行 fn,finally 释放。
 * 只防本插件 CLI 多实例并发的读-改-写丢失:锁内先读后写,两个实例不会
 * 互相覆盖对方的行变更。官方 dsh plugin 与其它工具不识别此锁,对它们仍
 * 只有 writeAtomic 的中断原子性。不可重入:fn 内不得再进本函数。
 * 过期回收存在理论上的双重 unlink 竞态(两个实例同时回收同一把陈旧锁),
 * 后果退化回无锁并发(仍有 writeAtomic 兼底),概率与危害均可接受。
 */
function withPatchLock<T>(path: string, fn: () => T): T {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const handle = openSync(lockPath, 'wx')
      closeSync(handle)
      break
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        continue // 锁文件刚被释放或被回收:立即重试。
      }
      if (Date.now() >= deadline) {
        throw new Error(`无法获得 patch 写锁: ${lockPath} 被其它实例占用超过 ${LOCK_TIMEOUT_MS}ms`)
      }
      sleepSync(LOCK_RETRY_MS)
    }
  }
  try {
    return fn()
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {
      // 锁已被过期回收或已不存在:忽略。
    }
  }
}

/** 受管块内容:临时热行(挂载点为本包 main 入口)。 */
export function hotRowBlock(): string {
  return [
    `${ROW_BEGIN}`,
    `- id: ${HOT_ROW_ID}`,
    `  name: '${PKG}'`,
    `${ROW_END}`,
  ].join('\n')
}

/** 受管块内容:query-URL 桥接行(?v= 绕 ESM 模块缓存;libUrl 为文件 URL)。 */
export function bridgeRowBlock(libUrl: string): string {
  return [
    `${ROW_BEGIN}`,
    `- id: ${BRIDGE_ROW_ID}`,
    `  name: '${libUrl}'`,
    `${ROW_END}`,
  ].join('\n')
}

/**
 * 幂等写入受管块。返回 true 表示本次实际写入。
 * 已存在标记块时按 incoming 原地替换;无标记块时追加(处理流式 `[]` 尾)。
 */
export function addManagedRow(block: string, profile: string = 'web'): boolean {
  const path = patchPath(profile)
  return withPatchLock(path, function () {
    const existing = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
    if (existing === null) {
      writeAtomic(path, NEW_FILE_HEADER + block + '\n')
      return true
    }
    if (existing.includes(ROW_BEGIN)) {
      const re = new RegExp(`${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
      const next = existing.replace(re, block + '\n')
      if (next === existing) return false
      writeAtomic(path, next)
      return true
    }
    let next = existing
    // 去掉行尾的流式空数组 `[]`,以便追加块式条目;没有其它条目时追加块
    // 本身就是合法数组。
    const lines = next.split('\n')
    let tail = lines.length - 1
    while (tail >= 0 && lines[tail].trim() === '') tail -= 1
    if (tail >= 0 && /^\s*\[\]\s*$/.test(lines[tail])) lines.splice(tail, 1)
    next = lines.join('\n').replace(/[ \t]+$/gm, '')
    if (next !== '' && !next.endsWith('\n')) next += '\n'
    if (next !== '') next += '\n'
    writeAtomic(path, next + block + '\n')
    return true
  })
}

/**
 * 删除受管块(含旧式无标记的 dsh-zhipu 行,防双重挂载)。返回 true 表示删到了。
 * 删除后若只剩注释,写回合法 `[]`。
 */
export function removeManagedRow(profile: string = 'web'): boolean {
  const path = patchPath(profile)
  if (!existsSync(path)) return false
  return withPatchLock(path, function () {
    if (!existsSync(path)) return false // 锁等待期间被并发删除:锁内重验。
    const original = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
    let next = original
    let removed = false
    if (next.includes(ROW_BEGIN)) {
      const re = new RegExp(`\\n?${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
      const after = next.replace(re, '\n')
      removed = after !== next
      next = after
    }
    // 兼容历史/手写行(无标记块):按 id 清除。
    for (const id of [BUNDLE_ROW_ID, HOT_ROW_ID, BRIDGE_ROW_ID]) {
      const legacy = new RegExp(`\\n?- id: ${escapeRe(id)}\\n([^\\n]*(?:\\n(?!\\s*- )[ ]{2,}[^\\n]*)*)`, 'g')
      const after = next.replace(legacy, '')
      if (after !== next) {
        next = after
        removed = true
      }
    }
    if (!removed) return false
    const meaningful = next.split('\n').filter((line) => {
      const t = line.trim()
      return t !== '' && !t.startsWith('#') && !/^\[\]\s*$/.test(t)
    })
    if (meaningful.length === 0) {
      const comments = next.split('\n').filter((line) => line.trim().startsWith('#'))
      next = [...comments, '[]'].join('\n') + '\n'
    }
    writeAtomic(path, next)
    return true
  })
}

/** patch 中是否存在受管块或本插件任意行。 */
export function hasManagedRow(profile: string = 'web'): boolean {
  const path = patchPath(profile)
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  return text.includes(ROW_BEGIN) || text.includes(`- id: ${BUNDLE_ROW_ID}`) || text.includes(`- id: ${HOT_ROW_ID}`) || text.includes(`- id: ${BRIDGE_ROW_ID}`)
}
