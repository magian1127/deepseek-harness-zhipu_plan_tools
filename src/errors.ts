/**
 * 稳定错误类型:与官方 HarnessError(@deepseek-ai/dsh-llm)的运行时形状
 * 同构 —— `name`、`code`、`cause`。零依赖、不继承官方类;message 携带
 * message 携带 `[CODE]` 前缀,保证失败类别对模型、日志与排查可见(沿 ZhiPu_web_search
 * 的约定,官方工具层按 instanceof HarnessError 提取结构化信息,本包以
 * 形状同构兜底)。
 */

/** web 侧错误码:语义与官方 @deepseek-ai/dsh-web 的 WebError 对齐。 */
export const WEB_ABORTED_CODE = 'WEB_ABORTED'
export const WEB_PROVIDER_ERROR_CODE = 'WEB_PROVIDER_ERROR'
export const WEB_PROVIDER_CREDENTIAL_MISSING_CODE = 'WEB_PROVIDER_CREDENTIAL_MISSING'

/** 本插件自有错误码(工具侧 / 通用)。 */
export const ZHIPU_ABORTED_CODE = 'ZHIPU_ABORTED'
export const ZHIPU_PROVIDER_ERROR_CODE = 'ZHIPU_PROVIDER_ERROR'

/** 智谱 MCP 上游内容安全检查拒绝请求。 */
export const ZHIPU_CONTENT_FILTERED_CODE = 'ZHIPU_CONTENT_FILTERED'
export const ZHIPU_CREDENTIAL_MISSING_CODE = 'ZHIPU_CREDENTIAL_MISSING'
export const ZHIPU_DISABLED_CODE = 'ZHIPU_DISABLED'

/** 形状同构官方 HarnessError 的错误类型。 */
export class ZhipuError extends Error {
  /** Stable machine-routable failure class; route on this, never by parsing message. */
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ZhipuError'
    this.code = code
  }
}

/** True for a fetch/AbortError,按官方约定归类为取消。 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
}

/** 把一次传输/解析失败归类:已中止 → *_ABORTED,否则 → providerError。 */
export function transportError(
  scope: 'web' | 'tool',
  error: unknown,
  signal: AbortSignal | undefined,
  context: string,
): ZhipuError {
  if (signal?.aborted === true || isAbortError(error)) {
    return abortedError(scope, signal, error)
  }
  const message = error instanceof Error ? error.message : String(error)
  const code = scope === 'web' ? WEB_PROVIDER_ERROR_CODE : ZHIPU_PROVIDER_ERROR_CODE
  return new ZhipuError(`[${code}] ${context}: ${message}`, code, { cause: error })
}

/** 构造稳定的取消错误,保留调用方的中止原因。 */
export function abortedError(
  scope: 'web' | 'tool',
  signal?: AbortSignal,
  fallback?: unknown,
): ZhipuError {
  const code = scope === 'web' ? WEB_ABORTED_CODE : ZHIPU_ABORTED_CODE
  return new ZhipuError(`[${code}] 智谱调用已中止`, code, {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
