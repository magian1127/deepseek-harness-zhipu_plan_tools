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

test('极简 agent 创建与预设切换时 deny 全局 github_* 工具,非极简仍只装 web_search 阴影', () => {
  const regs = { shadowRegister: 0, shadowDispose: 0, deny: 0, denyDispose: 0 }
  const listeners = new Map<string, (payload: unknown) => void>()
  const fiberDisposers: Disposer[] = []

  function makeAgentCtx(kind: 'plain' | 'minimal'): HostContext {
    return {
      get(name: string): unknown {
        if (name === 'tools') {
          if (kind === 'minimal') {
            return {
              restrict: (filter: { deny: readonly string[] }) => {
                regs.deny++
                return () => { regs.denyDispose++ }
              },
            }
          }
          return {
            register: () => {
              regs.shadowRegister++
              return () => { regs.shadowDispose++ }
            },
          }
        }
        if (name === 'web') return { search: async () => ({ sources: [], truncated: false }) }
        if (name === 'systemPrompt') return { section: () => () => {} }
        return undefined
      },
      on: () => () => {},
      effect: () => () => {},
      inject: () => () => {},
    }
  }
  const plainAgent = { ctx: makeAgentCtx('plain') }
  const minimalAgent = { ctx: makeAgentCtx('minimal') }

  const rootTools = {
    register: () => () => {},
    get: (name: string, target?: unknown) => name === 'web_search' && target === plainAgent ? { name } : undefined,
  }
  const rootCtx: HostContext = {
    get(name: string): unknown {
      if (name === 'web') return { registerSearchProvider: () => () => {}, registerFetchProvider: () => () => {} }
      if (name === 'tools') return rootTools
      if (name === 'systemPrompt') return { section: () => () => {} }
      if (name === 'agents') return { list: () => [plainAgent, minimalAgent] }
      if (name === 'agentPresets') {
        return { composedPreset: (arg: unknown) => (arg === minimalAgent.ctx ? 'minimal' : undefined) }
      }
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

  apply(rootCtx, { search: true, zread: true, enabled: true })
  // 初始 refresh:普通 agent 装阴影一次,极简 agent deny 一次(zread 开启)。
  assert.equal(regs.shadowRegister, 1)
  assert.equal(regs.deny, 1)

  for (const dispose of fiberDisposers.splice(0).reverse()) dispose()
})

test('zread 关闭时极简 agent 不 deny 也不抛错(search 保持阴影语义)', () => {
  let shadowRegister = 0
  let deny = 0
  const listeners = new Map<string, (payload: unknown) => void>()
  const fiberDisposers: Disposer[] = []

  const minimalAgent = {
    ctx: {
      get(name: string): unknown {
        if (name === 'tools') {
          return {
            restrict: (filter: { deny: readonly string[] }) => {
              deny++
              return () => {}
            },
          }
        }
        if (name === 'web') return { search: async () => ({ sources: [], truncated: false }) }
        return undefined
      },
      on: () => () => {},
      effect: () => () => {},
      inject: () => () => {},
    },
  }
  const plainAgent = {
    ctx: {
      get(name: string): unknown {
        if (name === 'tools') {
          return {
            register: () => {
              shadowRegister++
              return () => {}
            },
          }
        }
        if (name === 'web') return { search: async () => ({ sources: [], truncated: false }) }
        return undefined
      },
      on: () => () => {},
      effect: () => () => {},
      inject: () => () => {},
    },
  }
  const rootTools = {
    register: () => () => {},
    get: (name: string, target?: unknown) => name === 'web_search' && target === plainAgent ? { name } : undefined,
  }
  const rootCtx: HostContext = {
    get(name: string): unknown {
      if (name === 'web') return { registerSearchProvider: () => () => {}, registerFetchProvider: () => () => {} }
      if (name === 'tools') return rootTools
      if (name === 'systemPrompt') return { section: () => () => {} }
      if (name === 'agents') return { list: () => [plainAgent, minimalAgent] }
      if (name === 'agentPresets') {
        return { composedPreset: (arg: unknown) => (arg === minimalAgent.ctx ? 'minimal' : undefined) }
      }
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

  // zread 关闭:极简 agent 既不 deny 也不抛错;普通 agent 阴影照常。
  apply(rootCtx, { search: true, zread: false, enabled: true })
  assert.equal(deny, 0)
  assert.equal(shadowRegister, 1)

  for (const dispose of fiberDisposers.splice(0).reverse()) dispose()
})
