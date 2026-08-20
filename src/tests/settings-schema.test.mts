// settings-schema 与 client-logic 纯函数单测(host 与 client 两侧默认值一致性)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings-schema.js'
import { DEFAULTS, normalized, sameSettings, validDraft, hasOwn } from '../client-logic.js'

test('normalizeSettings:空值回默认,未知类型回默认', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings('nonsense'), DEFAULT_SETTINGS)
  const partial = normalizeSettings({ search: false, credentialRef: ' ZAI_KEY ' })
  assert.equal(partial.search, false)
  assert.equal(partial.reader, true)
  assert.equal(partial.credentialRef, 'ZAI_KEY')
  // 非法 credentialRef(空串)回默认。
  assert.equal(normalizeSettings({ credentialRef: '   ' }).credentialRef, DEFAULT_SETTINGS.credentialRef)
})

test('host 与 client 两侧默认值保持一致(有意双份,值必须同步)', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, DEFAULTS.enabled)
  assert.equal(DEFAULT_SETTINGS.search, DEFAULTS.search)
  assert.equal(DEFAULT_SETTINGS.reader, DEFAULTS.reader)
  assert.equal(DEFAULT_SETTINGS.zread, DEFAULTS.zread)
  assert.equal(DEFAULT_SETTINGS.credentialRef, DEFAULTS.credentialRef)
})

test('client normalized/sameSettings/validDraft', () => {
  const base = normalized({})
  assert.deepEqual(base, DEFAULTS)
  const changed = normalized({ zread: false })
  assert.equal(sameSettings(base, changed), false)
  assert.equal(sameSettings(changed, normalized({ zread: false })), true)
  assert.equal(validDraft(normalized({ credentialRef: 'MY_KEY_2' })), true)
  // normalized 只回退空值;'2BAD' 非空会原样保留,由 validDraft 拦截。
  assert.equal(validDraft(normalized({ credentialRef: '2BAD' })), false)
  assert.equal(validDraft({ ...DEFAULTS, credentialRef: '2bad' }), false)
  assert.equal(validDraft({ ...DEFAULTS, credentialRef: '' }), false)
  assert.equal(validDraft({ ...DEFAULTS, credentialRef: 'has space' }), false)
})

test('hasOwn 区分自有与继承', () => {
  assert.equal(hasOwn({ a: 1 }, 'a'), true)
  assert.equal(hasOwn({ a: 1 }, 'b'), false)
  assert.equal(hasOwn(null, 'a'), false)
})
