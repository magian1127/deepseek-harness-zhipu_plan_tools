/**
 * client 半边:向侧栏插件页(Plugins page)的本包页面(plugins.bundle.config
 * 槽位,key 为 npm 包名)贡献配置表单。DSH 0.1.6 起插件配置从设置页
 * "插件设置"区(settings.plugin.item,已退役)迁到插件页组合包页面。
 * 读写走官方 configForms(DSH 0.1.7+,入口 id dsh-zhipu = profile 行 id),文案走
 * locale(settings.dsh-zhipu,中英双语)。
 *
 * 对齐官方 PluginConfigForm 约定:summary 视图渲染一句话简介,page 视图
 * 渲染表单;页面自画标题/图标/面包屑,表单只留字段行与"保存"(离开页面
 * 即丢弃草稿,无放弃/恢复默认值控件)。useSyncExternalStore 订阅 scope
 * 快照;保存逐字段 set/unset 并校验接受结果。样式用 --dsw-alias-* 主题 token。
 */
import React from 'react'
import { FIELDS, LOCALE_NAMESPACE, SETTINGS_NAMESPACE, hasOwn, normalized, sameSettings, validDraft, type SettingsValue } from './client-logic.js'

const h = React.createElement

/** plugins.bundle.config 槽位的键:profile 中本包的 npm 包名(非 settings 命名空间)。 */
const BUNDLE_PACKAGE_NAME = 'deepseek-harness-zhipu_plan_tools'

const zh = {
  summary: '联网搜索、网页读取与开源仓库工具(github_*)的工具来源与凭据配置。',
  loading: '正在读取设置…',
  unavailable: '当前部署未提供智谱工具设置。',
  readOnly: '当前设置文档为只读，无法保存更改。',
  enabled: '启用智谱工具',
  enabledDesc: '总开关:关闭后搜索/读取进入兼容回退、仓库工具卸载;配置入口保留。',
  search: '联网搜索(接管 web_search)',
  searchDesc: '把内置 web_search 后端替换为智谱联网搜索 MCP。停用后按 DSH 请求形状回退 DeepSeek 搜索(凭据 DEEPSEEK_API_KEY)。',
  reader: '网页读取(接管 web_fetch)',
    readerDesc: '把内置 web_fetch 后端替换为智谱网页读取 MCP(markdown 正文)。DSH v0.1.2 起 Web 预设默认提供 web_fetch,挂载后即生效;停用后回退受限 HTTP(S) 文本抓取。',
  zread: '开源仓库工具',
  zreadDesc: '注册 github_search_doc / github_get_repo_structure / github_read_file 三个仓库工具。',
  zhPrompt: '提示词中文化',
    zhPromptDesc: '开启后注入的系统提示词、github_* 工具说明及其错误消息使用中文(默认英文,与内置工具一致)。',
  credentialRef: '凭据引用名',
  credentialRefDesc: '智谱 Coding Plan API Key 的凭据引用(默认 ZAI_CODING_CN_API_KEY)。',
  inherited: '继承默认值',
  overridden: '用户覆盖',
  save: '保存',
  saving: '保存中…',
  invalid: '凭据引用名须为字母开头的字母/数字/下划线,且不能为空。',
  saveFailed: '保存失败：',
  saveNotApplied: '主程序未接受全部设置，已保留草稿。',
}

const en = {
  summary: 'Where web search, web reader and repo tools (github_*) come from, and their credential.',
  loading: 'Loading settings…',
  unavailable: 'Zhipu tools settings are unavailable in this deployment.',
  readOnly: 'The settings document is read-only; changes cannot be saved.',
  enabled: 'Enable Zhipu tools',
  enabledDesc: 'Master switch: off enters search/reader compatibility fallbacks and unregisters repo tools; this form stays.',
  search: 'Web search (takes over web_search)',
  searchDesc: 'Replaces the built-in web_search backend with the Zhipu search MCP. When off, it uses the DSH DeepSeek request shape (credential DEEPSEEK_API_KEY).',
  reader: 'Web reader (takes over web_fetch)',
  readerDesc: 'Replaces the built-in web_fetch backend with the Zhipu reader MCP (markdown). Web presets ship web_fetch by default since DSH v0.1.2, so it takes effect once mounted; turning this off uses a bounded HTTP(S) text fetch.',
  zread: 'Repository tools',
  zreadDesc: 'Registers github_search_doc / github_get_repo_structure / github_read_file.',
    zhPrompt: 'Chinese prompts',
      zhPromptDesc: 'When on, injected system-prompt sections, github_* tool descriptions and their error messages use Chinese (English by default, matching built-in tools).',
    credentialRef: 'Credential reference',
  credentialRefDesc: 'Credential reference of the Zhipu Coding Plan API key (default ZAI_CODING_CN_API_KEY).',
  inherited: 'Inherited default',
  overridden: 'User override',
  save: 'Save',
  saving: 'Saving…',
  invalid: 'Credential reference must start with a letter and contain only letters, digits and underscores.',
  saveFailed: 'Save failed: ',
  saveNotApplied: 'The host did not accept all settings; the draft was kept.',
}

