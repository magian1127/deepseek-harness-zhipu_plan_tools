import type { Disposer } from './types.js'

const MAX_RETRIES = 8
const RETRY_DELAY_MS = 25

/** 注册冲突时不伪造 disposer：等待旧 Fiber 释放后再有限次接管。 */
export function registerWithTakeover<T extends Disposer>(
  register: () => T,
  kind: string,
): Disposer {
  let owner: T | undefined
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let warned = false
  let attempts = 0

  const warn = (message: string): void => {
    if (warned) return
    warned = true
    console.warn(`[dsh-zhipu] ${message}`, { kind, attempts })
  }

  const attempt = (initial: boolean): void => {
    if (disposed || owner !== undefined) return
    attempts++
    try {
      owner = register()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already registered|duplicate/i.test(message)) {
        if (initial) throw error
        warn('registration failed during takeover')
        return
      }
      if (attempts < MAX_RETRIES) {
        timer = setTimeout(() => attempt(false), RETRY_DELAY_MS)
      } else {
        warn('duplicate registration; takeover retries exhausted')
      }
    }
  }

  attempt(true)

  
  if (owner === undefined && !warned) warn('duplicate registration; instance is not owner, retrying')

  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    const disposer = owner
    owner = undefined
    disposer?.()
  }
}
