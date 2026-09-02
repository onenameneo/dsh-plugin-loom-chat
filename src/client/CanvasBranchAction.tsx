import { useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoomCanvasIcon } from './LoomCanvasIcon.js'
import loomCss from './LoomBranchAction.module.css'

/** Canvas-only action contributed to the Harness message action slot. */
export function CanvasBranchAction({ onBranch, branchLabel }: {
  onBranch: () => Promise<void> | void
  branchLabel: string
}) {
  const [branchPending, setBranchPending] = useState(false)
  const branch = (): void => {
    if (branchPending) return
    setBranchPending(true)
    void Promise.resolve(onBranch()).catch(() => {}).finally(() => { setBranchPending(false) })
  }
  return (
    <Tooltip label={branchLabel} side="bottom">
      <button
        type="button"
        className={loomCss.action}
        aria-label={branchLabel}
        aria-disabled={branchPending || undefined}
        aria-busy={branchPending || undefined}
        data-loom-branch-action
        onClick={event => { event.stopPropagation(); branch() }}
      >
        <LoomCanvasIcon />
      </button>
    </Tooltip>
  )
}
