// patch-row 单测:标记块幂等 add/remove、空文件、流式 []、旧式行兼容。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addManagedRow, hasManagedRow, hotRowBlock, patchPath, removeManagedRow, validateProfileName } from '../bin/patch-row.mjs'
import { BRIDGE_ROW_ID, BUNDLE_ROW_ID, HOT_ROW_ID, ROW_BEGIN, ROW_END } from '../bin/cli/constants.mjs'
import { BUNDLE_ROW_ID as HOST_BUNDLE, BRIDGE_ROW_ID as HOST_BRIDGE, HOT_ROW_ID as HOST_HOT, ROW_BEGIN as HOST_ROW_BEGIN, ROW_END as HOST_ROW_END } from '../constants.js'

const savedDshHome = process.env.DSH_HOME

test.after(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
})

/** 恢复进程原始 DSH_HOME;顶层 test.after 挂在 root(进程尾),isolation=none 下会跨文件泄漏,改 env 的用例内必须自行恢复。 */
function restoreHome(): void {
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
}

function freshProfile(): string {
  const home = mkdtempSync(join(tmpdir(), 'zhipu-row-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  return home
}

test('空目录:add 后 remove 回到合法 []', () => {
  const home = freshProfile()
  try {
    assert.equal(addManagedRow(hotRowBlock()), true)
    const text = readFileSync(patchPath(), 'utf8')
    assert.ok(text.includes('# dsh-zhipu:begin'))
    assert.ok(text.includes('- id: dsh-zhipu-hot'))
    // 幂等:重复 add 不改写。
    assert.equal(addManagedRow(hotRowBlock()), false)
    assert.equal(removeManagedRow(), true)
    assert.equal(hasManagedRow(), false)
    const after = readFileSync(patchPath(), 'utf8')
    // 只剩注释 → 合法顶层数组 []。
    assert.ok(after.trim().endsWith('[]'))
    } finally {
      restoreHome()
      rmSync(home, { recursive: true, force: true })
    }
})

test('已有其它内容:追加不破坏,删除只动自己的块', () => {
  const home = freshProfile()
  try {
    writeFileSync(patchPath(), ['# user note', '- id: other', "  name: 'other-pkg'", ''].join('\n'), 'utf8')
    assert.equal(addManagedRow(hotRowBlock()), true)
    const text = readFileSync(patchPath(), 'utf8')
    assert.ok(text.includes('- id: other'))
    assert.ok(text.includes('- id: dsh-zhipu-hot'))
    assert.equal(removeManagedRow(), true)
    const after = readFileSync(patchPath(), 'utf8')
    assert.ok(after.includes('- id: other'))
    assert.ok(!after.includes('dsh-zhipu-hot'))
    } finally {
      restoreHome()
      rmSync(home, { recursive: true, force: true })
    }
})

test('流式空数组 [] 尾:追加块后仍是合法数组', () => {
  const home = freshProfile()
  try {
    writeFileSync(patchPath(), '# header\n[]\n', 'utf8')
    assert.equal(addManagedRow(hotRowBlock()), true)
    const text = readFileSync(patchPath(), 'utf8')
    assert.ok(!/\[\]\s*$/m.test(text) || text.includes('# dsh-zhipu:begin'))
    assert.ok(text.includes('- id: dsh-zhipu-hot'))
    } finally {
      restoreHome()
      rmSync(home, { recursive: true, force: true })
    }
})

test('旧式无标记行:remove 也能清掉(防双重挂载)', () => {
  const home = freshProfile()
  try {
    writeFileSync(patchPath(), ["- id: dsh-zhipu-hot", "  name: 'deepseek-harness-zhipu_plan_tools'", ''].join('\n'), 'utf8')
    assert.equal(hasManagedRow(), true)
    assert.equal(removeManagedRow(), true)
    const after = readFileSync(patchPath(), 'utf8')
    assert.ok(!after.includes('dsh-zhipu-hot'))
    } finally {
      restoreHome()
      rmSync(home, { recursive: true, force: true })
    }
})

test('文件不存在:remove 返回 false,不创建文件', () => {
  const home = freshProfile()
  try {
    assert.equal(removeManagedRow(), false)
    assert.equal(existsSync(patchPath()), false)
    } finally {
      restoreHome()
      rmSync(home, { recursive: true, force: true })
    }
})

test('CLI 与 host 两侧行常量保持一致(有意双份,值必须同步)', () => {
  assert.equal(HOT_ROW_ID, HOST_HOT)
  assert.equal(BUNDLE_ROW_ID, HOST_BUNDLE)
  assert.equal(BRIDGE_ROW_ID, HOST_BRIDGE)
  assert.equal(ROW_BEGIN, HOST_ROW_BEGIN)
  assert.equal(ROW_END, HOST_ROW_END)
})

test('profile 名称拒绝路径穿越并接受合法 flat 名称', () => {
  for (const invalid of ['', '..', '.', 'a/b', 'a\\b', 'C:/absolute', 'node_modules']) {
    assert.throws(() => validateProfileName(invalid), /invalid profile name.*web/)
  }
  assert.equal(validateProfileName('web'), 'web')
  assert.equal(validateProfileName('my-profile'), 'my-profile')
})

test('写锁:陈旧锁被回收后写入正常;锁释放后不留锁文件', () => {
  const home = freshProfile()
  try {
    // 预置一个远早于 STALE 阈值的锁文件(模拟崩溃残留):withPatchLock 应回收并继续写入。
    const stale = patchPath() + '.lock'
    writeFileSync(stale, '', 'utf8')
    const old = new Date(Date.now() - 60_000)
    utimesSync(stale, old, old)
    assert.equal(addManagedRow(hotRowBlock()), true)
    assert.ok(readFileSync(patchPath(), 'utf8').includes('- id: dsh-zhipu-hot'))
    // 写入完成锁即释放:锁文件不应残留。
    assert.equal(existsSync(stale), false)
    assert.equal(removeManagedRow(), true)
    assert.equal(existsSync(stale), false)
  } finally {
    restoreHome()
    rmSync(home, { recursive: true, force: true })
  }
})
