// CLI 顶层常量与共享类型。
export const PKG = 'deepseek-harness-zhipu_plan_tools'

/** dsh-zh 的包名:在场时其 manifest reconcile 提供热挂载通道。 */
export const DSH_ZH_PKG = 'deepseek-harness-zh_pro'

// 行 id 与标记(与 host 侧 src/constants.ts 各自独立定义——CLI 与 host 不
// 共享模块;两侧必须同步,tests/patch-row.test.mts 有对齐断言)。
export const BUNDLE_ROW_ID = 'dsh-zhipu'
export const HOT_ROW_ID = 'dsh-zhipu-hot'
export const BRIDGE_ROW_ID = 'dsh-zhipu-bridge'
export const ROW_BEGIN = '# dsh-zhipu:begin'
export const ROW_END = '# dsh-zhipu:end'

export const WINDOWS_COMMAND_ENV = 'DSH_ZHIPU_COMMAND_JSON'
const WINDOWS_COMMAND_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  `$raw = $env:${WINDOWS_COMMAND_ENV}`,
  `Remove-Item Env:${WINDOWS_COMMAND_ENV} -ErrorAction SilentlyContinue`,
  '$payload = ConvertFrom-Json -InputObject $raw',
  '$command = [string]$payload.command',
  '$commandArgs = @($payload.args)',
  '& $command @commandArgs',
  '$succeeded = $?',
  '$exitCode = $LASTEXITCODE',
  'if ($null -ne $exitCode) { exit $exitCode }',
  'if (-not $succeeded) { exit 127 }',
].join('; ')
export const WINDOWS_COMMAND_ENCODED: string = Buffer.from(WINDOWS_COMMAND_SCRIPT, 'utf16le').toString('base64')

/** spawn 选项的最小形状(spawnSync 兼容)。 */
export interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: 'ignore' | 'inherit' | 'pipe'
}

/** spawnSync 结果的最小形状。 */
export interface SpawnResult {
  status: number | null
  error?: NodeJS.ErrnoException
}

/** 一次 dsh CLI 调用方式。 */
export interface DshInvocation {
  file: string
  viaNode: boolean
}

/** CLI 参数解析结果。 */
export interface ParsedCliArgs {
  profile: string
  link: string | null
  port: number
  rest: string[]
}

/** profile package.json 的最小形状。 */
export interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}