// 页面表单容器:对齐官方 PluginConfigForm.module.css 的 .form(flex column)。
const formStyle = { display: 'flex', flexDirection: 'column' } as const

const styles = {
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
    paddingTop: 16,
  },
  error: { flex: '1 1 220px', margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
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

function createForm(scope: any, t: (key: string) => string): (props: { view?: string }) => any {
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

  return function ZhipuConfigPage(props: { view?: string }) {
    // summary 视图:插件页在标题下一句话简介;目前组合包页面只用 page 视图,
    // summary 分支作为契约兜底(契约声明两种视图都会传)。
    if (props?.view === 'summary') return h('span', { 'data-zhipu-summary': '' }, t('summary'))
    const snapshot = React.useSyncExternalStore(
      function (listener: () => void) { return scope.subscribe(listener) },
      function () { return scope.getSnapshot() },
    )
    const value = normalized(snapshot.value)
    const [draft, setDraft] = React.useState(function () { return value })
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const dirty = !sameSettings(draft, value)
    const valid = validDraft(draft)
    const editable = snapshot.status === 'ready' && snapshot.writable && !saving

    React.useEffect(function () {
      if (!dirty && !saving && snapshot.status === 'ready') setDraft(normalized(snapshot.value))
    }, [snapshot.revision, snapshot.status, dirty, saving])

    function change(field: string, nextValue: unknown) {
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
        for (let index = 0; index < FIELDS.length; index += 1) {
          const field = FIELDS[index]
          if (!Object.is(draft[field as keyof SettingsValue], value[field as keyof SettingsValue])) {
            await scope.set(field, draft[field as keyof SettingsValue])
          }
        }
        const accepted = normalized(scope.getSnapshot().value)
        if (!sameSettings(accepted, draft)) throw new Error(t('saveNotApplied'))
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      } finally {
        setSaving(false)
      }
    }

    // 离开页面即卸载,草稿随组件状态丢弃(官方约定:只有保存才写入)。
    return h('div', { style: formStyle, 'data-zhipu-config': '' },
      snapshot.status === 'loading'
        ? h('p', { style: styles.status }, t('loading'))
        : snapshot.status !== 'ready'
          ? h('p', { style: styles.status }, t('unavailable'))
          : h(React.Fragment, null,
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
                  disabled: !editable || !dirty || !valid,
                  style: Object.assign({}, styles.primaryButton, controlDisabledStyle(!editable || !dirty || !valid)),
                  onClick: function () { void save() },
                }, saving ? t('saving') : t('save')))))
  }
}

function apply(ctx: any): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  // DSH 0.1.7 起 settings 命名空间退役,配置值改挂在插件行 config 上;
  // 客户端经 configForms 服务按入口 id(profile 行 id,与旧命名空间同名)
  // 取 ConfigForm:snapshot/subscribe/set 面与旧 settingsScope 同构。
  const configForms = ctx.configForms
  const scope = configForms !== undefined && configForms !== null && typeof configForms.get === 'function'
    ? configForms.get(SETTINGS_NAMESPACE)
    : undefined
  const ConfigPage = scope === undefined ? undefined : createForm(scope, t)
  ctx.effect(function () {
    return ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
  }, 'dsh-zhipu: settings dictionaries')
  // 插件页组合包页面:键必须是 profile 里本包的 npm 包名(见
  // plugins.bundle.config 槽位契约);读写走 configForms(行 config)。
  if (ConfigPage !== undefined) {
    ctx.slots.inject('plugins.bundle.config', function () {
      return ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_PACKAGE_NAME,
        locale: LOCALE_NAMESPACE,
      }, ConfigPage)
    })
  } else {
    console.warn('[dsh-zhipu] configForms 服务不可用,设置卡片未注册')
  }
}

export const inject = ['slots', 'locale', 'connection', 'configForms']
export { apply }
