// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { CanvasSessionWindow } from '../src/client/CanvasSessionWindow.js'
import type { CanvasSessionWindowSnapshot } from '../src/client/controller.js'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en } from '../src/client/locales.js'

afterEach(cleanup)

const jsdomRect = { left: 0, top: 0, right: 100, bottom: 24, width: 100, height: 24, x: 0, y: 0, toJSON: () => ({}) }
const elementRectDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
const rangeRectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', { configurable: true, value: () => jsdomRect })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => jsdomRect })
})

afterAll(() => {
  if (elementRectDescriptor === undefined) delete (Element.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  else Object.defineProperty(Element.prototype, 'getBoundingClientRect', elementRectDescriptor)
  if (rangeRectDescriptor === undefined) delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  else Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRectDescriptor)
})

const t = ((key: keyof typeof en, params?: Record<string, unknown>) => {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as never

async function setEditorText(element: HTMLElement, text: string): Promise<void> {
  await waitFor(() => expect(element.querySelector('p')).not.toBeNull())
  const paragraph = element.querySelector('p')
  if (paragraph === null) throw new Error('Expected a paragraph in the Canvas input')
  paragraph.textContent = text
  fireEvent.input(element, { bubbles: true, inputType: 'insertText', data: text })
}

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
  it('renders projected history and submits only through its own input face', async () => {
    let draft = ''
    let notifyInput: (() => void) | undefined
    const inputState = {
      getSnapshot: () => ({ draft, phase: 'plain' as const }),
      subscribe: (listener: () => void) => {
        notifyInput = listener
        return () => { notifyInput = undefined }
      },
    }
    const snapshot = windowSnapshot({
      input: {
        ...windowSnapshot().input!,
        state: inputState,
        setDraft: vi.fn((text: string) => {
          draft = text
          notifyInput?.()
        }),
      } as never,
    })
    const onDraft = vi.fn()
    const inputSetDraft = snapshot.input!.setDraft as unknown as (text: string) => void
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
    await setEditorText(ui.getByRole('textbox'), 'continue here')
    inputSetDraft('continue here')
    await waitFor(() => expect(ui.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(ui.getByRole('button', { name: 'Send' }))

    expect(draft).toBe('continue here')
    expect(inputSetDraft).toHaveBeenCalledWith('continue here')
    expect(onDraft).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledWith('root')
  })

  it('exposes Canvas selection flows and a Loom branch action for assistant messages', () => {
    const onBranch = vi.fn(async () => {})
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={onBranch}
        t={t}
      />,
    )

    const assistant = ui.container.querySelector('[data-chat-flow-kind="assistant-step"]')
    expect(assistant?.getAttribute('data-chat-flow-key')).toBe('a1')
    expect(assistant?.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
    fireEvent.click(ui.getByRole('button', { name: 'Branch into Loom Chat' }))
    expect(onBranch).toHaveBeenCalledWith('root', 2)
  })

  it('renders messages from current Chat nodes whose payload is under data', () => {
    const snapshot = windowSnapshot({
      session: {
        getSnapshot: () => ({
          chat: {
            order: ['a1', 'u1'],
            nodes: new Map([
              ['u1', {
                key: 'u1',
                kind: 'user',
                data: { content: [{ type: 'text', text: 'Current user prompt' }] },
              }],
              ['a1', {
                key: 'a1',
                kind: 'assistant-step',
                data: { blocks: [{ kind: 'text', text: 'Current assistant answer' }] },
              }],
            ]),
          },
          nodes: [],
        }),
        subscribe: vi.fn(() => () => {}),
      } as never,
    })

    const ui = render(
      <CanvasSessionWindow
        window={snapshot}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={vi.fn(async () => {})}
        t={t}
      />,
    )

    expect(ui.getByText('Current user prompt')).toBeTruthy()
    expect(ui.getByText('Current assistant answer')).toBeTruthy()
    const messages = [...ui.container.querySelectorAll('[data-chat-flow-kind]:not([data-chat-flow-kind="turn-tail"])')]
    expect(messages.map(message => message.textContent)).toEqual([
      expect.stringContaining('Current assistant answer'),
      expect.stringContaining('Current user prompt'),
    ])
  })

  it('renders injected context nodes in the Canvas conversation', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['context', 'user', 'assistant'],
                nodes: new Map([
                  ['context', {
                    key: 'context',
                    kind: 'context',
                    data: {
                      kind: 'context',
                      content: [{ type: 'text', text: 'injected system prompt' }],
                      source: { kind: 'dsh-system-prompt' },
                      provenance: { role: 'inject', label: '@deepseek-ai/dsh-system-prompt' },
                      form: null,
                    },
                  }],
                  ['user', { key: 'user', kind: 'user', data: { content: [{ type: 'text', text: 'real user message' }] } }],
                  ['assistant', { key: 'assistant', kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: 'real answer' }] } }],
                ]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('real user message')).toBeTruthy()
    expect(ui.getByText('real answer')).toBeTruthy()
    expect(ui.getByText('Context injection')).toBeTruthy()
    expect(ui.getByText('@deepseek-ai/dsh-system-prompt')).toBeTruthy()
    expect(ui.container.querySelector('[data-chat-flow-kind="context"]')).toBeTruthy()
  })

  it('renders system prompts and durable tool calls with their native rows', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['system', 'tool'],
                nodes: new Map([
                  ['system', {
                    key: 'system',
                    kind: 'system-prompt',
                    location: { kind: 'step', turn: 1, step: 1 },
                    data: { text: 'System instructions' },
                  }],
                  ['tool', {
                    key: 'tool',
                    kind: 'tool-call',
                    location: { kind: 'step', turn: 1, step: 2 },
                    data: {
                      root: {
                        kind: 'tool-result',
                        seq: 4,
                        time: 4,
                        callId: 'call-1',
                        call: { name: 'bash', argsRaw: '{"command":"pwd"}' },
                        callTime: 3,
                        content: [{ type: 'text', text: '/workspace' }],
                        isError: false,
                        subCalls: [],
                      },
                    },
                  }],
                ]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('System prompt')).toBeTruthy()
    expect(ui.getByText('Bash')).toBeTruthy()
    expect(ui.getByText('/workspace')).toBeTruthy()
    expect(ui.queryByText('Unknown message')).toBeNull()
  })

  it('hides the synthetic selection envelope from a continued branch message', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: 'selected answer',
          branchAtSeq: 1,
          branchContinued: true,
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['user'],
                nodes: new Map([['user', {
                  key: 'user',
                  kind: 'user',
                  seq: 2,
                  data: {
                    content: [{ type: 'text', text: '请针对下面选中的内容进行解释，并保留此前会话上下文：\n\n<selected-content>\nselected answer\n</selected-content>\n\ngreat job' }],
                  },
                }]]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('great job')).toBeTruthy()
    expect(ui.queryByText(/请针对下面选中的内容/)).toBeNull()
    expect(ui.queryByText(/<selected-content>/)).toBeNull()
  })

  it('renders legacy assistant blocks through the native fallback', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['assistant'],
                nodes: new Map([['assistant', {
                  kind: 'assistant-step',
                  data: {
                    blocks: [
                      { kind: 'markdown', text: 'first line\nsecond line' },
                      { kind: 'code', language: 'ts', code: 'const answer = 42' },
                      { kind: 'tool-call', name: 'search', status: 'done', args: { q: 'loom' } },
                      { kind: 'image', name: 'canvas.png' },
                    ],
                  },
                }]]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.container.querySelector('[data-block-kind="markdown"]')).toBeNull()
    expect(ui.getByText(/const answer = 42/)).toBeTruthy()
    expect(ui.getByText(/search/)).toBeTruthy()
    expect(ui.getByText(/canvas\.png/)).toBeTruthy()
    expect(ui.queryByText('Unknown block')).toBeNull()
    expect(ui.container.querySelector('[data-block-kind="code"]')).toBeNull()
    expect(ui.container.querySelector('[data-block-kind="tool"]')).toBeNull()
    expect(ui.container.querySelector('[data-block-kind="attachment"]')).toBeNull()
  })

  it('keeps legacy assistant blocks on the native streaming renderer', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          running: true,
          inputState: { draft: '', phase: 'submitting' },
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['assistant'],
                nodes: new Map([['assistant', {
                  key: 'assistant',
                  kind: 'assistant-step',
                  data: {
                    status: 'running',
                    blocks: [{ kind: 'markdown', text: '流式回答内容' }],
                  },
                }]]),
              },
              running: true,
              openState: 'open' as const,
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('流式回答内容')).toBeTruthy()
    expect(ui.container.querySelector('[data-streaming="true"]')).toBeTruthy()
    expect(ui.container.querySelector('[data-block-kind="markdown"]')).toBeNull()
  })

  it('renders the native streaming surface from a legacy partial snapshot', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          running: true,
          inputState: { draft: '', phase: 'submitting' },
          session: {
            getSnapshot: () => ({
              chat: {
                order: [],
                nodes: new Map(),
                legacy: {
                  partial: {
                    turn: 2,
                    step: 1,
                    blocks: [{ kind: 'text', text: 'partial streaming answer' }],
                  },
                },
              },
              running: true,
              openState: 'open' as const,
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('partial streaming answer')).toBeTruthy()
    expect(ui.getByText('Deep diving...')).toBeTruthy()
  })

  it('renders native message images through the plugin-owned Canvas slot', async () => {
    const resolveImage = vi.fn(async () => 'blob:canvas-image')
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          input: { ...windowSnapshot().input!, resolveImage } as never,
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['user'],
                nodes: new Map([['user', {
                  key: 'user',
                  kind: 'user',
                  data: {
                    content: [{ type: 'image', attachment: {
                      attachmentId: 'image-1', name: 'canvas.png', width: 100, height: 100,
                    } }],
                  },
                }]]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    await waitFor(() => expect(ui.getByRole('img', { name: 'canvas.png' }).getAttribute('src')).toBe('blob:canvas-image'))
    expect(resolveImage).toHaveBeenCalledOnce()
  })

  it('shows draft image attachments and routes removal through the session input face', () => {
    const removeImage = vi.fn()
    const attachment = { id: 'draft-1', file: { name: 'draft.png' }, previewUrl: 'blob:draft-image' }
    const input = windowSnapshot().input!
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          input: {
            ...input,
            removeImage,
            draftImages: () => [attachment],
            state: { getSnapshot: () => ({ draft: '', phase: 'plain', imageIds: ['draft-1'] }), subscribe: vi.fn(() => () => {}) },
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByRole('img', { name: 'draft.png' }).getAttribute('src')).toBe('blob:draft-image')
    fireEvent.click(ui.getByRole('button', { name: 'Remove draft.png' }))
    expect(removeImage).toHaveBeenCalledWith('draft-1')
  })

  it('keeps native-style message chrome in the plugin-owned renderer', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['assistant'],
                nodes: new Map([['assistant', {
                  kind: 'assistant-step',
                  data: { blocks: [
                    { kind: 'reasoning', text: 'checking the design' },
                    { kind: 'text', text: 'The answer is **ready**.' },
                  ] },
                }]]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={vi.fn(async () => {})}
        t={t}
      />,
    )

    expect(ui.getByText('Think')).toBeTruthy()
    expect(ui.getByLabelText('Copy')).toBeTruthy()
    expect(ui.getByLabelText('Branch')).toBeTruthy()
    expect(ui.getByText('DeepSeek')).toBeTruthy()
  })

  it('mounts the vendored DSH session surface for Canvas windows', () => {
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

    expect(ui.container.querySelector('[data-loom-native-session]')).toBeTruthy()
    expect(ui.container.querySelector('[data-dsh-chat-view]')).toBeTruthy()
    expect(ui.container.querySelector('[data-conversation-embedded]')).toBeTruthy()
    expect(ui.container.querySelector('[data-dsh-composer]')).toBeTruthy()
    expect(ui.container.querySelector('[data-dsh-stats-line]')).toBeTruthy()
    expect(ui.container.querySelector('[data-native-fallback-flow]')).toBeNull()
  })

  it('does not select the Canvas window again after a message text selection', () => {
    const onSelect = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={onSelect}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    const message = ui.getByText('Build a live Canvas window.')
    const range = document.createRange()
    range.selectNodeContents(message)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.click(message)

    expect(selection.toString()).toBe('Build a live Canvas window.')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('normalizes a legacy transcript when the keyed Chat store is not materialized', () => {
    const snapshot = windowSnapshot({
      session: {
        ...windowSnapshot().session!,
        getSnapshot: () => ({
          chat: { order: ['not-materialized'], nodes: new Map() },
          nodes: [{ kind: 'user', seq: 1, content: 'legacy user prompt' }],
          running: false,
          openState: 'open' as const,
        }),
      } as never,
    })
    const ui = render(
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

    expect(ui.getByText('legacy user prompt')).toBeTruthy()
    expect(ui.container.querySelector('[data-native-fallback-flow]')).toBeNull()
  })

  it('normalizes non-string keyed Chat order entries before rendering seats', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: {
            getSnapshot: () => ({
              chat: {
                order: [1, 2],
                nodes: new Map([
                  [1, { key: 1, kind: 'user', data: { content: [{ type: 'text', text: 'numeric user key' }] } }],
                  [2, { key: 2, kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: 'numeric assistant key' }] } }],
                ]),
              },
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('numeric user key')).toBeTruthy()
    expect(ui.getByText('numeric assistant key')).toBeTruthy()
    expect(ui.container.querySelector('[data-chat-flow-key="1"]')).toBeTruthy()
  })

  it('refreshes the composer from the input face when its draft changes', async () => {
    let currentInput = { draft: '', phase: 'plain' as const }
    let notifyInput: (() => void) | undefined
    const inputState = {
      getSnapshot: () => currentInput,
      subscribe: (listener: () => void) => {
        notifyInput = listener
        return () => { notifyInput = undefined }
      },
    }
    const snapshot = windowSnapshot({ inputState: currentInput, input: { ...windowSnapshot().input!, state: inputState } as never })
    const ui = render(
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

    currentInput = { draft: 'updated from machine', phase: 'plain' }
    act(() => { notifyInput?.() })

    await waitFor(() => expect((ui.getByRole('textbox') as HTMLElement).textContent).toBe('updated from machine'))
  })

  it('keeps Canvas typing controlled by the live input face across consecutive edits', () => {
    let currentInput = { draft: '', phase: 'plain' as const }
    let notifyInput: (() => void) | undefined
    const inputState = {
      getSnapshot: () => currentInput,
      subscribe: (listener: () => void) => {
        notifyInput = listener
        return () => { notifyInput = undefined }
      },
    }
    const input = {
      ...windowSnapshot().input!,
      state: inputState,
      setDraft: (draft: string) => {
        currentInput = { draft, phase: 'plain' }
        notifyInput?.()
      },
    }
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    const textbox = ui.getByRole('textbox') as HTMLElement

    input.setDraft('a')
    input.setDraft('ab')
    input.setDraft('')

    expect(textbox.textContent).toBe('')
    expect(currentInput.draft).toBe('')
  })

  it('synchronizes text typed in Canvas to the ordinary input face', async () => {
    let currentInput = { draft: '', phase: 'plain' as const }
    let notifyInput: (() => void) | undefined
    const input = {
      ...windowSnapshot().input!,
      state: {
        getSnapshot: () => currentInput,
        subscribe: (listener: () => void) => {
          notifyInput = listener
          return () => { notifyInput = undefined }
        },
      },
      setDraft: vi.fn((draft: string) => {
        currentInput = { draft, phase: 'plain' }
        notifyInput?.()
      }),
    }
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    const textbox = ui.getByRole('textbox') as HTMLElement

    await waitFor(() => expect(textbox.querySelector('p')).not.toBeNull())
    textbox.focus()
    const range = document.createRange()
    const paragraph = textbox.querySelector('p')!
    paragraph.textContent = 'typed once'
    range.selectNodeContents(paragraph.firstChild!)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    textbox.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'typed once' }))
    textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'typed once' }))

    await waitFor(() => expect(ui.getByRole('button', { name: 'Send' })).not.toHaveProperty('disabled', true))
    expect(input.setDraft).not.toHaveBeenCalled()
    fireEvent.blur(textbox)
    await waitFor(() => expect(input.setDraft).toHaveBeenCalledWith('typed once'))
    expect(currentInput.draft).toBe('typed once')
    expect(textbox.textContent).toBe('typed once')
  })

  it('keeps Canvas and ordinary composer drafts synchronized', async () => {
    let currentInput = { draft: '', phase: 'plain' as const }
    let notifyInput: (() => void) | undefined
    const input = {
      ...windowSnapshot().input!,
      state: {
        getSnapshot: () => currentInput,
        subscribe: (listener: () => void) => {
          notifyInput = listener
          return () => { notifyInput = undefined }
        },
      },
      setDraft: vi.fn((draft: string) => {
        currentInput = { draft, phase: 'plain' }
        notifyInput?.()
      }),
    }
    const onSend = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={onSend}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    const textbox = ui.getByRole('textbox') as HTMLElement

    await setEditorText(textbox, 'canvas draft')
    await waitFor(() => expect(textbox.textContent).toBe('canvas draft'))
    expect(input.setDraft).not.toHaveBeenCalled()
    await waitFor(() => expect(ui.getByRole('button', { name: 'Send' })).not.toHaveProperty('disabled', true))

    fireEvent.click(ui.getByRole('button', { name: 'Send' }))

    expect(input.setDraft).toHaveBeenCalledWith('canvas draft')
    expect(onSend).toHaveBeenCalledWith('root')
  })

  it('clears the Canvas editor after Enter dispatches the message', async () => {
    let draft = ''
    let notifyInput: (() => void) | undefined
    const input = {
      ...windowSnapshot().input!,
      state: {
        getSnapshot: () => ({ draft, phase: 'plain' as const }),
        subscribe: (listener: () => void) => {
          notifyInput = listener
          return () => { notifyInput = undefined }
        },
      },
      setDraft: vi.fn((text: string) => {
        draft = text
        notifyInput?.()
      }),
    }
    const onSend = vi.fn()
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={onSend}
        onCancel={vi.fn()}
        t={t}
      />,
    )
    const textbox = ui.getByRole('textbox') as HTMLElement

    await setEditorText(textbox, 'sent from Canvas')
    await waitFor(() => expect(ui.getByRole('button', { name: 'Send' })).not.toHaveProperty('disabled', true))
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', bubbles: true })

    expect(onSend).toHaveBeenCalledWith('root')
    await waitFor(() => expect(textbox.textContent).toBe(''))
  })

  it('reads the ordinary draft again when Canvas is reopened', async () => {
    let currentInput = { draft: '', phase: 'plain' as const }
    const input = {
      ...windowSnapshot().input!,
      state: {
        getSnapshot: () => currentInput,
        subscribe: () => () => {},
      },
      setDraft: vi.fn((draft: string) => { currentInput = { draft, phase: 'plain' } }),
    }
    const first = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    const firstTextbox = first.getByRole('textbox')
    firstTextbox.focus()
    await waitFor(() => expect(firstTextbox.querySelector('p')).not.toBeNull())
    firstTextbox.querySelector('p')!.textContent = 'canvas draft'
    firstTextbox.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'canvas draft' }))
    firstTextbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'canvas draft' }))
    await waitFor(() => expect(first.getByRole('button', { name: 'Send' })).not.toHaveProperty('disabled', true))
    first.unmount()
    await waitFor(() => expect(currentInput.draft).toBe('canvas draft'))
    input.setDraft('ordinary draft')

    const reopened = render(
      <CanvasSessionWindow
        window={windowSnapshot({ input: input as never })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    await waitFor(() => expect(reopened.getByRole('textbox').textContent).toBe('ordinary draft'))
  })

  it('does not keep the textarea read-only from a stale Canvas window phase', () => {
    const input = windowSnapshot().input!
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          inputState: { draft: '', phase: 'submitting' },
          input: {
            ...input,
            state: {
              getSnapshot: () => ({ draft: '', phase: 'plain' as const }),
              subscribe: () => () => {},
            },
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByRole('textbox').getAttribute('contenteditable')).toBe('true')
  })

  it('allows editing when a detached input phase is busy but the session has settled', async () => {
    let draft = ''
    let notifyInput: (() => void) | undefined
    const input = {
      ...windowSnapshot().input!,
      setDraft: vi.fn((text: string) => {
        draft = text
        notifyInput?.()
      }),
    }
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          inputState: { draft: '', phase: 'submitting' },
          input: {
            ...input,
            state: {
              getSnapshot: () => ({ draft, phase: 'submitting' as const }),
              subscribe: (listener: () => void) => {
                notifyInput = listener
                return () => { notifyInput = undefined }
              },
            },
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    const textbox = ui.getByRole('textbox') as HTMLElement
    expect(textbox.getAttribute('contenteditable')).toBe('true')
    input.setDraft('can type now')
    await waitFor(() => expect(draft).toBe('can type now'))
    expect(draft).toBe('can type now')
  })

  it('reflects a live transcript update for one Canvas window', () => {
    let current: unknown = { nodes: [{ kind: 'user', content: 'before update' }] }
    const snapshot = windowSnapshot({
      session: {
        getSnapshot: () => current,
        subscribe: vi.fn(() => () => {}),
      } as never,
    })
    const ui = render(
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

    expect(ui.getByText('before update')).toBeTruthy()
    current = { nodes: [{ kind: 'assistant', content: 'after update' }] }
    ui.rerender(
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
    expect(ui.getByText('after update')).toBeTruthy()
    expect(ui.queryByText('before update')).toBeNull()
  })

  it('keeps rendering safe while a detached session snapshot is unavailable', () => {
    const base = windowSnapshot().session as never as {
      getSnapshot: () => unknown
    }
    expect(() => render(
      <CanvasSessionWindow
        window={windowSnapshot({
          session: { ...base, getSnapshot: () => undefined } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )).not.toThrow()
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
    expect(ui.getByRole('textbox').textContent).toBe('')
    fireEvent.click(ui.getByRole('button', { name: 'Chat' }))
    fireEvent.click(ui.getByRole('button', { name: 'Delete' }))
    fireEvent.click(ui.getByRole('button', { name: 'Confirm delete' }))
    expect(onOpen).toHaveBeenCalledWith('root')
    expect(onDelete).toHaveBeenCalledWith('root')
  })

  it('mounts the native session surface while a referenced branch is running', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: '引用：selected answer',
          running: true,
          inputState: { draft: '', phase: 'submitting' },
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.container.querySelector('[data-dsh-chat-view]')).toBeTruthy()
    expect(ui.getByText('Build a live Canvas window.')).toBeTruthy()
    expect(ui.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('renders a running branch assistant node before it has a durable sequence', () => {
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot({
          branchPrompt: '引用：selected answer',
          branchAtSeq: 10,
          running: true,
          inputState: { draft: '', phase: 'submitting' },
          session: {
            getSnapshot: () => ({
              chat: {
                order: ['live-assistant'],
                nodes: new Map([
                  ['live-assistant', {
                    key: 'live-assistant',
                    kind: 'assistant-step',
                    data: {
                      status: 'running',
                      turn: 2,
                      step: 1,
                      blocks: [{ kind: 'text', text: '正在生成的内容' }],
                    },
                  }],
                ]),
              },
              running: false,
              openState: 'open' as const,
            }),
            subscribe: vi.fn(() => () => {}),
          } as never,
        })}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />,
    )

    expect(ui.getByText('正在生成的内容')).toBeTruthy()
    expect(ui.getByText('Deep diving...')).toBeTruthy()
  })

  it('keeps the branch action in the message footer rather than the window header', () => {
    const onBranch = vi.fn(async () => {})
    const ui = render(
      <CanvasSessionWindow
        window={windowSnapshot()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDraft={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onBranch={onBranch}
        t={t}
      />,
    )

    expect(ui.getByRole('button', { name: 'Branch into Loom Chat' })).toBeTruthy()
    expect(ui.container.querySelector('[data-loom-window-header] [aria-label="Branch into Loom Chat"]')).toBeNull()
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
