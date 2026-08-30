import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { CanvasSessionWindowSnapshot } from './controller.js'
import type { LoomRenderSessionSlot } from './slots.js'
import type { NS } from './locales.js'
import { IconNewChatOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CanvasOverlay.module.css'

interface CanvasSessionWindowProps {
  window: CanvasSessionWindowSnapshot
  onSelect: (id: SessionId) => void
  onOpen: (id: SessionId) => void
  onDelete: (id: SessionId) => Promise<void> | void
  onDraft: (id: SessionId, text: string) => void
  onSend: (id: SessionId) => void
  onCancel: (id: SessionId) => void
  renderSessionSlot?: LoomRenderSessionSlot | undefined
  t: TranslateNS<typeof NS>
}

type DetachedSession = SessionFace & { open?: () => Promise<void> }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('')
  const item = record(value)
  if (item === null) return ''
  if (typeof item.text === 'string') return item.text
  for (const key of ['content', 'blocks', 'message', 'argsRaw', 'summary']) {
    const text = textOf(item[key])
    if (text.length > 0) return text
  }
  return ''
}

function nodeText(node: unknown): string {
  const item = record(node)
  if (item === null) return ''
  const text = textOf(item.content ?? item.blocks ?? item.message ?? item)
  return text.trim()
}

function nodeKind(node: unknown): string {
  const kind = record(node)?.kind
  return typeof kind === 'string' ? kind : 'context'
}

function transcriptNodes(window: CanvasSessionWindowSnapshot): readonly unknown[] {
  const snapshot = window.session?.getSnapshot() as unknown
  const item = record(snapshot)
  if (item === null) return []
  if (Array.isArray(item.nodes) && item.nodes.length > 0) return item.nodes
  const chat = record(item.chat)
  const nodes = chat?.nodes
  if (Array.isArray(nodes)) return nodes
  if (nodes !== null && typeof nodes === 'object' && 'values' in nodes) {
    const values = (nodes as { values?: unknown }).values
    if (typeof values === 'function') {
      const result = values.call(nodes)
      if (Array.isArray(result)) return result
      return result !== null && typeof result === 'object' && Symbol.iterator in result
        ? Array.from(result as Iterable<unknown>)
        : []
    }
  }
  return []
}

function stopPropagation(event: ReactMouseEvent<HTMLElement>): void {
  event.stopPropagation()
}

/** A compact live transcript and composer for one DSH session in Canvas. */
export function CanvasSessionWindow({
  window, onSelect, onOpen, onDelete, onDraft, onSend, onCancel, renderSessionSlot, t,
}: CanvasSessionWindowProps) {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  useEffect(() => {
    const session = window.session as DetachedSession | undefined
    const open = session?.open
    if (session === undefined || session.getSnapshot().openState === 'open' || open === undefined) return
    void open.call(session)
  }, [window.session])
  const inputState = window.inputState ?? window.input?.state?.getSnapshot()
  const running = window.running || inputState?.phase === 'submitting' || inputState?.phase === 'adjudicating'
  const hasBranchReference = window.branchPrompt !== undefined
  const referenceOnly = hasBranchReference && window.branchContinued !== true
  const transcript = (referenceOnly ? [] : transcriptNodes(window)).filter(node => {
    if (window.branchAtSeq === undefined || !hasBranchReference) return true
    const item = record(node)
    const seq = item?.anchorSeq ?? item?.seq
    return typeof seq !== 'number' || seq > window.branchAtSeq
  })
  const usesNativeSession = renderSessionSlot !== undefined && !referenceOnly && !window.blank
  const transcriptClassName = [
    css.windowTranscript,
    usesNativeSession ? css.nativeTranscript : '',
    hasBranchReference && usesNativeSession ? css.referenceNativeTranscript : '',
    hasBranchReference && usesNativeSession ? css.referenceScrollTranscript : '',
    referenceOnly ? css.referenceTranscript : '',
  ].filter(Boolean).join(' ')

  const submit = (): void => {
    if (running || inputState?.draft.trim().length === 0) return
    onSend(window.id)
  }
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    submit()
  }
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
      onClick={() => { onSelect(window.id) }}
      onPointerDown={stopPropagation}
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
        onPointerDown={stopPropagation}
        onWheel={event => { event.stopPropagation() }}
      >
        {window.session === undefined ? (
          <p className={css.windowNotice}>{t('loading')}</p>
        ) : (
          <>
            {hasBranchReference && (
              <div className={css.message} data-kind="branch-reference">
                <span className={css.messageRole}>{t('referencePrompt')}</span>
                <p>{window.branchPrompt}</p>
              </div>
            )}
            {referenceOnly ? null : renderSessionSlot !== undefined && !window.blank ? (
              <div
                className={css.nativeSession}
                data-canvas-density="compact"
                data-session-content={String(window.id)}
              >
                {renderSessionSlot('conversation.session', window.id, {
                  variant: 'canvas',
                  ...(window.branchAtSeq === undefined ? {} : { afterSeq: window.branchAtSeq }),
                })}
              </div>
            ) : transcript.length === 0 ? (
              <p className={css.windowNotice}>{t('canvasEmpty')}</p>
            ) : transcript.map((node, index) => {
              const text = nodeText(node)
              if (text.length === 0) return null
              const kind = nodeKind(node)
              return (
                <div className={css.message} data-kind={kind} key={String(record(node)?.seq ?? index)}>
                  <span className={css.messageRole}>{kind === 'user' || kind === 'steering' ? 'You' : 'DSH'}</span>
                  <p>{text}</p>
                </div>
              )
            })}
          </>
        )}
      </div>
      <footer className={renderSessionSlot === undefined
        ? css.windowComposer
        : `${css.windowComposer} ${css.nativeComposerShell}`} onPointerDown={stopPropagation}>
        {renderSessionSlot === undefined ? (
          <BasicComposer
            window={window}
            inputState={inputState}
            running={running}
            onDraft={onDraft}
            onCancel={onCancel}
            submit={submit}
            keyDown={keyDown}
            t={t}
          />
        ) : (
          <div className={css.nativeComposer} data-session-composer={String(window.id)}>
            {renderSessionSlot('conversation.composer.full', window.id, { variant: 'composer' })}
          </div>
        )}
      </footer>
    </article>
  )
}

function BasicComposer({
  window, inputState, running, onDraft, onCancel, submit, keyDown, t,
}: {
  window: CanvasSessionWindowSnapshot
  inputState: CanvasSessionWindowSnapshot['inputState']
  running: boolean
  onDraft: (id: SessionId, text: string) => void
  onCancel: (id: SessionId) => void
  submit: () => void
  keyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  t: TranslateNS<typeof NS>
}): ReactNode {
  return (
    <>
      <textarea
        aria-label={t('composerPlaceholder')}
        className={css.windowTextarea}
        disabled={window.input === undefined || running}
        placeholder={t('composerPlaceholder')}
        value={inputState?.draft ?? ''}
        onChange={event => { onDraft(window.id, event.currentTarget.value) }}
        onKeyDown={keyDown}
      />
      <div className={css.windowComposerBar}>
        <span className={css.windowComposerHint}>{window.error ?? (window.pending ? t('pending') : t('pendingContext'))}</span>
        {running ? (
          <button type="button" className={css.windowSendButton} onClick={event => { event.stopPropagation(); onCancel(window.id) }}>
            {t('stop')}
          </button>
        ) : (
          <button type="button" className={css.windowSendButton} disabled={inputState?.draft.trim().length === 0 || window.input === undefined} onClick={event => { event.stopPropagation(); submit() }}>
            {t('send')}
          </button>
        )}
      </div>
    </>
  )
}
