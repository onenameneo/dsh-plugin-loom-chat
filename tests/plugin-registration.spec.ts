// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { apply } from '../src/client/index.js'

afterEach(() => { vi.restoreAllMocks() })

function listState(): SessionListState {
  return {
    current: undefined,
    ids: [],
    byId: {},
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('plugin registration lifecycle', () => {
  it('registers all three released UI slot contributions and disposes them with the controller', () => {
    const registrations: string[] = []
    const cleanups: Array<() => void> = []
    const sessions = {
      list: { getSnapshot: listState, subscribe: () => () => {} },
      binding: () => undefined,
      scope: () => undefined,
      open: vi.fn(),
      clear: vi.fn(),
    }
    const ctx = {
      sessions,
      conversation: { input: { for: vi.fn(() => undefined) } },
      locale: { register: vi.fn() },
      slots: {
        inject: (_name: string, register: () => unknown) => { register(); return vi.fn() },
        register: (descriptor: { name: string }) => { registrations.push(descriptor.name); return vi.fn() },
      },
      effect: (effect: () => (() => void) | undefined) => {
        const cleanup = effect()
        if (cleanup !== undefined) cleanups.push(cleanup)
      },
    } as never

    apply(ctx)

    expect(registrations).toEqual([
      'conversation.chat.assistant-actions',
      'conversation.session.header.actions',
      'shell.overlay',
    ])
    expect(cleanups).toHaveLength(1)
    cleanups[0]?.()
  })

  it('resolves Canvas input from the stable session binding context', () => {
    const bindingContext = { name: 'detached-session-context' }
    const input = {
      setDraft: vi.fn(),
      state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} },
    }
    const inputFor = vi.fn(() => input)
    let notifyList = (): void => {}
    let loom: { getSnapshot: () => { windows?: Array<{ input?: unknown }> } } | undefined
    const triggerFor = vi.fn(() => ({
      lexicon: { getSnapshot: () => new Map(), subscribe: () => () => {} },
    }))
    const session = {
      getSnapshot: () => ({ chat: { nodes: new Map() }, nodes: [], turnEnds: new Map([[1, 1]]), running: false }),
      subscribe: () => () => {},
    }
    const sessions = {
      list: {
        getSnapshot: () => ({
          current: 'detached' as never,
          ids: ['detached' as never],
          byId: { detached: { id: 'detached', displayTitle: 'Detached', running: false, blank: false, updatedAt: 1 } },
          phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
        }),
        subscribe: (listener: () => void) => { notifyList = listener; return () => {} },
      },
      binding: vi.fn(() => ({ sessionId: 'detached', session, ctx: bindingContext })),
      scope: vi.fn(() => undefined),
      subagentAddress: () => undefined,
      open: vi.fn(),
      clear: vi.fn(),
    }
    const descriptors: Array<{ name: string }> = []
    const cleanup: Array<() => void> = []
    const ctx = {
      sessions,
      conversation: { input: { for: inputFor } },
      inputTriggers: { sessionOf: triggerFor },
      modelDirectories: {
        directoryFor: () => ({
          store: { getSnapshot: () => ({}), subscribe: () => () => {} },
          load: vi.fn(async () => {}),
          select: vi.fn(async () => {}),
        }),
      },
      locale: { register: vi.fn() },
      slots: {
        inject: (_name: string, register: () => unknown) => { register(); return vi.fn() },
        register: (descriptor: { name: string; inject?: () => unknown }) => {
          descriptors.push(descriptor)
          if (descriptor.name === 'shell.overlay') {
            const value = descriptor.inject?.() as { hooks?: { loom?: typeof loom } } | undefined
            loom = value?.hooks?.loom
          }
          return vi.fn()
        },
      },
      effect: (effect: () => (() => void) | undefined) => {
        const disposer = effect()
        if (disposer !== undefined) cleanup.push(disposer)
      },
    } as never

    apply(ctx)

    expect(inputFor).toHaveBeenCalledWith(bindingContext)
    expect(triggerFor).toHaveBeenCalledWith(bindingContext)
    expect(sessions.scope).not.toHaveBeenCalled()
    const firstInput = loom?.getSnapshot().windows?.[0]?.input
    notifyList()
    const secondInput = loom?.getSnapshot().windows?.[0]?.input
    expect(secondInput).toBe(firstInput)
    cleanup[0]?.()
  })

  it('adapts hosts that expose input mutations under actions', () => {
    const setDraft = vi.fn()
    const rawInput = {
      state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} },
      actions: { setDraft },
    }
    let resolved: { setDraft(text: string, editRange?: { start: number; end: number; insertedLength: number }): void } | undefined
    const session = {
      getSnapshot: () => ({ chat: { nodes: new Map() }, nodes: [], turnEnds: new Map([[1, 1]]), running: false }),
      subscribe: () => () => {},
    }
    const sessions = {
      list: {
        getSnapshot: () => ({
          current: 'actions-host' as never,
          ids: ['actions-host' as never],
          byId: { 'actions-host': { id: 'actions-host', displayTitle: 'Actions host', running: false, blank: false, updatedAt: 1 } },
          phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
        }),
        subscribe: () => () => {},
      },
      binding: () => ({ sessionId: 'actions-host', session, ctx: {} }),
      scope: vi.fn(() => undefined),
      subagentAddress: () => undefined,
      open: vi.fn(),
      clear: vi.fn(),
    }
    const ctx = {
      sessions,
      conversation: { input: { for: vi.fn(() => rawInput) } },
      inputTriggers: { sessionOf: () => undefined },
      modelDirectories: {
        directoryFor: () => ({
          store: { getSnapshot: () => ({}), subscribe: () => () => {} },
          load: vi.fn(async () => {}),
          select: vi.fn(async () => {}),
        }),
      },
      locale: { register: vi.fn() },
      slots: {
        inject: (_name: string, register: () => unknown) => { register(); return vi.fn() },
        register: (descriptor: { name: string; inject?: () => unknown }) => {
          if (descriptor.name === 'shell.overlay') {
            const value = descriptor.inject?.() as { hooks?: { loom?: { getSnapshot(): { windows?: Array<{ input?: typeof resolved }> } } } } | undefined
            resolved = value?.hooks?.loom?.getSnapshot().windows?.[0]?.input
          }
          return vi.fn()
        },
      },
      effect: (effect: () => (() => void) | undefined) => { effect() },
    } as never

    apply(ctx)

    expect(resolved).toBeDefined()
    resolved?.setDraft('works with actions')
    expect(setDraft).toHaveBeenCalledWith('works with actions', undefined)
  })
})
