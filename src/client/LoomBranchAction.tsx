import { useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoomBranchActionProps } from './slots.js'
import { LoomCanvasIcon } from './LoomCanvasIcon.js'
import css from './LoomBranchAction.module.css'

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function assistantMessageSeq(node: unknown, messageId: unknown): number | undefined {
  const item = record(node)
  if (item?.kind === 'assistant' && item.messageId === messageId && typeof item.seq === 'number') return item.seq
  if (item?.kind !== 'assistant-step') return undefined
  const finalNode = record(record(item.data)?.finalNode)
  return finalNode !== null && finalNode.messageId === messageId && typeof finalNode.seq === 'number' ? finalNode.seq : undefined
}

/**
 * Adds the detached Loom fork control to a finalized assistant message.
 * @param props - message fork boundary, availability, controller face, and locale.
 * @returns the Loom action button, or nothing for a Loom child session.
 */
export function LoomBranchAction({
  sessionId, messageId, useSession,
  useLoom, forkAt, t,
}: LoomBranchActionProps) {
  const visibleOrdinarySession = useLoom(snapshot => snapshot?.nodes?.some(node => node.id === sessionId) === true)
  const atSeq = useSession(snapshot => {
    const nodes: readonly unknown[] = snapshot?.chat?.nodes?.values() ?? snapshot?.nodes ?? []
    return nodes.map(node => assistantMessageSeq(node, messageId)).find((seq): seq is number => seq !== undefined)
  })
  const [pending, setPending] = useState(false)
  if (!visibleOrdinarySession || atSeq === undefined) return null

  const unavailable = pending
  const onClick = (): void => {
    if (unavailable) return
    setPending(true)
    void forkAt(sessionId, atSeq).catch(() => {}).finally(() => { setPending(false) })
  }

  return (
    <Tooltip label={t('branchLoom')} side="top">
      <button
        type="button"
        className={css.action}
        aria-label={t('branchLoom')}
        aria-disabled={unavailable || undefined}
        aria-busy={pending || undefined}
        data-unavailable={unavailable || undefined}
        onClick={onClick}
      >
        <LoomCanvasIcon />
      </button>
    </Tooltip>
  )
}
