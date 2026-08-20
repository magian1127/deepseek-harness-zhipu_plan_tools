/**
 * client 侧设置的纯逻辑(可单测;与 host 侧 settings-schema 的默认值
 * **各自独立定义**——客户端不得引用主机端常量,AGENTS.md 经验:未定义
 * 标识符会让整个插件 apply 抛 ReferenceError 全部失效)。
 */

export const SETTINGS_NAMESPACE = 'dsh-zhipu'
export const LOCALE_NAMESPACE = 'settings.dsh-zhipu'

export const FIELDS = ['enabled', 'search', 'reader', 'zread', 'credentialRef'] as const

export const DEFAULTS = {
  enabled: true,
  search: true,
  reader: true,
  zread: true,
  credentialRef: 'ZAI_CODING_CN_API_KEY',
}

export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SettingsValue {
  enabled: boolean
  search: boolean
  reader: boolean
  zread: boolean
  credentialRef: string
}

export function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

export function normalized(value: unknown): SettingsValue {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
    search: typeof source.search === 'boolean' ? source.search : DEFAULTS.search,
    reader: typeof source.reader === 'boolean' ? source.reader : DEFAULTS.reader,
    zread: typeof source.zread === 'boolean' ? source.zread : DEFAULTS.zread,
    credentialRef: typeof source.credentialRef === 'string' && source.credentialRef.trim().length > 0 ? source.credentialRef.trim() : DEFAULTS.credentialRef,
  }
}

export function sameSettings(left: SettingsValue, right: SettingsValue): boolean {
  return FIELDS.every((field) => Object.is(left[field as keyof SettingsValue], right[field as keyof SettingsValue]))
}

export function validDraft(draft: SettingsValue): boolean {
  return CREDENTIAL_REF_PATTERN.test(draft.credentialRef)
}
