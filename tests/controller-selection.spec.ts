// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LoomChatController } from '../src/client/controller.js'

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
})

function node(): ChatConversationViewNode {
  return {
    key: 'assistant-key', kind: 'assistant-step', id: 'assistant-id', target: 'chat', anchorSeq: 12,
    location: {
      kind: 'turn', turn: {
        turn: 1, start: undefined,
        end: { type: 'turn/end', seq: 12 as never, time: 12, data: { turn: 1, reason: { kind: 'completed' } } },
        status: 'closed', steps: [], data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
      },
    },
    visibility: 'visible', data: { finalNode: { seq: 11, messageId: 'message-1' } },
  } satisfies ChatConversationViewNode
}

function mountSelection(): void {
  const flow = document.createElement('div')
  flow.dataset.chatFlowKey = 'assistant-key'
  flow.dataset.chatFlowKind = 'assistant-step'
  const text = document.createTextNode('selected answer')
  flow.append(text)
  document.body.append(flow)
  const range = document.createRange()
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ left: 20, top: 30, width: 80, height: 18 }) })
  range.selectNodeContents(text)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function stopPointerPropagationOnSelection(): void {
  const flow = document.querySelector<HTMLElement>('[data-chat-flow-key="assistant-key"]')
  flow?.addEventListener('pointerdown', event => { event.stopPropagation() })
}

function mountCanvasSelection(sessionId: SessionId): void {
  const canvasWindow = document.createElement('article')
  canvasWindow.dataset.loomSessionId = sessionId
  const flow = document.createElement('div')
  flow.dataset.chatFlowKey = 'assistant-key'
  flow.dataset.chatFlowKind = 'assistant-step'
  const text = document.createTextNode('selected child answer')
  flow.append(text)
  canvasWindow.append(flow)
  document.body.append(canvasWindow)
  const range = document.createRange()
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ left: 20, top: 30, width: 80, height: 18 }) })
  range.selectNodeContents(text)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function sessionFace(snapshot: object, onSubscribe?: (listener: () => void) => void): object {
  const value = snapshot as { chat?: { nodes?: Map<string, unknown> }; openState?: 'open' }
  const nodes = value.chat?.nodes ?? new Map<string, unknown>()
  return {
    getSnapshot: () => ({ ...value, openState: value.openState ?? 'open', chat: { ...value.chat, nodes, order: [...nodes.keys()] } }),
    subscribe: vi.fn((listener: () => void) => { onSubscribe?.(listener); return () => {} }),
  }
}

