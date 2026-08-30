import type { ChatConversationViewNode, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Durable source information captured by a text-selection popover. */
export interface SelectionTarget {
  sessionId: SessionId
  nodeKey: string
  atSeq: number
  text: string
}

/** DOM and conversation facts needed to validate a selection before forking. */
export interface SelectionTargetInput {
  sessionId: SessionId | undefined
  text: string
  flowKey: string | undefined
  flowKind: string | undefined
  node: ChatConversationViewNode | undefined
}

interface AssistantNodeData {
  finalNode?: { seq: number; messageId?: string }
}

/**
 * Accept only finalized assistant text inside a closed turn. The sequence is
 * the fork anchor; the selected text is a new user prompt, not a durable
 * mutation to the source session.
 * @param input - browser selection and conversation-node facts.
 * @returns an anchored target, or null when the selection is not branchable.
 */
export function resolveSelectionTarget(input: SelectionTargetInput): SelectionTarget | null {
  const text = input.text.trim()
  if (input.sessionId === undefined || text.length === 0) return null
  if (input.flowKey === undefined || input.flowKind !== 'assistant-step') return null
  const node = input.node
  if (node === undefined || node.key !== input.flowKey || node.kind !== 'assistant-step') return null
  if (node.location.kind !== 'turn' && node.location.kind !== 'step') return null
  if (node.location.turn.status !== 'closed') return null
  const finalNode = (node.data as AssistantNodeData).finalNode
  if (finalNode === undefined || !Number.isSafeInteger(finalNode.seq)) return null
  return {
    sessionId: input.sessionId,
    nodeKey: input.flowKey,
    atSeq: finalNode.seq,
    text,
  }
}
