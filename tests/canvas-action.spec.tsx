// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LoomCanvasAction } from '../src/client/LoomCanvasAction.js'
import type { LoomChatSnapshot } from '../src/client/controller.js'
import { en } from '../src/client/locales.js'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as never
const neverHook = (() => { throw new Error('test hook must not run') }) as never

function snapshot(mode: LoomChatSnapshot['mode']): LoomChatSnapshot {
  return {
    mode,
    currentSessionId: 'main' as SessionId,
    selectedSessionId: 'main' as SessionId,
    nodes: [{
      id: 'main' as SessionId, title: 'Main', parentId: undefined, depth: 0, x: 0, y: 0,
      running: false, pending: false, completed: false, blank: false, updatedAt: 0,
      selected: true, canBranch: true, error: null,
    }],
    windows: [],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
    selection: { target: null, rect: null, pending: false, error: null },
  }
}

describe('LoomCanvasAction', () => {
  it('opens Canvas from the native session header', () => {
    const openCanvas = vi.fn()
    const ui = render(
      <LoomCanvasAction
        sessionId={'main' as SessionId}
        useSession={neverHook}
        useConversation={neverHook}
        useChat={neverHook}
        useSessionPendingInteraction={neverHook}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useLoom={select => select(snapshot('session'))}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openCanvas={openCanvas}
        t={t}
      />,
    )

    expect(ui.container.querySelector('[data-loom-canvas-icon]')).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: 'Open Loom canvas' }))
    expect(openCanvas).toHaveBeenCalledOnce()
  })

  it('hides while Canvas already owns the workspace', () => {
    const ui = render(
      <LoomCanvasAction
        sessionId={'main' as SessionId}
        useSession={neverHook}
        useConversation={neverHook}
        useChat={neverHook}
        useSessionPendingInteraction={neverHook}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useLoom={select => select(snapshot('canvas'))}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openCanvas={vi.fn()}
        t={t}
      />,
    )

    expect(ui.queryByRole('button', { name: 'Open Loom canvas' })).toBeNull()
  })

  it('does not crash while the Loom snapshot is still initializing', () => {
    const ui = render(
      <LoomCanvasAction
        sessionId={'main' as SessionId}
        useSession={neverHook}
        useConversation={neverHook}
        useChat={neverHook}
        useSessionPendingInteraction={neverHook}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useLoom={select => select(undefined as never)}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openCanvas={vi.fn()}
        t={t}
      />,
    )

    expect(ui.queryByRole('button', { name: 'Open Loom canvas' })).toBeNull()
  })
})
