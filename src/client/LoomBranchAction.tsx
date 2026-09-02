import { useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoomBranchActionProps } from './slots.js'
import { readChatTranscript } from './chat-snapshot.js'
import { LoomCanvasIcon } from './LoomCanvasIcon.js'
import css from './LoomBranchAction.module.css'

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
    return readChatTranscript(snapshot)
      .filter(node => node.kind === 'assistant' && node.messageId === messageId)
      .map(node => node.anchorSeq ?? node.seq)
      .find((seq): seq is number => seq !== undefined)
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
        data-loom-branch-action
        data-unavailable={unavailable || undefined}
        onClick={onClick}
      >
        <LoomCanvasIcon />
      </button>
    </Tooltip>
  )
}
