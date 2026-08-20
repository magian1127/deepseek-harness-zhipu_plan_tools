// 真实 API 冒烟(不入 DSH 进程):用假 ctx + 真实凭据直调三个模块。
// 用法:node scripts/smoke-live.mjs;验证后删除或保留手动使用。
const { installZhipuSearchProvider } = await import('../lib/zhipu-search.js')
const { installZhipuReaderProvider } = await import('../lib/zhipu-reader.js')
const { installZhipuZreadTools } = await import('../lib/zhipu-zread.js')
const { normalizeSettings } = await import('../lib/settings-schema.js')

let current = normalizeSettings({})

const webProviders = []
const webMock = {
  registerSearchProvider: (p) => { webProviders.push(p); return () => {} },
  registerFetchProvider: (p) => { webProviders.push(p); return () => {} },
}
const registeredTools = []
const toolsMock = { register: (t) => { registeredTools.push(t); return () => {} } }

const fakeCtx = {
  get(name) {
    if (name === 'credentials') return { resolve: async () => undefined } // 走 env/文件回退
    if (name === 'web') return webMock
    if (name === 'tools') return toolsMock
    return undefined
  },
  on: () => () => {},
  effect: () => () => {},
}

installZhipuSearchProvider(fakeCtx, () => current)
installZhipuReaderProvider(fakeCtx, () => current)
installZhipuZreadTools(fakeCtx, () => current)

console.log('providers:', webProviders.map((p) => p.id).join(', '))
console.log('tools:', registeredTools.map((t) => t.name).join(', '))
console.log('available(search):', webProviders[0].available())

let failures = 0
async function step(label, fn) {
  try {
    await fn()
    console.log(`[smoke] PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`[smoke] FAIL ${label}: ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`)
  }
}

await step('search: web_search_prime 真实查询', async () => {
  const result = await webProviders[0].search({ query: '智谱 GLM Coding Plan', maxResults: 3 })
  if (result.sources.length === 0) throw new Error('no sources')
  console.log(`  sources=${result.sources.length} first=${result.sources[0].url}`)
})

await step('reader: webReader 真实抓取', async () => {
  const result = await webProviders[1].fetch({ url: 'https://docs.bigmodel.cn/cn/coding-plan/mcp/zread-mcp-server' })
  console.log(`  status=${result.statusCode} kind=${result.body.kind} chars=${result.body.content.length} truncated=${result.truncated}`)
  console.log(`  head: ${result.body.content.slice(0, 80).replace(/\s+/g, ' ')}`)
  if (result.body.kind !== 'text' || result.body.content.length < 500) throw new Error('unexpected body')
})

await step('zread: github_search_doc 真实查询', async () => {
  const tool = registeredTools.find((t) => t.name === 'github_search_doc')
  const result = await tool.execute({ repo_name: 'vuejs/core', query: 'reactivity system overview', language: 'en' }, {})
  if (!result || typeof result.text !== 'string' || result.text.length < 100) throw new Error('unexpected result')
  console.log(`  text chars=${result.text.length} head: ${result.text.slice(0, 80).replace(/\s+/g, ' ')}`)
})

await step('zread: github_get_repo_structure 真实调用', async () => {
  const tool = registeredTools.find((t) => t.name === 'github_get_repo_structure')
  const result = await tool.execute({ repo_name: 'vuejs/core' }, {})
  console.log(`  text chars=${result.text.length}`)
})

await step('settings 停用语义:zread=false 时工具报 ZHIPU_DISABLED', async () => {
  current = normalizeSettings({ zread: false })
  const tool = registeredTools.find((t) => t.name === 'github_read_file')
  try {
    await tool.execute({ repo_name: 'vuejs/core', file_path: 'package.json' }, {})
    throw new Error('should have thrown')
  } catch (error) {
    if (error.code !== 'ZHIPU_DISABLED') throw error
    console.log('  disabled error code ok')
  } finally {
    current = normalizeSettings({})
  }
})

process.exit(failures > 0 ? 1 : 0)
