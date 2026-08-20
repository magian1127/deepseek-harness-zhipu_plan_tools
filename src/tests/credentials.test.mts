// credentials 单测:dshHome 回退、三层解析、available 本地检查。
// 环境变量在用例间保存/恢复(node:test 同进程共享 env)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialAvailable, dshHome, resolveApiKey } from '../credentials.js'
import type { HostContext } from '../types.js'

const savedDshHome = process.env.DSH_HOME
const savedKey = process.env.ZHIPU_TEST_KEY

test.after(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
  if (savedKey === undefined) delete process.env.ZHIPU_TEST_KEY
  else process.env.ZHIPU_TEST_KEY = savedKey
})

test('dshHome:空白 DSH_HOME 视为未设置,回退 ~/.dsh', () => {
  process.env.DSH_HOME = '  '
  assert.ok(dshHome().endsWith('.dsh'))
  process.env.DSH_HOME = 'C:\\tmp\\dsh-home'
  assert.equal(dshHome(), 'C:\\tmp\\dsh-home')
  delete process.env.DSH_HOME
  assert.ok(dshHome().endsWith('.dsh'))
})

test('resolveApiKey 三层:credentials 服务优先', async () => {
  const home = mkdtempSync(join(tmpdir(), 'zhipu-cred-'))
  try {
    mkdirSync(join(home), { recursive: true })
    writeFileSync(join(home, '.credentials.yaml'), 'OTHER: x\nZHIPU_TEST_KEY: file-value\n', 'utf8')
    process.env.DSH_HOME = home
    delete process.env.ZHIPU_TEST_KEY

    // 1) credentials 服务。
    const ctx = {
      get: (name: string) => (name === 'credentials' ? { resolve: async () => ({ value: 'service-value' }) } : undefined),
    } as HostContext
    assert.equal(await resolveApiKey(ctx, 'ZHIPU_TEST_KEY', 'tool'), 'service-value')

    // 2) 环境变量(服务拿不到时)。
    const ctxNoService = { get: () => undefined } as HostContext
    process.env.ZHIPU_TEST_KEY = 'env-value'
    assert.equal(await resolveApiKey(ctxNoService, 'ZHIPU_TEST_KEY', 'tool'), 'env-value')

    // 3) 文件直读(无服务无环境变量)。
    delete process.env.ZHIPU_TEST_KEY
    assert.equal(await resolveApiKey(ctxNoService, 'ZHIPU_TEST_KEY', 'tool'), 'file-value')

    // 三层都无 → 稳定错误码。
    await assert.rejects(
      () => resolveApiKey(ctxNoService, 'MISSING_KEY', 'tool'),
      (error: any) => error.code === 'ZHIPU_CREDENTIAL_MISSING',
    )
    await assert.rejects(
      () => resolveApiKey(ctxNoService, 'MISSING_KEY', 'web'),
      (error: any) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('credentialAvailable:env 或文件命中即 true(不发网络)', () => {
  const home = mkdtempSync(join(tmpdir(), 'zhipu-avail-'))
  try {
    process.env.DSH_HOME = home
    writeFileSync(join(home, '.credentials.yaml'), 'ZHIPU_TEST_KEY: v\n', 'utf8')
    delete process.env.ZHIPU_TEST_KEY
    assert.equal(credentialAvailable('ZHIPU_TEST_KEY'), true)
    assert.equal(credentialAvailable('NOT_PRESENT'), false)
    process.env.ZHIPU_TEST_KEY = 'env'
    assert.equal(credentialAvailable('ZHIPU_TEST_KEY'), true)
    delete process.env.ZHIPU_TEST_KEY
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