describe('LoomChatController selection branching', () => {
  it('captures a selection inside an assistant flow row', () => {
    const sessionId = 'main' as SessionId
    const assistant = node()
    const session = sessionFace({ chat: { nodes: new Map([[assistant.key, assistant]]) }, turnEnds: new Map([[1, 12]]), running: false })
    const controller = new LoomChatController({
      list: {
        getSnapshot: () => ({ current: sessionId, ids: [sessionId], byId: {
          [sessionId]: { id: sessionId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 },
        }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
        subscribe: vi.fn(() => () => {}),
      },
      binding: () => ({ session }),
    } as never)
    mountSelection()
    document.dispatchEvent(new Event('selectionchange'))

    expect(controller.getSnapshot().selection.target).toMatchObject({ sessionId, atSeq: 11, text: 'selected answer' })
    controller.dispose()
  })

  it('waits until pointer selection finishes before publishing a branch target', () => {
    const sessionId = 'main' as SessionId
    const assistant = node()
    const session = sessionFace({ chat: { nodes: new Map([[assistant.key, assistant]]) }, turnEnds: new Map([[1, 12]]), running: false })
    const controller = new LoomChatController({
      list: {
        getSnapshot: () => ({ current: sessionId, ids: [sessionId], byId: {
          [sessionId]: { id: sessionId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 },
        }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
        subscribe: vi.fn(() => () => {}),
      },
      binding: () => ({ session }),
    } as never)

    document.dispatchEvent(new Event('pointerdown'))
    mountSelection()
    document.dispatchEvent(new Event('selectionchange'))
    expect(controller.getSnapshot().selection.target).toBeNull()
    expect(controller.getSnapshot().selection.rect).toBeNull()

    document.dispatchEvent(new Event('pointerup'))
    expect(controller.getSnapshot().selection.target).toMatchObject({ sessionId, atSeq: 11, text: 'selected answer' })
    expect(controller.getSnapshot().selection.rect).toEqual({ left: 20, top: 30, width: 80, height: 18 })
    controller.dispose()
  })

  it('keeps the pointer selection gate when a Canvas transcript stops bubbling events', () => {
    const sessionId = 'main' as SessionId
    const assistant = node()
    const session = sessionFace({ chat: { nodes: new Map([[assistant.key, assistant]]) }, turnEnds: new Map([[1, 12]]), running: false })
    const controller = new LoomChatController({
      list: {
        getSnapshot: () => ({ current: sessionId, ids: [sessionId], byId: {
          [sessionId]: { id: sessionId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 },
        }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
        subscribe: vi.fn(() => () => {}),
      },
      binding: () => ({ session }),
    } as never)

    mountSelection()
    stopPointerPropagationOnSelection()
    document.querySelector<HTMLElement>('[data-chat-flow-key="assistant-key"]')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
    expect(controller.getSnapshot().selection.target).toBeNull()

    document.dispatchEvent(new Event('pointerup'))
    expect(controller.getSnapshot().selection.target).toMatchObject({ sessionId, atSeq: 11, text: 'selected answer' })
    controller.dispose()
  })

  it('uses the Canvas window session when selecting text from a non-current child', () => {
    const mainId = 'main' as SessionId
    const childId = 'child' as SessionId
    const assistant = node()
    const childSession = sessionFace({ chat: { nodes: new Map([[assistant.key, assistant]]) }, turnEnds: new Map([[1, 12]]), running: false })
    const mainSession = sessionFace({ chat: { nodes: new Map() }, turnEnds: new Map(), running: false })
    const controller = new LoomChatController({
      list: {
        getSnapshot: () => ({ current: mainId, ids: [mainId, childId], byId: {
          [mainId]: { id: mainId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 },
          [childId]: { id: childId, displayTitle: 'Child', parentId: mainId, running: false, blank: false, updatedAt: 2 },
        }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
        subscribe: vi.fn(() => () => {}),
      },
      binding: (id: SessionId) => ({ session: id === childId ? childSession : mainSession }),
    } as never)
    mountCanvasSelection(childId)
    document.dispatchEvent(new Event('selectionchange'))

    expect(controller.getSnapshot().selection.target).toMatchObject({ sessionId: childId, atSeq: 11, text: 'selected child answer' })
    controller.dispose()
  })

  it('forks the selected answer into a focused Canvas window with an empty composer', async () => {
    const mainId = 'main' as SessionId
    const childId = 'branch-1' as SessionId
    const assistant = node()
    const rename = vi.fn(async () => ({ ok: true as const, value: { title: '注意力机制原理与上下文理解…', seq: 20 } }))
    const childSession = {
      ...sessionFace({ chat: { nodes: new Map() }, turnEnds: new Map(), running: false }),
      rename,
    }
    const mainSession = sessionFace({ chat: { nodes: new Map([[assistant.key, assistant]]) }, turnEnds: new Map([[1, 12]]), running: false })
    const question = '请解释注意力机制的原理，并说明它如何帮助模型理解上下文以及长文本处理。'
    const input = {
      setDraft: vi.fn(),
      submit: vi.fn(),
      state: { getSnapshot: () => ({ draft: question, phase: 'plain' as const }), subscribe: vi.fn(() => () => {}) },
    }
    const listState = {
      current: mainId,
      ids: [mainId] as SessionId[],
      byId: { [mainId]: { id: mainId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 } } as Record<string, never>,
      phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    let notifyList = (): void => {}
    const sessions = {
      list: {
        getSnapshot: () => listState,
        subscribe: (listener: () => void) => { notifyList = listener; return () => {} },
      },
      open: vi.fn((id: SessionId) => { listState.current = id }),
      binding: (id: SessionId) => id === childId ? { session: childSession } : { session: mainSession },
      fork: vi.fn(async () => {
        listState.ids.push(childId)
        listState.byId[childId] = { id: childId, parentId: mainId, displayTitle: 'Branch 1', running: false, blank: false, updatedAt: 2 } as never
        notifyList()
        return childId
      }),
    }
    const controller = new LoomChatController(sessions as never, () => input)
    mountSelection()
    document.dispatchEvent(new Event('selectionchange'))

    await controller.forkSelection()

    expect(sessions.fork).toHaveBeenCalledWith({ sessionId: mainId, atSeq: 11, increaseTitle: true })
    expect(sessions.open).not.toHaveBeenCalled()
    expect(input.setDraft).toHaveBeenCalledWith('')
    expect(controller.getSnapshot()).toMatchObject({ mode: 'canvas', currentSessionId: mainId, selectedSessionId: childId })
    expect(controller.getSnapshot().windows.find(window => window.id === childId)).toMatchObject({
      branchPrompt: expect.stringContaining('selected answer'),
    })
    controller.sendSession(childId)
    expect(input.setDraft).toHaveBeenCalledWith(expect.stringContaining('<selected-content>\nselected answer\n</selected-content>'))
    expect(input.setDraft).toHaveBeenCalledWith(expect.stringContaining(question))
    expect(input.setDraft).toHaveBeenLastCalledWith('')
    expect(input.submit).toHaveBeenCalledOnce()
    expect(rename).toHaveBeenCalledWith('请解释注意力机制的原理，并说明它如何帮助模型理解上下文以及长…')
    expect(controller.getSnapshot().windows.find(window => window.id === childId)?.title)
      .toBe('请解释注意力机制的原理，并说明它如何帮助模型理解上下文以及长…')
    expect(controller.getSnapshot().windows.find(window => window.id === childId)).toMatchObject({
      branchPrompt: expect.stringContaining('selected answer'),
      branchContinued: true,
    })
    controller.dispose()

    const reloadedController = new LoomChatController(sessions as never, () => input)
    expect(reloadedController.getSnapshot().windows.find(window => window.id === childId)).toMatchObject({
      branchPrompt: expect.stringContaining('selected answer'),
      branchContinued: true,
      title: '请解释注意力机制的原理，并说明它如何帮助模型理解上下文以及长…',
    })
    reloadedController.sendSession(childId)
    expect(rename).toHaveBeenCalledOnce()
    reloadedController.dispose()
  })

  it('derives the child title when the host composer records a user message', async () => {
    const mainId = 'main' as SessionId
    const childId = 'child' as SessionId
    const childNodes = new Map<string, unknown>()
    let notifyChild = (): void => {}
    const rename = vi.fn(async () => ({ ok: true as const, value: { title: '解释这个概念并结合代码说明它为什么重要', seq: 20 } }))
    const childSession = {
      ...sessionFace({ chat: { nodes: childNodes }, turnEnds: new Map(), running: false }, listener => { notifyChild = listener }),
      rename,
    }
    const mainSession = sessionFace({ chat: { nodes: new Map() }, turnEnds: new Map(), running: false })
    const listState = {
      current: mainId,
      ids: [mainId, childId] as SessionId[],
      byId: {
        [mainId]: { id: mainId, displayTitle: 'Main', running: false, blank: false, updatedAt: 1 },
        [childId]: { id: childId, displayTitle: 'Branch 1', parentId: mainId, running: false, blank: false, updatedAt: 2 },
      },
      phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    window.localStorage.setItem('dsh-loom-chat:branch-boundary:child', '12')
    const controller = new LoomChatController({
      list: {
        getSnapshot: () => listState,
        subscribe: vi.fn(() => () => {}),
      },
      binding: (id: SessionId) => ({ session: id === childId ? childSession : mainSession }),
    } as never)

    childNodes.set('user-1', {
      kind: 'user',
      anchorSeq: 13,
      data: { content: [{ type: 'text', text: '解释这个概念并结合代码说明它为什么重要' }] },
    })
    notifyChild()
    await Promise.resolve()

    expect(rename).toHaveBeenCalledWith('解释这个概念并结合代码说明它为什么重要')
    expect(controller.getSnapshot().windows.find(window => window.id === childId)?.title)
      .toBe('解释这个概念并结合代码说明它为什么重要')
    controller.dispose()
  })
})
