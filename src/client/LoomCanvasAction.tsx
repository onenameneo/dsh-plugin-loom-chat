import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoomCanvasActionProps } from './slots.js'
import { LoomCanvasIcon } from './LoomCanvasIcon.js'
import css from './LoomBranchAction.module.css'

/** Adds a native-session header action that reopens the Loom Canvas. */
export function LoomCanvasAction({ sessionId, useLoom, openCanvas, t }: LoomCanvasActionProps) {
  const visible = useLoom(snapshot => snapshot.nodes.some(node => node.id === sessionId) && snapshot.mode !== 'canvas')
  if (!visible) return null
  return (
    <Tooltip label={t('openCanvas')} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={t('openCanvas')}
        title={t('openCanvas')}
        onClick={openCanvas}
      >
        <LoomCanvasIcon />
      </button>
    </Tooltip>
  )
}
