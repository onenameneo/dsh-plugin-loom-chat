// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CanvasSessionWindow } from '../src/client/CanvasSessionWindow.js'
import type { CanvasSessionWindowSnapshot } from '../src/client/controller.js'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { en } from '../src/client/locales.js'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>) => {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as never

function windowSnapshot(overrides: Partial<CanvasSessionWindowSnapshot> = {}): CanvasSessionWindowSnapshot {
  return {
    id: 'root' as SessionId,
    title: 'Root session',
    parentId: undefined,
    depth: 0,
    x: 0,
    y: 0,
    running: false,
    pending: false,
    completed: true,
    blank: false,
    updatedAt: 0,
    selected: true,
    canBranch: true,
    error: null,
    session: {
      getSnapshot: () => ({
        chat: {
          nodes: new Map([
            ['u1', { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'What should I build?' }] }],
            ['a1', { kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'Build a live Canvas window.' }] }],
          ]),
        },
        nodes: [],
        turnEnds: new Map([[1, 2]]),
        running: false,
        openState: 'open' as const,
      }),
      subscribe: vi.fn(() => () => {}),
      cancel: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
      open: vi.fn(async () => {}),
    } as never,
    input: {
      setDraft: vi.fn(),
      submit: vi.fn(),
      state: {
        getSnapshot: () => ({ draft: '', phase: 'plain' as const }),
        subscribe: vi.fn(() => () => {}),
      },
    } as never,
    inputState: { draft: '', phase: 'plain' },
    ...overrides,
  }
}

describe('CanvasSessionWindow', () => {
  it('renders projected history and submits only through its own input face', () => {
    const snapshot = windowSnapshot()
    const onDraft = vi.fn()
    const onSend = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={snapshot}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={onDraft}
        onSend={onSend}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('What should I build?')).toBeTruthy()
    expect(ui.getByText('Build a live Canvas window.')).toBeTruthy()
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'continue here' } })
    ui.rerender(
      <CanvasSessionWindow
        window={windowSnapshot({ inputState: { draft: 'continue here', phase: 'plain' } })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={onDraft}
        onSend={onSend}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(ui.getByRole('button', { name: 'Send' }))

    expect(onDraft).toHaveBeenCalledWith('root', 'continue here')
    expect(onSend).toHaveBeenCalledWith('root')
  })

  it('opens a detached Canvas session so its native conversation can load', () => {
    const open = vi.fn(async () => {})
    const session = windowSnapshot().session as never as {
      getSnapshot: () => Record<string, unknown>
      open: () => Promise<void>
    }
    const snapshot = windowSnapshot({
      session: {
        ...session,
        getSnapshot: () => ({ ...session.getSnapshot(), openState: 'cold' }),
        open,
      } as never,
    })
    render(
      <CanvasSessionWindow
        window={snapshot}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(open).toHaveBeenCalledOnce()
  })

  it('shows stop for a running window and does not expose a send action', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ running: true, inputState: { draft: '', phase: 'submitting' } as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(ui.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('keeps the window header focused on the title without generic chrome', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ completed: false })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.queryByText('Session')).toBeNull()
    expect(ui.container.querySelector('[class*="windowDot"]')).toBeNull()
  })

  it('shows only the selection reference and keeps its composer empty', () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: '引用：selected answer',
          inputState: { draft: '', phase: 'plain' },
        })}
        onSelect={vi.fn()}
        onOpen={onOpen}
        onDelete={onDelete}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('引用：selected answer')).toBeTruthy()
    expect(ui.queryByText('What should I build?')).toBeNull()
    expect(ui.queryByText('Build a live Canvas window.')).toBeNull()
    expect((ui.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(ui.getByRole('button', { name: 'Chat' }))
    fireEvent.click(ui.getByRole('button', { name: 'Delete' }))
    fireEvent.click(ui.getByRole('button', { name: 'Confirm delete' }))
    expect(onOpen).toHaveBeenCalledWith('root')
    expect(onDelete).toHaveBeenCalledWith('root')
  })

  it('keeps the selection reference inside the padded transcript when the host renderer is available', () => {
    const renderSessionSlot = vi.fn((key: string) => <div data-testid={key} />)
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: '引用：selected answer',
          inputState: { draft: '', phase: 'plain' },
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        renderSessionSlot={renderSessionSlot}
        t={t}
      />,
    )

    const transcript = ui.container.querySelector('[class*="windowTranscript"]')
    expect(transcript).toBeTruthy()
    expect(transcript?.className).not.toContain('nativeTranscript')
    expect(ui.getByText('引用：selected answer')).toBeTruthy()
  })

  it('switches a continued selection branch to the host session view after its fork boundary', () => {
    const renderSessionSlot = vi.fn((key: string, _sessionId: SessionId, owner: object) => (
      <div data-testid={key === 'conversation.session' ? 'native-session' : 'native-composer'} data-owner={JSON.stringify(owner)} />
    ))
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: '引用：selected answer',
          branchAtSeq: 12,
          branchContinued: true,
          inputState: { draft: '', phase: 'plain' },
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        renderSessionSlot={renderSessionSlot}
        t={t}
      />,
    )

    expect(ui.getByText('引用：selected answer')).toBeTruthy()
    expect(ui.getByTestId('native-session')).toBeTruthy()
    expect(renderSessionSlot).toHaveBeenCalledWith('conversation.session', 'root', { variant: 'canvas', afterSeq: 12 })
    const transcript = ui.container.querySelector('[class*="windowTranscript"]')
    expect(transcript).toBeTruthy()
    expect(transcript?.className).toContain('referenceScrollTranscript')
  })

  it('uses the host composer for the window session when the renderer provides it', () => {
    const renderSessionSlot = vi.fn((key: string, sessionId: SessionId, owner: object) => (
      <div data-testid={key === 'conversation.composer.full' ? 'native-composer' : 'native-session'}>{key}:{sessionId}:{String((owner as { variant?: string }).variant)}</div>
    ))
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        renderSessionSlot={renderSessionSlot}
        t={t}
      />,
    )

    expect(ui.getByTestId('native-composer').textContent).toBe('conversation.composer.full:root:composer')
    expect(ui.queryByRole('textbox')).toBeNull()
    expect(renderSessionSlot).toHaveBeenCalledWith(
      'conversation.composer.full',
      'root',
      { variant: 'composer' },
    )
  })

  it('uses the host session view for message rendering when available', () => {
    const renderSessionSlot = vi.fn((key: string) => (
      <div data-testid={key === 'conversation.session' ? 'native-session' : 'native-composer'}>{key}</div>
    ))
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        renderSessionSlot={renderSessionSlot}
        t={t}
      />,
    )

    expect(ui.getByTestId('native-session').textContent).toBe('conversation.session')
    expect(ui.container.querySelector('[data-canvas-density="compact"]')).not.toBeNull()
    expect(ui.queryByText('What should I build?')).toBeNull()
    expect(renderSessionSlot).toHaveBeenCalledWith('conversation.session', 'root', { variant: 'canvas' })
  })

  it('does not render a branch action in the window header', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.queryByRole('button', { name: /branch/i })).toBeNull()
  })

  it('does not switch to chat mode when the Canvas window is double-clicked', () => {
    const onOpen = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={onOpen}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    fireEvent.doubleClick(ui.container.querySelector('article')!)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('requires confirmation before deleting a Canvas window', () => {
    const onDelete = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={onDelete}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    fireEvent.click(ui.getByRole('button', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(ui.getByRole('button', { name: 'Confirm delete' })).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith('root')
  })
})
