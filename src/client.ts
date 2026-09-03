/**
 * client 半边:向设置页"插件设置"区(settings.plugin.item 槽位)贡献
 * 折叠卡片。读写走官方 settingsScope(命名空间 dsh-zhipu),文案走
 * locale(settings.dsh-zhipu,中英双语)。
 *
 * 结构仿 hashline client.ts(已验证模式):useSyncExternalStore 订阅
 * scope 快照;本地草稿 + 恢复默认/放弃/保存;保存逐字段 set/unset 并
 * 校验接受结果。样式用 --dsw-alias-* 主题 token 与 @container 响应式。
 */
import React from 'react'
import { FIELDS, LOCALE_NAMESPACE, SETTINGS_NAMESPACE, hasOwn, normalized, sameSettings, validDraft, type SettingsValue } from './client-logic.js'

const h = React.createElement

const zh = {
  title: '智谱工具',
  description: '联网搜索、网页读取与开源仓库工具(github_*)',
  enabledStatus: '已启用',
  disabledStatus: '已停用',
  pending: '未保存',
  loading: '正在读取设置…',
  unavailable: '当前部署未提供智谱工具设置。',
  readOnly: '当前设置文档为只读，无法保存更改。',
  enabled: '启用智谱工具',
  enabledDesc: '总开关:关闭后搜索/读取进入兼容回退、仓库工具卸载;设置入口保留。',
  search: '联网搜索(接管 web_search)',
  searchDesc: '把内置 web_search 后端替换为智谱联网搜索 MCP。停用后按 DSH 请求形状回退 DeepSeek 搜索(凭据 DEEPSEEK_API_KEY)。',
  reader: '网页读取(接管 web_fetch)',
    readerDesc: '把内置 web_fetch 后端替换为智谱网页读取 MCP(markdown 正文)。DSH v0.1.2 起 Web 预设默认提供 web_fetch,挂载后即生效;停用后回退受限 HTTP(S) 文本抓取。',
  zread: '开源仓库工具',
  zreadDesc: '注册 github_search_doc / github_get_repo_structure / github_read_file 三个仓库工具。',
  zhPrompt: '提示词中文化',
  zhPromptDesc: '开启后注入的系统提示词与 github_* 工具说明使用中文(默认英文,与内置工具一致)。',
  credentialRef: '凭据引用名',
  credentialRefDesc: '智谱 Coding Plan API Key 的凭据引用(默认 ZAI_CODING_CN_API_KEY)。',
  inherited: '继承默认值',
  overridden: '用户覆盖',
  restore: '恢复默认值',
  discard: '放弃修改',
  save: '保存',
  saving: '保存中…',
  invalid: '凭据引用名须为字母开头的字母/数字/下划线,且不能为空。',
  saveFailed: '保存失败：',
  saveNotApplied: '主程序未接受全部设置，已保留草稿。',
}

const en = {
  title: 'Zhipu Tools',
  description: 'Web search, web reader and repo tools (github_*) powered by Zhipu MCP',
  enabledStatus: 'Enabled',
  disabledStatus: 'Disabled',
  pending: 'Unsaved',
  loading: 'Loading settings…',
  unavailable: 'Zhipu tools settings are unavailable in this deployment.',
  readOnly: 'The settings document is read-only; changes cannot be saved.',
  enabled: 'Enable Zhipu tools',
  enabledDesc: 'Master switch: off enters search/reader compatibility fallbacks and unregisters repo tools; this card stays.',
  search: 'Web search (takes over web_search)',
  searchDesc: 'Replaces the built-in web_search backend with the Zhipu search MCP. When off, it uses the DSH DeepSeek request shape (credential DEEPSEEK_API_KEY).',
  reader: 'Web reader (takes over web_fetch)',
  readerDesc: 'Replaces the built-in web_fetch backend with the Zhipu reader MCP (markdown). Web presets ship web_fetch by default since DSH v0.1.2, so it takes effect once mounted; turning this off uses a bounded HTTP(S) text fetch.',
  zread: 'Repository tools',
  zreadDesc: 'Registers github_search_doc / github_get_repo_structure / github_read_file.',
    zhPrompt: 'Chinese prompts',
    zhPromptDesc: 'When on, injected system-prompt sections and github_* tool descriptions use Chinese (English by default, matching built-in tools).',
    credentialRef: 'Credential reference',
  credentialRefDesc: 'Credential reference of the Zhipu Coding Plan API key (default ZAI_CODING_CN_API_KEY).',
  inherited: 'Inherited default',
  overridden: 'User override',
  restore: 'Restore defaults',
  discard: 'Discard changes',
  save: 'Save',
  saving: 'Saving…',
  invalid: 'Credential reference must start with a letter and contain only letters, digits and underscores.',
  saveFailed: 'Save failed: ',
  saveNotApplied: 'The host did not accept all settings; the draft was kept.',
}

