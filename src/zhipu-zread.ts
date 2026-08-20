/**
 * 智谱开源仓库(zread)工具 —— 3 个模型工具注册(defineTool 形状)。
 *
 * 工具名带 github_ 前缀(评审决策):github_search_doc /
 * github_get_repo_structure / github_read_file,与内置工具零冲突。
 * 开关可干净装卸:register 返回 disposer,settings watch 动态增删;
 * 工具本身无副作用(isConcurrencySafe),60s 协作超时对齐 dsh-mcp-client。
 */
import { ZREAD_MCP_URL, ZREAD_TOOL_TIMEOUT_MS } from './constants.js'
import { resolveApiKey } from './credentials.js'
import { ZHIPU_PROVIDER_ERROR_CODE, ZhipuError } from './errors.js'
import { callMcpTool, contentText } from './mcp-http.js'
import type { Disposer, HostContext, ToolDefinitionShape, ToolsService } from './types.js'
import type { ZhipuSettings } from './settings-schema.js'
import type { SettingsGetter } from './zhipu-search.js'

/** zread 参数校验:repo_name 必须是 owner/repo。 */
const REPO_NAME_PATTERN = /^[\w.-]+\/[\w.-]+$/

function parseRepoName(value: unknown): string {
  const repo = typeof value === 'string' ? value.trim() : ''
  if (!REPO_NAME_PATTERN.test(repo)) {
    throw new Error(`repo_name must look like "owner/repo" (got: ${JSON.stringify(String(value ?? ''))})`)
  }
  return repo
}

function parseNonEmpty(name: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0) throw new Error(`${name} must be a non-empty string`)
  return text
}

/** zread 工具的输出契约:单个 text 字段(标准 JSON Schema,required 在顶层)。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
} as const

/** 调用 zread MCP 并把 content 文本块合并为单字符串。 */
async function runZread(
  ctx: HostContext,
  getSettings: SettingsGetter,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const settings = getSettings()
  if (!settings.enabled || !settings.zread) {
    throw new ZhipuError(`[ZHIPU_DISABLED] 仓库工具已被设置停用(设置 → 插件设置 → ${'开源仓库'})`, 'ZHIPU_DISABLED')
  }
  const apiKey = await resolveApiKey(ctx, settings.credentialRef, 'tool', signal)
  const result = await callMcpTool(ZREAD_MCP_URL, apiKey, tool, args, signal, { timeoutMs: ZREAD_TOOL_TIMEOUT_MS })
  const text = contentText(result)
  if (text.length === 0) {
    throw new ZhipuError(`[${ZHIPU_PROVIDER_ERROR_CODE}] 智谱 ${tool} 返回空内容`, ZHIPU_PROVIDER_ERROR_CODE)
  }
  return text
}

/** 单个工具的完整定义(parameters 必须是 JSON Schema 形态(顶层 type/properties/
 * required)——官方工具经 defineTool 规范化后的产物形状;裸 schemastery 简写
 * 直接注册会导致调用层解析不出参数,模型调用始终收到空参数)。 */
function defineZreadTool(
  ctx: HostContext,
  getSettings: SettingsGetter,
  spec: {
    name: string
    description: string
    mcpTool: string
    properties: Record<string, unknown>
    required: string[]
    parse: (args: any) => { mcpArgs: Record<string, unknown>; title: string; rawInput: string }
  },
): ToolDefinitionShape {
  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: spec.required,
      properties: spec.properties,
    } as unknown as Record<string, unknown>,
    output: {
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      render: (_args: unknown, value: any) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    timeoutMs: ZREAD_TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args: unknown) => {
      const parsed = spec.parse(args)
      return { card: 'generic', title: parsed.title, kind: 'fetch', rawInput: parsed.rawInput }
    },
    async execute(args: unknown, exec: { signal?: AbortSignal }) {
      const { mcpArgs } = spec.parse(args)
      const text = await runZread(ctx, getSettings, spec.mcpTool, mcpArgs, exec.signal)
      return { text }
    },
  }
}

