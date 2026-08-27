import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import type { Disposer, HostContext } from '../types.js'

test('web_search 只在继承视图可见时阴影,并随 Agent 生命周期清理', () => {
  let inheritedVisible = true
  let toolRegistrations = 0
  let toolDisposals = 0
  let promptRegistrations = 0
  let promptDisposals = 0
  const listeners = new Map<string, (payload: unknown) => void>()
  const fiberDisposers: Disposer[] = []

  const agentCtx: HostContext = {
    get(name: string): unknown {
      if (name === 'tools') {
        return {
          register: () => {
            toolRegistrations++
            return () => { toolDisposals++ }
          },
        }
      }
      if (name === 'web') return { search: async () => ({ sources: [], truncated: false }) }
      if (name === 'systemPrompt') {
        return {
          section: () => {
            promptRegistrations++
            return () => { promptDisposals++ }
          },
        }
      }
      return undefined
    },
    on: () => () => {},
    effect: () => () => {},
    inject: () => () => {},
  }
  const agent = { ctx: agentCtx }

  const web = {
    registerSearchProvider: () => () => {},
    registerFetchProvider: () => () => {},
  }
  const rootTools = {
    register: () => () => {},
    get: (name: string, target?: unknown) => inheritedVisible && name === 'web_search' && target === agent ? { name } : undefined,
  }
  let rootCtx: HostContext
  rootCtx = {
    get(name: string): unknown {
      if (name === 'web') return web
      if (name === 'tools') return rootTools
      if (name === 'systemPrompt') return { section: () => () => {} }
      if (name === 'agents') return { list: () => [agent] }
      return undefined
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    },
    effect(setup) {
      const dispose = setup()
      if (typeof dispose === 'function') fiberDisposers.push(dispose)
      return () => {}
    },
    inject: () => () => {},
  }

  apply(rootCtx, { search: true })
  assert.equal(toolRegistrations, 1)
  assert.equal(promptRegistrations, 1)

  listeners.get('agent/disposed')?.({ agent })
  assert.equal(toolDisposals, 1)
  assert.equal(promptDisposals, 1)

  inheritedVisible = false
  listeners.get('agent/created')?.({ agent })
  assert.equal(toolRegistrations, 1)
  assert.equal(promptRegistrations, 1)

  for (const dispose of fiberDisposers.splice(0).reverse()) dispose()
})
