import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CanvasSessionWindowSnapshot } from './controller.js'
import type { NS } from './locales.js'
import { IconNewChatOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CanvasOverlay.module.css'
import { readChatTranscript } from './chat-snapshot.js'
import { NativeSessionSurface } from './NativeSessionSurface.js'
import { NativeComposer } from './NativeComposer.js'

interface CanvasSessionWindowProps {
  window: CanvasSessionWindowSnapshot
  onSelect: (id: SessionId) => void
  onOpen: (id: SessionId) => void
  onDelete: (id: SessionId) => Promise<void> | void
  onDraft: (id: SessionId, text: string) => void
  onSend: (id: SessionId) => void
  onCancel: (id: SessionId) => void
  onBranch?: (id: SessionId, atSeq: number) => Promise<void> | void
  t: TranslateNS<typeof NS>
}

function hasVisibleTranscript(window: CanvasSessionWindowSnapshot): boolean {
  const sessionSnapshot = window.session?.getSnapshot() as unknown
  const snapshot = typeof sessionSnapshot === 'object' && sessionSnapshot !== null
    ? { ...(sessionSnapshot as Record<string, unknown>), chat: window.chatSnapshot }
    : sessionSnapshot
  return readChatTranscript(snapshot).some(node => {
    if (node.kind === 'context' || node.text.length === 0) return false
    if (window.branchAtSeq === undefined) return true
    const seq = node.anchorSeq ?? node.seq
    return seq === undefined || seq > window.branchAtSeq
  })
}

function hasActiveTextSelection(): boolean {
  const selection = globalThis.window.getSelection()
  return selection !== null
    && selection.rangeCount > 0
    && !selection.isCollapsed
    && selection.toString().trim().length > 0
}

/** A compact live transcript and composer for one DSH session in Canvas. */
export function CanvasSessionWindow({
  window, onSelect, onOpen, onDelete, onDraft, onSend, onCancel, onBranch, t,
}: CanvasSessionWindowProps) {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const inputState = window.inputState ?? window.input?.state?.getSnapshot()
  const running = window.running || inputState?.phase === 'submitting' || inputState?.phase === 'adjudicating'
  const hasBranchReference = window.branchPrompt !== undefined
  // A newly-created selection branch starts with only the reference card. Once
  // its child session has post-boundary history, show that history immediately
  // even if the async controller has not persisted `branchContinued` yet. A
  // running child must also mount the native surface so streaming output,
  // tool steps, and the stop state are visible before the first final node.
  const referenceOnly = hasBranchReference
    && window.branchContinued !== true
    && !running
    && (window.branchAtSeq === undefined || !hasVisibleTranscript(window))
  const transcriptClassName = [css.windowTranscript, referenceOnly ? css.referenceTranscript : ''].filter(Boolean).join(' ')

  const confirmDelete = (): void => {
    setDeleteConfirmationOpen(false)
    void Promise.resolve(onDelete(window.id)).catch(() => {})
  }

  return (
    <article
      className={css.sessionWindow}
      data-loom-session-id={String(window.id)}
      data-completed={window.completed || undefined}
      data-running={running || undefined}
      data-selected={window.selected || undefined}
      data-unavailable={window.session === undefined || window.input === undefined || undefined}
      aria-label={window.title}
      onClick={() => { if (!hasActiveTextSelection()) onSelect(window.id) }}
      onWheel={event => { event.stopPropagation() }}
    >
      <header className={css.windowHeader}>
        <div className={css.windowIdentity}>
          <div className={css.windowHeading}>
            <strong>{window.title}</strong>
            {(running || window.completed) && <span>{running ? t('running') : t('completed')}</span>}
          </div>
        </div>
        <div className={css.windowActions}>
          <button
            type="button"
            className={css.windowIconButton}
            aria-label={t('chat')}
            title={t('chat')}
            onClick={event => { event.stopPropagation(); onOpen(window.id) }}
          >
            <IconNewChatOutline16 />
          </button>
          <button
            type="button"
            className={css.windowIconButton}
            aria-label={t('delete')}
            title={t('delete')}
            aria-expanded={deleteConfirmationOpen}
            onClick={event => { event.stopPropagation(); setDeleteConfirmationOpen(open => !open) }}
          >
            <IconTrashOutline16 />
          </button>
        </div>
        {deleteConfirmationOpen && (
          <div
            className={css.deleteConfirmation}
            role="alertdialog"
            aria-label={t('deleteConfirm')}
            onClick={event => { event.stopPropagation() }}
          >
            <p>{t('deleteConfirm')}</p>
            <div className={css.deleteConfirmationActions}>
              <button
                type="button"
                className={css.deleteCancelButton}
                onClick={() => { setDeleteConfirmationOpen(false) }}
              >
                {t('cancelDelete')}
              </button>
              <button
                type="button"
                className={css.deleteConfirmButton}
                onClick={confirmDelete}
              >
                {t('confirmDelete')}
              </button>
            </div>
          </div>
        )}
      </header>
      <div
        className={transcriptClassName}
        onWheel={event => { event.stopPropagation() }}
      >
        {window.session === undefined ? (
          <p className={css.windowNotice}>{t('loading')}</p>
        ) : (
          <>
          {hasBranchReference && (
            <aside className={css.branchReference} data-kind="branch-reference" role="note">
              <span className={css.branchReferenceRole}>{t('referencePrompt')}</span>
              <p>{window.branchPrompt}</p>
            </aside>
          )}
            {!referenceOnly ? (
              <NativeSessionSurface
                window={window}
                running={running}
                {...(onBranch === undefined ? {} : { onBranch: atSeq => onBranch(window.id, atSeq) })}
                t={t}
              />
            ) : null}
          </>
        )}
      </div>
      <footer className={css.windowComposer} data-dsh-composer>
        <NativeComposer window={window} onDraft={onDraft} onSend={onSend} onCancel={onCancel} t={t} />
      </footer>
    </article>
  )
}
