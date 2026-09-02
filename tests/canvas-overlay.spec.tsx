// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { CanvasOverlay, CanvasSurface } from '../src/client/CanvasOverlay.js'
import type { CanvasNodeSnapshot, CanvasSessionWindowSnapshot, CanvasViewport } from '../src/client/controller.js'
import type { LoomChatSnapshot } from '../src/client/controller.js'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en } from '../src/client/locales.js'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>) => {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as never

function node(id: string, overrides: Partial<CanvasNodeSnapshot> = {}): CanvasNodeSnapshot {
  return {
    id: id as SessionId,
    title: id,
    parentId: undefined,
    depth: 0,
    x: 0,
    y: 0,
    running: false,
    pending: false,
    completed: false,
    blank: false,
    updatedAt: 0,
    selected: false,
    canBranch: true,
    error: null,
    ...overrides,
  }
}

const viewport: CanvasViewport = { x: 0, y: 0, scale: 1 }

function windowSnapshot(value: CanvasNodeSnapshot): CanvasSessionWindowSnapshot {
  return {
    ...value,
    session: {
      getSnapshot: () => ({
        chat: {
          nodes: new Map([
            ['assistant', { kind: 'assistant', seq: 7, blocks: [{ kind: 'text', text: 'Canvas answer' }] }],
          ]),
        },
      }),
      subscribe: vi.fn(() => () => {}),
    } as never,
    input: undefined,
    inputState: undefined,
  }
}

describe('CanvasSurface', () => {
  it('passes the assistant branch action through the Canvas surface', () => {
    const onBranch = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={viewport}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={onBranch}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )

    fireEvent.click(ui.getByRole('button', { name: 'Branch into Loom Chat' }))
    expect(onBranch).toHaveBeenCalledWith('root', 7)
  })

  it('renders lineage nodes and edges in a full-workspace surface', () => {
    const ui = render(
      <CanvasSurface
        nodes={[node('root'), node('child', { parentId: 'root' as SessionId, depth: 1, x: 300, y: 0 })]}
        windows={[windowSnapshot(node('root')), windowSnapshot(node('child', { parentId: 'root' as SessionId, depth: 1, x: 300, y: 0 }))]}
        edges={[{ from: 'root' as SessionId, to: 'child' as SessionId }]}
        viewport={viewport}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByRole('heading', { name: 'Loom canvas' })).toBeTruthy()
    expect(ui.getByRole('article', { name: 'root' })).toBeTruthy()
    expect(ui.getByRole('article', { name: 'child' })).toBeTruthy()
    expect(ui.container.querySelector('svg')).toBeTruthy()
  })

  it('renders a minimap with every Canvas node and selects nodes from it', () => {
    const onSelect = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root'), node('child', { parentId: 'root' as SessionId, depth: 1, x: 580, y: 0 })]}
        windows={[windowSnapshot(node('root')), windowSnapshot(node('child', { parentId: 'root' as SessionId, depth: 1, x: 580, y: 0 }))]}
        edges={[{ from: 'root' as SessionId, to: 'child' as SessionId }]}
        viewport={viewport}
        onSelect={onSelect}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )

    expect(ui.container.querySelector('[data-canvas-overview]')).not.toBeNull()
    expect(ui.container.querySelectorAll('[data-minimap-node]')).toHaveLength(2)
    fireEvent.click(ui.container.querySelector('[data-minimap-node="child"]') as Element)
    expect(onSelect).toHaveBeenCalledWith('child')
  })

  it('updates the Canvas viewport continuously while dragging the minimap viewport', () => {
    const onViewport = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root'), node('child', { parentId: 'root' as SessionId, depth: 1, x: 580, y: 0 })]}
        windows={[windowSnapshot(node('root')), windowSnapshot(node('child', { parentId: 'root' as SessionId, depth: 1, x: 580, y: 0 }))]}
        edges={[{ from: 'root' as SessionId, to: 'child' as SessionId }]}
        viewport={viewport}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={onViewport}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )
    const viewportRect = ui.container.querySelector('[class*="minimapViewport"]') as Element

    fireEvent.pointerDown(viewportRect, { pointerId: 2, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(viewportRect, { pointerId: 2, clientX: 50, clientY: 44 })
    fireEvent.pointerMove(viewportRect, { pointerId: 2, clientX: 60, clientY: 48 })
    fireEvent.pointerUp(viewportRect, { pointerId: 2, clientX: 60, clientY: 48 })

    expect(onViewport).toHaveBeenCalledTimes(2)
    expect(onViewport.mock.calls[0]?.[0].x).not.toBe(viewport.x)
    expect(onViewport.mock.calls[1]?.[0].x).not.toBe(onViewport.mock.calls[0]?.[0].x)
  })

  it('selects nodes while keeping only the explicit Canvas close action', () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const onViewport = vi.fn()
    const onResetViewport = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root', { selected: true })]}
        windows={[windowSnapshot(node('root', { selected: true }))]}
        edges={[]}
        viewport={viewport}
        onSelect={onSelect}
        onOpen={onOpen}
        onClose={onClose}
        onDelete={onDelete}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={onViewport}
        onResetViewport={onResetViewport}
        t={t}
      />,
    )

    fireEvent.click(ui.getByRole('article', { name: 'root' }))
    const resetButton = ui.getByRole('button', { name: 'Reset view' })
    expect(resetButton.textContent).toBe('')
    fireEvent.click(resetButton)
    expect(ui.queryByRole('button', { name: 'Branch from selected' })).toBeNull()
    expect(ui.queryByRole('button', { name: 'Open session' })).toBeNull()
    fireEvent.click(ui.getByRole('button', { name: 'Return to session' }))
    fireEvent.wheel(ui.getByRole('article', { name: 'root' }).querySelector('[class*="windowTranscript"]') as HTMLElement, { deltaY: -100 })

    expect(onSelect).toHaveBeenCalledWith('root')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onResetViewport).toHaveBeenCalledOnce()
    expect(onViewport).not.toHaveBeenCalled()
  })

  it('keeps Canvas panning from starting native text selection', () => {
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={viewport}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )
    const surface = ui.container.querySelector('[class*="viewport"]') as HTMLElement
    const event = createEvent.pointerDown(surface, { pointerId: 1, clientX: 10, clientY: 10 })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    fireEvent(surface, event)
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('zooms on Canvas wheel without preventing a passive React wheel event', () => {
    const onViewport = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={{ x: 0, y: 0, scale: 1 }}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={onViewport}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )
    const surface = ui.container.querySelector('[class*="viewport"]') as HTMLElement
    const event = createEvent.wheel(surface, { deltaY: -100 })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    fireEvent(surface, event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onViewport).toHaveBeenCalledWith({ x: 0, y: 0, scale: 1.1 })
  })

  it('lets document-level popup handlers see pointerdowns inside a chat window', () => {
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={viewport}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )
    const listener = vi.fn()
    document.addEventListener('pointerdown', listener)
    try {
      fireEvent.pointerDown(ui.getByRole('article', { name: 'root' }))
      expect(listener).toHaveBeenCalledOnce()
    } finally {
      document.removeEventListener('pointerdown', listener)
    }
  })

  it('renders the selection action in viewport coordinates outside the scaled Canvas world', () => {
    const onForkSelection = vi.fn()
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={{ x: 20, y: 30, scale: 0.75 }}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onForkSelection={onForkSelection}
        selectionRect={{ left: 200, top: 220, width: 80, height: 20 }}
        selectionPending={false}
        selectionError={null}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )
    const world = ui.container.querySelector('[class*="world"]') as HTMLElement
    expect(world.querySelector('[data-loom-selection-menu]')).toBeNull()
    const anchor = ui.container.querySelector('[class*="sessionSelectionMenuAnchor"]') as HTMLElement
    expect(anchor.style.left).toBe('240px')
    expect(anchor.style.top).toBe('220px')
    const reference = ui.container.querySelector('[class*="selectionMenuReference"]') as HTMLElement
    expect(reference.style.width).toBe('0px')
    expect(reference.style.height).toBe('0px')
    const menuItem = ui.getByRole('menuitem', { name: 'Ask in branch' })
    expect(menuItem.querySelector('[data-loom-canvas-icon]')).not.toBeNull()
    fireEvent.click(menuItem)
    expect(onForkSelection).toHaveBeenCalledOnce()
  })

  it('keeps default fixed tooltips out of transformed Canvas ancestors', () => {
    const ui = render(
      <CanvasSurface
        nodes={[node('root')]}
        windows={[windowSnapshot(node('root'))]}
        edges={[]}
        viewport={{ x: 20, y: 30, scale: 0.75 }}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={vi.fn()}
        onViewport={vi.fn()}
        onResetViewport={vi.fn()}
        t={t}
      />,
    )

    const world = ui.container.querySelector('[class*="world"]') as HTMLElement
    const windowPosition = ui.container.querySelector('[class*="windowPosition"]') as HTMLElement
    expect(world.style.transform).toBe('')
    expect(world.style.left).toBe('92px')
    expect(world.style.top).toBe('102px')
    expect(world.style.zoom).toBe('0.75')
    expect(windowPosition.style.transform).toBe('')
    expect(windowPosition.style.left).toBe('0px')
    expect(windowPosition.style.top).toBe('0px')
  })

  it('shows the selection branch action in native session mode', () => {
    const onForkSelection = vi.fn()
    const sessionSnapshot: LoomChatSnapshot = {
      mode: 'session',
      currentSessionId: 'root' as SessionId,
      selectedSessionId: 'root' as SessionId,
      nodes: [node('root')],
      windows: [],
      edges: [],
      viewport,
      selection: {
        target: { sessionId: 'root' as SessionId, nodeKey: 'assistant-11', atSeq: 11, text: 'selected answer' },
        rect: { left: 120, top: 220, width: 80, height: 20 },
        pending: false,
        error: null,
      },
    }
    const useLoom = ((select: (value: LoomChatSnapshot) => unknown) => select(sessionSnapshot)) as never
    const ui = render(
      <CanvasOverlay
        useLoom={useLoom}
        useSessions={vi.fn() as never}
        useSessionPendingInteraction={vi.fn() as never}
        useWorkspaces={vi.fn() as never}
        forkSelection={onForkSelection}
        branchSelected={vi.fn()}
        forkAt={vi.fn()}
        openSession={vi.fn()}
        closeCanvas={vi.fn()}
        deleteSession={vi.fn()}
        selectNode={vi.fn()}
        branchSession={vi.fn()}
        setViewport={vi.fn()}
        resetViewport={vi.fn()}
        setDraft={vi.fn()}
        sendSession={vi.fn()}
        cancelSession={vi.fn()}
        t={t}
      />,
    )

    const anchor = ui.container.querySelector('[class*="sessionSelectionMenuAnchor"]') as HTMLElement
    expect(anchor.style.left).toBe('160px')
    expect(anchor.style.top).toBe('220px')
    const reference = ui.container.querySelector('[class*="selectionMenuReference"]') as HTMLElement
    expect(reference.style.width).toBe('0px')
    expect(reference.style.height).toBe('0px')
    fireEvent.click(ui.getByRole('menuitem', { name: 'Ask in branch' }))
    expect(onForkSelection).toHaveBeenCalledOnce()
  })
})
