import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { CanvasViewport, LoomChatSnapshot } from './controller.js'
import { NS } from './locales.js'

/** Narrow public host renderer face needed by a Canvas window. */
export type LoomRenderSessionSlot = (
  key: 'conversation.composer.full' | 'conversation.session',
  sessionId: SessionId,
  owner: { variant: 'composer' | 'canvas'; afterSeq?: number } | Record<string, never>,
) => ReactNode

/** Browser-owned face for the full-workspace Canvas overlay. */
export interface LoomChatInjected {
  hooks: { loom: HostObservable<LoomChatSnapshot> }
  /** Fork the currently selected assistant text. */
  forkSelection: () => Promise<void>
  /** Open one native DSH session and leave Canvas mode. */
  openSession: (id: SessionId) => void
  /** Leave Canvas and reopen the session that was active before Canvas. */
  closeCanvas: () => void
  /** Archive one Canvas session and all ordinary descendants. */
  deleteSession: (id: SessionId) => Promise<void>
  /** Select a Canvas node without opening it. */
  selectNode: (id: SessionId) => void
  /** Fork the currently selected Canvas node. */
  branchSelected: () => Promise<void>
  /** Fork one visible Canvas window without leaving Canvas mode. */
  branchSession: (id: SessionId) => Promise<void>
  /** Update the in-memory Canvas viewport. */
  setViewport: (viewport: CanvasViewport) => void
  /** Restore the default Canvas viewport. */
  resetViewport: () => void
  /** Update the draft owned by one Canvas window. */
  setDraft: (id: SessionId, text: string) => void
  /** Submit one Canvas window's draft. */
  sendSession: (id: SessionId) => void
  /** Cancel one Canvas window's running session. */
  cancelSession: (id: SessionId) => Promise<void>
}

/** Injected face for the native conversation header's Canvas entry action. */
export interface LoomCanvasActionInjected {
  hooks: { loom: HostObservable<LoomChatSnapshot> }
  /** Open the full-workspace Canvas. */
  openCanvas: () => void
}

/** Full props for the Canvas overlay entry. */
export type LoomChatProps =
  & PropsRuntime<'shell.overlay'>
  & InjectFace<LoomChatInjected>
  & { renderSessionSlot?: LoomRenderSessionSlot }
  & PropsLocale<typeof NS>

/** Full props for the native conversation header Canvas action. */
export type LoomCanvasActionProps =
  & PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<LoomCanvasActionInjected>
  & PropsLocale<typeof NS>

/** Injected controller face for the per-message Loom fork action. */
export interface LoomBranchActionInjected {
  hooks: { loom: HostObservable<LoomChatSnapshot> }
  /** Fork one completed assistant message and focus its child in Canvas. */
  forkAt: (sessionId: SessionId, atSeq: number) => Promise<void>
}

/** Full props for the assistant-message Loom fork action. */
export type LoomBranchActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<LoomBranchActionInjected>
  & PropsLocale<typeof NS>
