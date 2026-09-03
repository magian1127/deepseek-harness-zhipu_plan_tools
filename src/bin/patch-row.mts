/**
 * profile patch 挂载行的幂等读写(标记文本层)—— CLI 专用,自包含
 * (dshHome 与行 id 内联,不 import host 模块;host/CLI 两侧常量同步由
 * tests/patch-row.test.mts 对齐断言守护)。
 *
 * 编辑策略:只追加/删除本插件自己的 `# dsh-zhipu:begin/end` 标记块,
 * 绝不重写用户其它内容;文件始终是合法的顶层 YAML 数组(空时保留 `[]`)。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  const existing = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null
  if (existing === null) {
    writeFileSync(path, NEW_FILE_HEADER + block + '\n')
    return true
  }
  if (existing.includes(ROW_BEGIN)) {
    const re = new RegExp(`${escapeRe(ROW_BEGIN)}[^\\n]*\\n[\\s\\S]*?\\n${escapeRe(ROW_END)}[^\\n]*\\n?`, 'g')
    const next = existing.replace(re, block + '\n')
    if (next === existing) return false
    writeFileSync(path, next)
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
  writeFileSync(path, next + block + '\n')
  return true
}

/**
 * 删除受管块(含旧式无标记的 dsh-zhipu 行,防双重挂载)。返回 true 表示删到了。
 * 删除后若只剩注释,写回合法 `[]`。
 */
export function removeManagedRow(profile: string = 'web'): boolean {
  const path = patchPath(profile)
  if (!existsSync(path)) return false
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
  writeFileSync(path, next)
  return true
}

/** patch 中是否存在受管块或本插件任意行。 */
export function hasManagedRow(profile: string = 'web'): boolean {
  const path = patchPath(profile)
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  return text.includes(ROW_BEGIN) || text.includes(`- id: ${BUNDLE_ROW_ID}`) || text.includes(`- id: ${HOT_ROW_ID}`) || text.includes(`- id: ${BRIDGE_ROW_ID}`)
}
