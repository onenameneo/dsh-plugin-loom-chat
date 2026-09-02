// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionFace, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LoomChatController } from '../src/client/controller.js'

afterEach(() => { vi.restoreAllMocks() })

function session(id: string, turnEnds: ReadonlyMap<number, number> = new Map([[1, 12]])): SessionFace {
  const snapshot = {
    sessionId: id as SessionId,
    chat: { nodes: new Map() },
    nodes: [],
    turnEnds,
    running: false,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
    cancel: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
  } as never
}

function listState(current: string, ids: string[]): SessionListState {
  return {
    current: current as SessionId,
    ids: ids as SessionId[],
    byId: Object.fromEntries(ids.map(id => [id, {
      id: id as SessionId,
      displayTitle: id,
      running: false,
      blank: false,
      updatedAt: Number(id.length),
    }])) as SessionListState['byId'],
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function sessionsFixture(): ISessions & { state: { value: SessionListState } } {
  const state = { value: listState('root', ['root', 'child']) }
  const root = session('root')
  const child = session('child')
  const bindings = new Map<SessionId, SessionFace>([
    ['root' as SessionId, root], ['child' as SessionId, child],
  ])
  const list = {
    getSnapshot: () => state.value,
    subscribe: vi.fn(() => () => {}),
  }
  return {
    state,
    list,
    binding: (id: SessionId) => {
      const value = bindings.get(id)
      return value === undefined ? undefined : { sessionId: id, session: value, ctx: undefined as never }
    },
    open: vi.fn(),
    fork: vi.fn(async () => 'child-2' as SessionId),
  } as never
}

describe('LoomChatController Canvas flow', () => {
  it('keeps one live input window per session and targets send/stop by session id', () => {
    const sessions = sessionsFixture()
    const inputs = new Map<string, {
      setDraft: ReturnType<typeof vi.fn>
      submit: ReturnType<typeof vi.fn>
      state: { getSnapshot: () => { draft: string; phase: 'plain' }; subscribe: (listener: () => void) => () => void }
    }>([
      ['root', { setDraft: vi.fn(), submit: vi.fn(), state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} } }],
      ['child', { setDraft: vi.fn(), submit: vi.fn(), state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} } }],
    ])
    const controller = new LoomChatController(sessions, id => inputs.get(String(id)) as never)

    controller.openCanvas()
    expect(controller.getSnapshot().windows.map(window => window.id)).toEqual(['root', 'child'])
    controller.selectNode('child' as SessionId)
    controller.sendSession('child' as SessionId, 'continue here')
    void controller.cancelSession('child' as SessionId)

    expect(sessions.open).not.toHaveBeenCalled()
    expect(inputs.get('child')?.setDraft).toHaveBeenCalledWith('continue here')
    expect(inputs.get('child')?.submit).toHaveBeenCalled()
    expect(sessions.binding('child' as SessionId)?.session.cancel).toHaveBeenCalled()
    controller.dispose()
  })

  it('clears the submitted draft after the input face accepts it', () => {
    const sessions = sessionsFixture()
    let draft = 'send this from Canvas'
    const input = {
      setDraft: vi.fn((text: string) => { draft = text }),
      submit: vi.fn(),
      state: {
        getSnapshot: () => ({ draft, phase: 'plain' as const }),
        subscribe: () => () => {},
      },
    }
    const controller = new LoomChatController(sessions, () => input as never)

    controller.openCanvas()
    controller.sendSession('root' as SessionId)

    expect(input.submit).toHaveBeenCalledOnce()
    expect(input.setDraft).toHaveBeenLastCalledWith('')
    expect(draft).toBe('')
    controller.dispose()
  })

  it('synchronizes a Canvas draft through the ordinary input face', () => {
    const sessions = sessionsFixture()
    const input = {
      setDraft: vi.fn(),
      submit: vi.fn(),
      state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} },
    }
    const controller = new LoomChatController(sessions, () => input as never)

    controller.openCanvas()
    controller.setDraft('root' as SessionId, 'canvas-only draft')

    expect(input.setDraft).toHaveBeenCalledWith('canvas-only draft')
    controller.dispose()
  })

  it('hydrates cold detached sessions through public staging and restores the current session', async () => {
    const sessions = sessionsFixture()
    const coldSnapshot = {
      sessionId: 'child' as SessionId,
      chat: { nodes: new Map() },
      nodes: [],
      turnEnds: new Map([[1, 12]]),
      running: false,
      openState: 'cold' as 'cold' | 'open',
    }
    const coldSession = {
      getSnapshot: () => coldSnapshot,
      subscribe: vi.fn(() => () => {}),
    } as never as SessionFace
    const rootSession = sessions.binding('root' as SessionId)?.session
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id,
      session: id === 'child' ? coldSession : rootSession,
      ctx: undefined,
    })
    ;(sessions.open as ReturnType<typeof vi.fn>).mockImplementation((id: SessionId) => {
      sessions.state.value.current = id
      if (id === 'child') coldSnapshot.openState = 'open'
    })
    const controller = new LoomChatController(sessions)

    controller.openCanvas()
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(sessions.open).toHaveBeenNthCalledWith(1, 'child')
    expect(sessions.open).toHaveBeenNthCalledWith(2, 'root')
    expect(sessions.state.value.current).toBe('root')
    expect(controller.getSnapshot().windows.find(window => window.id === 'child')?.session).toBe(coldSession)
    controller.dispose()
  })

  it('opens cold sessions through the bound Session face without changing native selection', async () => {
    const sessions = sessionsFixture()
    const coldSnapshot = {
      sessionId: 'child' as SessionId,
      chat: { nodes: new Map() },
      nodes: [],
      turnEnds: new Map([[1, 12]]),
      running: false,
      openState: 'cold' as 'cold' | 'open',
    }
    const open = vi.fn(async () => { coldSnapshot.openState = 'open' })
    const coldSession = {
      getSnapshot: () => coldSnapshot,
      subscribe: vi.fn(() => () => {}),
      open,
    } as never as SessionFace
    const rootSession = sessions.binding('root' as SessionId)?.session
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id,
      session: id === 'child' ? coldSession : rootSession,
      ctx: undefined,
    })
    const controller = new LoomChatController(sessions)

    controller.openCanvas()
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(open).toHaveBeenCalledOnce()
    expect(sessions.open).not.toHaveBeenCalled()
    expect(sessions.state.value.current).toBe('root')
    controller.dispose()
  })

  it('hydrates a cold session that appears after Canvas has already opened', async () => {
    const sessions = sessionsFixture()
    let notifyList = (): void => {}
    ;(sessions.list as never as { subscribe: (listener: () => void) => () => void }).subscribe = (listener) => {
      notifyList = listener
      return () => {}
    }
    const childSnapshot = {
      sessionId: 'child' as SessionId,
      chat: { nodes: new Map() },
      nodes: [],
      turnEnds: new Map([[1, 12]]),
      running: false,
      openState: 'cold' as 'cold' | 'open',
    }
    const childSession = {
      getSnapshot: () => childSnapshot,
      subscribe: vi.fn(() => () => {}),
    } as never as SessionFace
    const rootSession = sessions.binding('root' as SessionId)?.session
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id,
      session: id === 'child' ? childSession : rootSession,
      ctx: undefined,
    })
    const controller = new LoomChatController(sessions)

    sessions.state.value.ids = ['root'] as SessionId[]
    controller.openCanvas()
    sessions.state.value.ids = ['root', 'child'] as SessionId[]
    notifyList()
    ;(sessions.open as ReturnType<typeof vi.fn>).mockImplementation((id: SessionId) => {
      sessions.state.value.current = id
      if (id === 'child') childSnapshot.openState = 'open'
    })
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(sessions.open).toHaveBeenCalledWith('child')
    expect(childSnapshot.openState).toBe('open')
    controller.dispose()
  })

  it('keeps a failed submit error attached to its own Canvas window', () => {
    const sessions = sessionsFixture()
    const inputs = new Map<string, {
      setDraft: ReturnType<typeof vi.fn>
      submit: ReturnType<typeof vi.fn>
      state: { getSnapshot: () => { draft: string; phase: 'plain' }; subscribe: () => () => void }
    }>([
      ['root', { setDraft: vi.fn(), submit: vi.fn(), state: { getSnapshot: () => ({ draft: '', phase: 'plain' as const }), subscribe: () => () => {} } }],
      ['child', { setDraft: vi.fn(), submit: vi.fn(() => { throw new Error('child submit failed') }), state: { getSnapshot: () => ({ draft: 'retry', phase: 'plain' as const }), subscribe: () => () => {} } }],
    ])
    const controller = new LoomChatController(sessions, id => inputs.get(String(id)) as never)

    controller.openCanvas()
    controller.sendSession('child' as SessionId)

    expect(controller.getSnapshot().windows.find(window => window.id === 'child')?.error).toBe('child submit failed')
    expect(controller.getSnapshot().windows.find(window => window.id === 'root')?.error).toBeNull()
    controller.dispose()
  })

  it('switches from native session mode to Canvas and preserves the viewport', () => {
    const sessions = sessionsFixture()
    const controller = new LoomChatController(sessions)

    expect(controller.getSnapshot().mode).toBe('session')
    controller.openCanvas()
    controller.setViewport({ x: -120, y: 48, scale: 1.25 })

    expect(controller.getSnapshot()).toMatchObject({
      mode: 'canvas',
      viewport: { x: -120, y: 48, scale: 1.25 },
      selectedSessionId: 'root',
    })
    controller.openSession('child' as SessionId)
    expect(sessions.open).toHaveBeenCalledWith('child')
    expect(controller.getSnapshot().mode).toBe('session')
    controller.openCanvas()
    expect(controller.getSnapshot().viewport).toEqual({ x: -120, y: 48, scale: 1.25 })
    controller.dispose()
  })

  it('closes Canvas back to the session that opened it, not the selected node', () => {
    const sessions = sessionsFixture()
    const controller = new LoomChatController(sessions)

    controller.openCanvas()
    controller.selectNode('child' as SessionId)
    ;(controller as unknown as { closeCanvas: () => void }).closeCanvas()

    expect(sessions.open).toHaveBeenCalledWith('root')
    expect(controller.getSnapshot().mode).toBe('session')
    controller.dispose()
  })

  it('branches from the selected node at its latest stable boundary and focuses the child in Canvas', async () => {
    const sessions = sessionsFixture()
    const child = session('child')
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id,
      session: id === 'child-2' ? child : session(String(id)),
      ctx: undefined,
    })
    const controller = new LoomChatController(sessions)
    controller.openCanvas()
    controller.selectNode('root' as SessionId)

    await controller.branchSelected()

    expect(sessions.fork).toHaveBeenCalledWith({ sessionId: 'root', atSeq: 12, increaseTitle: true })
    expect(sessions.open).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'canvas', selectedSessionId: 'child-2' })
    controller.dispose()
  })

  it('centers a newly visible branch window without changing the durable child transcript', async () => {
    const sessions = sessionsFixture()
    const child = session('child-2')
    let notifyList = (): void => {}
    const state = sessions.state
    state.value.byId['child-2' as SessionId] = {
      id: 'child-2' as SessionId,
      parentId: 'root' as SessionId,
      displayTitle: 'child-2',
      running: false,
      blank: false,
      updatedAt: 3,
    }
    const originalIds = state.value.ids
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id,
      session: id === 'child-2' ? child : session(String(id)),
      ctx: undefined,
    })
    ;(sessions.list as never as { subscribe: (listener: () => void) => () => void }).subscribe = (listener) => {
      notifyList = listener
      return () => {}
    }
    const controller = new LoomChatController(sessions)
    controller.openCanvas()
    ;(sessions.fork as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      state.value.ids = [...originalIds, 'child-2' as SessionId]
      notifyList()
      return 'child-2' as SessionId
    })

    await controller.branchSession('root' as SessionId)

    expect(controller.getSnapshot()).toMatchObject({ mode: 'canvas', selectedSessionId: 'child-2' })
    expect(controller.getSnapshot().viewport.scale).toBe(1)
    expect(controller.getSnapshot().windows.find(window => window.id === 'child-2')).toBeDefined()
    controller.dispose()
  })

  it('branches from a visible window without opening the child natively', async () => {
    const sessions = sessionsFixture()
    const controller = new LoomChatController(sessions)
    controller.openCanvas()

    await controller.branchSession('child' as SessionId)

    expect(sessions.fork).toHaveBeenCalledWith({ sessionId: 'child', atSeq: 12, increaseTitle: true })
    expect(sessions.open).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'canvas', selectedSessionId: 'child-2' })
    controller.dispose()
  })

  it('archives a selected session together with its descendants and keeps unrelated nodes', async () => {
    const sessions = sessionsFixture()
    sessions.state.value.ids = ['root', 'child', 'sibling'] as SessionId[]
    sessions.state.value.byId['child' as SessionId] = {
      ...sessions.state.value.byId['child' as SessionId]!, parentId: 'root' as SessionId,
    }
    sessions.state.value.byId['sibling' as SessionId] = {
      id: 'sibling' as SessionId, displayTitle: 'sibling', running: false, blank: false, updatedAt: 3,
    }
    ;(sessions as never as { binding: (id: SessionId) => unknown }).binding = (id: SessionId) => ({
      sessionId: id, session: session(String(id)), ctx: undefined,
    })
    const archived: SessionId[] = []
    const workspaces = {
      list: { getSnapshot: () => ({ archivedSessionIds: [] }), subscribe: () => () => {} },
      archiveSession: vi.fn(async (id: SessionId) => { archived.push(id) }),
    }
    const controller = new LoomChatController(sessions, undefined, workspaces as never)
    controller.openCanvas()

    await controller.deleteSession('root' as SessionId)

    expect(archived).toEqual(['root', 'child'])
    expect(controller.getSnapshot().nodes.map(node => node.id)).toEqual(['sibling'])
    controller.dispose()
  })

  it('keeps a failed archive subtree visible and exposes the failure on its node', async () => {
    const sessions = sessionsFixture()
    const workspaces = {
      list: { getSnapshot: () => ({ archivedSessionIds: [] }), subscribe: () => () => {} },
      archiveSession: vi.fn(async (id: SessionId) => {
        if (id === 'root') throw new Error('archive denied')
      }),
    }
    const controller = new LoomChatController(sessions, undefined, workspaces as never)
    controller.openCanvas()

    await expect(controller.deleteSession('root' as SessionId)).rejects.toThrow('archive denied')
    expect(controller.getSnapshot().nodes.find(node => node.id === 'root')).toMatchObject({ error: 'archive denied' })
    controller.dispose()
  })
})