const responsiveCss = [
  '@container (max-width: 180px) {',
  '  [data-zhipu-header] { min-height: 0 !important; padding: 10px 8px !important; display: grid !important; grid-template-columns: minmax(0, 1fr) 12px !important; gap: 4px !important; }',
  '  [data-zhipu-head-text] { min-width: 0 !important; }',
  '  [data-zhipu-name] { font-size: 12px !important; word-break: keep-all; overflow-wrap: anywhere; }',
  '  [data-zhipu-description], [data-zhipu-badge], [data-zhipu-hint], [data-zhipu-override] { display: none !important; }',
  '  [data-zhipu-body] { margin: 0 6px !important; }',
  '  [data-zhipu-row] { min-height: 0 !important; padding: 8px 0 !important; flex-direction: column !important; align-items: flex-start !important; gap: 6px !important; }',
  '  [data-zhipu-label-line] { display: block !important; word-break: keep-all; overflow-wrap: anywhere; }',
  '  [data-zhipu-footer] { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; }',
  '  [data-zhipu-footer] button { width: 100% !important; padding: 5px 3px !important; overflow-wrap: anywhere; }',
  '}',
].join('\n')

const styles = {
  card: {
    listStyle: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    overflow: 'hidden',
    containerType: 'inline-size',
  },
  header: {
    width: '100%',
    minHeight: 72,
    appearance: 'none',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  badge: {
    flex: 'none',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-bg-module-platform)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  chevron: { flex: 'none', width: 16, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', padding: '2px 0 8px' },
  status: { margin: '12px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minHeight: 58,
    padding: '10px 0',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  },
  rowText: { flex: 1, minWidth: 0 },
  labelLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  label: { fontSize: 13, fontWeight: 600, lineHeight: 1.5 },
  override: { fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary)' },
  hint: { marginTop: 2, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  checkbox: { flex: 'none', width: 18, height: 18, accentColor: 'var(--dsw-alias-brand-primary)' },
  textField: { marginTop: 7 },
  input: {
    width: '100%',
    height: 34,
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 7,
    padding: '5px 9px',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: 13,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 0 4px',
    borderTop: '1px solid var(--dsw-alias-border-l2)',
  },
  error: { flex: '1 1 220px', margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
  secondaryButton: {
    appearance: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '5px 12px',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
  },
  primaryButton: {
    appearance: 'none',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '5px 14px',
    background: 'var(--dsw-alias-label-primary)',
    color: 'var(--dsw-alias-bg-layer-3)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
  },
}

function controlDisabledStyle(disabled: boolean): { opacity: number; cursor: string } | null {
  return disabled ? { opacity: 0.45, cursor: 'default' } : null
}

function createCard(scope: any, t: (key: string) => string): () => any {
  function FieldIdentity(props: { overridden: boolean }) {
    return h('span', { style: styles.override, 'data-zhipu-override': '' }, props.overridden ? t('overridden') : t('inherited'))
  }

  function ToggleRow(props: { field: string; value: boolean; disabled: boolean; overridden: boolean; onChange: (next: boolean) => void }) {
    return h('label', { style: styles.row, 'data-zhipu-row': '' },
      h('span', { style: styles.rowText },
        h('span', { style: styles.labelLine, 'data-zhipu-label-line': '' },
          h('span', { style: styles.label }, t(props.field)),
          h(FieldIdentity, { overridden: props.overridden })),
        h('span', { style: styles.hint, 'data-zhipu-hint': '' }, t(props.field + 'Desc'))),
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: props.value,
        disabled: props.disabled,
        'aria-label': t(props.field),
        style: Object.assign({}, styles.checkbox, controlDisabledStyle(props.disabled)),
        onChange: function (event: { target: { checked: boolean } }) { props.onChange(event.target.checked) },
      }))
  }

  function CredentialRefField(props: { value: string; disabled: boolean; overridden: boolean; onChange: (next: string) => void }) {
    return h('label', { style: styles.textField, 'data-zhipu-row': '' },
      h('span', { style: styles.labelLine, 'data-zhipu-label-line': '' },
        h('span', { style: styles.label }, t('credentialRef')),
        h(FieldIdentity, { overridden: props.overridden })),
      h('span', { style: styles.hint, 'data-zhipu-hint': '' }, t('credentialRefDesc')),
      h('input', {
        type: 'text',
        value: props.value,
        disabled: props.disabled,
        'aria-label': t('credentialRef'),
        style: Object.assign({}, styles.input, controlDisabledStyle(props.disabled)),
        onChange: function (event: { target: { value: string } }) { props.onChange(event.target.value) },
      }))
  }

  return function ZhipuSettingsCard() {
    const snapshot = React.useSyncExternalStore(
      function (listener: () => void) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )
    const value = normalized(snapshot.value)
    const [draft, setDraft] = React.useState(function () { return value })
    const [open, setOpen] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const [resetAll, setResetAll] = React.useState(false)
    const dirty = !sameSettings(draft, value) || resetAll
    const valid = validDraft(draft)
    const editable = snapshot.status === 'ready' && snapshot.writable && !saving

    React.useEffect(function () {
      if (!dirty && !saving && snapshot.status === 'ready') {
        setDraft(normalized(snapshot.value))
        setResetAll(false)
      }
    }, [snapshot.revision, snapshot.status, dirty, saving])

    function change(field: string, nextValue: unknown) {
      setResetAll(false)
      setError('')
      setDraft(function (previous: SettingsValue) {
        return Object.assign({}, previous, { [field]: nextValue })
      })
    }

    async function save() {
      if (!editable || !dirty || !valid) return
      setSaving(true)
      setError('')
      try {
        if (resetAll) {
          for (let resetIndex = 0; resetIndex < FIELDS.length; resetIndex += 1) {
            await scope.unset(FIELDS[resetIndex])
          }
        } else {
          for (let index = 0; index < FIELDS.length; index += 1) {
            const field = FIELDS[index]
            if (!Object.is(draft[field as keyof SettingsValue], value[field as keyof SettingsValue])) {
              await scope.set(field, draft[field as keyof SettingsValue])
            }
          }
        }
        const accepted = normalized(scope.getSnapshot().value)
        const expected = resetAll ? normalized(scope.getSnapshot().base) : draft
        if (!sameSettings(accepted, expected)) throw new Error(t('saveNotApplied'))
        setResetAll(false)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      } finally {
        setSaving(false)
      }
    }

    function discard() {
      setDraft(value)
      setResetAll(false)
      setError('')
    }

    function restore() {
      setDraft(normalized(snapshot.base))
      setResetAll(true)
      setError('')
    }

    const statusText = value.enabled ? t('enabledStatus') : t('disabledStatus')
    const headerBadge = dirty ? t('pending') : statusText
    let body
    if (snapshot.status === 'loading') {
      body = h('p', { style: styles.status }, t('loading'))
    } else if (snapshot.status !== 'ready') {
      body = h('p', { style: styles.status }, t('unavailable'))
    } else {
      body = h(React.Fragment, null,
        snapshot.writable ? null : h('p', { style: styles.status }, t('readOnly')),
        h(ToggleRow, {
          field: 'enabled', value: draft.enabled, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'enabled'),
          onChange: function (next: boolean) { change('enabled', next) },
        }),
        h(ToggleRow, {
          field: 'search', value: draft.search, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'search'),
          onChange: function (next: boolean) { change('search', next) },
        }),
        h(ToggleRow, {
          field: 'reader', value: draft.reader, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'reader'),
          onChange: function (next: boolean) { change('reader', next) },
        }),
        h(ToggleRow, {
          field: 'zread', value: draft.zread, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'zread'),
          onChange: function (next: boolean) { change('zread', next) },
          }),
          h(ToggleRow, {
            field: 'zhPrompt', value: draft.zhPrompt, disabled: !editable,
            overridden: hasOwn(snapshot.user, 'zhPrompt'),
            onChange: function (next: boolean) { change('zhPrompt', next) },
          }),
        h(CredentialRefField, {
          value: draft.credentialRef, disabled: !editable,
          overridden: hasOwn(snapshot.user, 'credentialRef'),
          onChange: function (next: string) { change('credentialRef', next) },
        }),
        h('div', { style: styles.footer, 'data-zhipu-footer': '' },
          h('p', { style: styles.error }, !valid ? t('invalid') : error === '' ? '' : t('saveFailed') + error),
          h('button', {
            type: 'button',
            disabled: !editable,
            style: Object.assign({}, styles.secondaryButton, controlDisabledStyle(!editable)),
            onClick: restore,
          }, t('restore')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty,
            style: Object.assign({}, styles.secondaryButton, controlDisabledStyle(!editable || !dirty)),
            onClick: discard,
          }, t('discard')),
          h('button', {
            type: 'button',
            disabled: !editable || !dirty || !valid,
            style: Object.assign({}, styles.primaryButton, controlDisabledStyle(!editable || !dirty || !valid)),
            onClick: function () { void save() },
          }, saving ? t('saving') : t('save'))))
    }

    return h('li', { style: styles.card, 'data-zhipu-settings': '' },
      h('style', null, responsiveCss),
      h('button', {
        type: 'button',
        'aria-expanded': open,
        style: styles.header,
        'data-zhipu-header': '',
        onClick: function () { setOpen(!open) },
      },
        h('span', { style: styles.headText, 'data-zhipu-head-text': '' },
          h('span', { style: styles.name, 'data-zhipu-name': '' }, t('title')),
          h('span', { style: styles.description, 'data-zhipu-description': '' }, t('description'))),
        h('span', { style: styles.badge, 'data-zhipu-badge': '' }, headerBadge),
        h('span', { style: styles.chevron, 'data-zhipu-chevron': '', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      open ? h('div', { style: styles.body, 'data-zhipu-body': '' }, body) : null)
  }
}

function apply(ctx: any): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
  const Card = createCard(scope, t)
  ctx.effect(function () {
    return ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
  }, 'dsh-zhipu: settings dictionaries')
  ctx.slots.inject('settings.plugin.item', function () {
    return ctx.slots.register({
      name: 'settings.plugin.item',
      key: SETTINGS_NAMESPACE,
      locale: LOCALE_NAMESPACE,
    }, Card)
  })
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']
export { apply }
