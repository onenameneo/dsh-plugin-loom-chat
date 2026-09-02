import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveSelectionTarget } from '../src/client/selection-target.js'

const SESSION = 'main' as SessionId

function node(data: unknown, location: ChatConversationViewNode['location'] = {
  kind: 'turn',
  turn: {
    turn: 1,
    start: undefined,
    end: { type: 'turn/end', seq: 12, time: 12, data: { turn: 1, reason: { kind: 'completed' } } } as never,
    status: 'closed',
    steps: [],
    data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
  },
}): ChatConversationViewNode {
  return {
    key: 'assistant-key',
    kind: 'assistant-step',
    id: 'assistant-id',
    target: 'chat',
    anchorSeq: 12,
    location,
    visibility: 'visible',
    data,
  }
}

describe('resolveSelectionTarget', () => {
  it('resolves a non-empty selection inside a completed Assistant node', () => {
    expect(resolveSelectionTarget({
      sessionId: SESSION,
      text: 'explain this',
      flowKey: 'assistant-key',
      flowKind: 'assistant-step',
      node: node({ finalNode: { seq: 11, messageId: 'message-1' } }),
    })).toEqual({
      sessionId: SESSION,
      nodeKey: 'assistant-key',
      atSeq: 11,
      text: 'explain this',
    })
  })

  it('rejects an empty, non-Assistant, unfinished, or unfinalized selection', () => {
    expect(resolveSelectionTarget({
      sessionId: SESSION,
      text: '   ',
      flowKey: 'assistant-key',
      flowKind: 'assistant-step',
      node: node({ finalNode: { seq: 11, messageId: 'message-1' } }),
    })).toBeNull()

    expect(resolveSelectionTarget({
      sessionId: SESSION,
      text: 'text',
      flowKey: 'user-key',
      flowKind: 'user',
      node: node({ finalNode: { seq: 11, messageId: 'message-1' } }),
    })).toBeNull()

    expect(resolveSelectionTarget({
      sessionId: SESSION,
      text: 'text',
      flowKey: 'assistant-key',
      flowKind: 'assistant-step',
      node: node({ finalNode: { seq: 11, messageId: 'message-1' } }, {
        kind: 'step',
        turn: {
          turn: 1,
          start: undefined,
          end: undefined,
          status: 'open',
          steps: [],
          data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
        },
        step: {
          turn: 1,
          step: 1,
          start: undefined,
          end: undefined,
          status: 'open',
          data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
        },
      }),
    })).toBeNull()

    expect(resolveSelectionTarget({
      sessionId: SESSION,
      text: 'text',
      flowKey: 'assistant-key',
      flowKind: 'assistant-step',
      node: node({ blocks: [] }),
    })).toBeNull()
  })
})