/**
 * 注册 3 个 github_* 工具。幂等:重名注册失败时跳过(双行并存兜底)。
 * @returns 卸载函数;tools 服务缺失时返回 undefined。
 */
export function installZhipuZreadTools(ctx: HostContext, getSettings: SettingsGetter): Disposer | undefined {
  const tools = ctx.get('tools') as ToolsService | undefined | null
  if (tools === undefined || tools === null) return undefined

  const definitions = [
    defineZreadTool(ctx, getSettings, {
      name: 'github_search_doc',
      description: 'Search documentation, issues, and commits of a GitHub repository. repo_name must be "owner/repo" (e.g. "vitejs/vite"), never a bare repo name. query is the search keywords or question. language is optional: "zh" or "en".',
      mcpTool: 'search_doc',
      properties: {
        repo_name: { type: 'string', description: 'GitHub repository: owner/repo (e.g. "vitejs/vite").' },
        query: { type: 'string', description: 'The search keywords or question about the repository.' },
        language: { type: 'string', description: "Result language: 'zh' or 'en' (choose according to context language)." },
      },
      required: ['repo_name', 'query'],
      parse: (args: any) => {
        const repoName = parseRepoName(args?.repo_name)
        const query = parseNonEmpty('query', args?.query)
        const language = typeof args?.language === 'string' && args.language.trim().length > 0 ? args.language.trim() : undefined
        return {
          mcpArgs: {
            repo_name: repoName,
            query,
            ...(language === undefined ? {} : { language }),
          },
          title: `${repoName}: ${query}`,
          rawInput: `${repoName} ${query}`,
        }
      },
    }),
    defineZreadTool(ctx, getSettings, {
      name: 'github_get_repo_structure',
      description: 'List the directory structure and file list of a GitHub repository. repo_name must be "owner/repo" (e.g. "vitejs/vite"). dir_path is the directory to inspect (default root "/").',
      mcpTool: 'get_repo_structure',
      properties: {
        repo_name: { type: 'string', description: 'GitHub repository: owner/repo (e.g. "vitejs/vite").' },
        dir_path: { type: 'string', description: 'The directory path to inspect (default: root "/").' },
      },
      required: ['repo_name'],
      parse: (args: any) => {
        const repoName = parseRepoName(args?.repo_name)
        const dirPath = typeof args?.dir_path === 'string' && args.dir_path.trim().length > 0 ? args.dir_path.trim() : undefined
        return {
          mcpArgs: {
            repo_name: repoName,
            ...(dirPath === undefined ? {} : { dir_path: dirPath }),
          },
          title: `${repoName} structure`,
          rawInput: dirPath === undefined ? repoName : `${repoName} ${dirPath}`,
        }
      },
    }),
    defineZreadTool(ctx, getSettings, {
      name: 'github_read_file',
      description: 'Read the full content of one file in a GitHub repository. repo_name must be "owner/repo" (e.g. "vitejs/vite"). file_path is the file path relative to the repository root (e.g. "src/index.ts").',
      mcpTool: 'read_file',
      properties: {
        repo_name: { type: 'string', description: 'GitHub repository: owner/repo (e.g. "vitejs/vite").' },
        file_path: { type: 'string', description: 'The relative path of the file (e.g. "src/index.ts").' },
      },
      required: ['repo_name', 'file_path'],
      parse: (args: any) => {
        const repoName = parseRepoName(args?.repo_name)
        const filePath = parseNonEmpty('file_path', args?.file_path)
        return {
          mcpArgs: { repo_name: repoName, file_path: filePath },
          title: `${repoName}/${filePath}`,
          rawInput: `${repoName} ${filePath}`,
        }
      },
    }),
  ]

  const disposers: Array<() => void> = []
  for (const definition of definitions) {
    try {
      disposers.push(tools.register(definition))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already registered|duplicate/i.test(message)) throw error
      // 幂等:已注册(双行并存)时跳过,由已注册实例承担。
    }
  }
  return () => { for (const dispose of disposers) dispose() }
}
