/**
 * 小工具:abortable 竞速(与官方 DeepSeek provider 的 `abortable` 同构)。
 */

/**
 * 让一个不配合取消的本地 Promise 对调用方中止信号响应:已中止立即拒绝;
 * 否则竞速,并保留处理器避免迟到的 rejection 变成 unhandled。
 */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** 智谱搜索/读取结果里常见的"字符串化的 JSON 字符串"双层编码:剥到对象。 */
export function parseMaybeDoubleEncoded(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed === 'string') {
    try {
      return JSON.parse(parsed)
    } catch {
      return parsed
    }
  }
  return parsed
}
