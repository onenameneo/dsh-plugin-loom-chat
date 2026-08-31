// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LoomBranchAction } from '../src/client/LoomBranchAction.js'
import type { LoomChatSnapshot } from '../src/client/controller.js'
import { en } from '../src/client/locales.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Tooltip: ({ side, children }: { side?: string; children: ReactNode }) => (
    <div data-tooltip-side={side}>{children}</div>
  ),
}))

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as never
const neverHook = (() => { throw new Error('test hook must not run') }) as never

function snapshot(nodes: LoomChatSnapshot['nodes']): LoomChatSnapshot {
  return {
    mode: 'session',
    currentSessionId: 'main' as SessionId,
    selectedSessionId: 'main' as SessionId,
    nodes,
    windows: [],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
    selection: { target: null, rect: null, pending: false, error: null },
  }
}

const useSession = (select: (value: never) => unknown) => select({
  nodes: [{ kind: 'assistant', messageId: 'message-1', seq: 11 }],
} as never)

const useUninitializedSession = (select: (value: never) => unknown) => select({} as never)
const useChatSnapshot = (select: (value: never) => unknown) => select({
  chat: { nodes: { values: () => [{
    kind: 'assistant-step',
    data: { finalNode: { messageId: 'message-1', seq: 11 } },
  }] } },
} as never)

describe('LoomBranchAction', () => {
  it('renders beside the ordinary branch action and forks the addressed message into Loom', () => {
    const forkAt = vi.fn(async () => {})
    const ui = render(
      <LoomBranchAction
        sessionId={'main' as SessionId}
        messageId={'message-1' as never}
        useSession={useSession as never}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useLoom={select => select(snapshot([{
          id: 'main' as SessionId, title: 'Main', parentId: undefined, depth: 0, x: 0, y: 0,
          running: false, pending: false, completed: false, blank: false, updatedAt: 0,
          selected: true, canBranch: true, error: null,
        }]))}
        forkAt={forkAt}
        t={t}
      />,
    )

    expect(ui.container.querySelector('[data-tooltip-side]')?.getAttribute('data-tooltip-side')).toBe('top')
    expect(ui.container.querySelector('[data-loom-canvas-icon]')).not.toBeNull()
    fireEvent.click(ui.getByRole('button', { name: 'Branch into Loom Chat' }))
    expect(forkAt).toHaveBeenCalledWith('main', 11)
  })

  it('does not add an action for a session hidden from the ordinary Canvas graph', () => {
    const ui = render(
      <LoomBranchAction
        sessionId={'subagent-1' as SessionId}
        messageId={'message-1' as never}
        useSession={useSession as never}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useLoom={select => select(snapshot([]))}
        forkAt={vi.fn(async () => {})}
        t={t}
      />,
    )

    expect(ui.queryByRole('button', { name: 'Branch into Loom Chat' })).toBeNull()
  })

  it('does not crash while the session snapshot is still initializing', () => {
    const ui = render(
      <LoomBranchAction
        sessionId={'main' as SessionId}
        messageId={'message-1' as never}
        useSession={useUninitializedSession as never}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useLoom={select => select(snapshot([{
          id: 'main' as SessionId, title: 'Main', parentId: undefined, depth: 0, x: 0, y: 0,
          running: false, pending: false, completed: false, blank: false, updatedAt: 0,
          selected: true, canBranch: false, error: null,
        }]))}
        forkAt={vi.fn(async () => {})}
        t={t}
      />,
    )

    expect(ui.queryByRole('button', { name: 'Branch into Loom Chat' })).toBeNull()
  })

  it('reads assistant nodes from the current Chat snapshot when legacy nodes are absent', () => {
    const forkAt = vi.fn(async () => {})
    const ui = render(
      <LoomBranchAction
        sessionId={'main' as SessionId}
        messageId={'message-1' as never}
        useSession={useChatSnapshot as never}
        useProjection={neverHook}
        useInput={neverHook}
        inputActions={neverHook}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        useLoom={select => select(snapshot([{
          id: 'main' as SessionId, title: 'Main', parentId: undefined, depth: 0, x: 0, y: 0,
          running: false, pending: false, completed: false, blank: false, updatedAt: 0,
          selected: true, canBranch: true, error: null,
        }]))}
        forkAt={forkAt}
        t={t}
      />,
    )

    expect(ui.getByRole('button', { name: 'Branch into Loom Chat' })).toBeTruthy()
  })
})
