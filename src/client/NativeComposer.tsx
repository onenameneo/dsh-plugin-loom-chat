import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type ReactNode } from 'react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import type { CanvasSessionWindowSnapshot } from './controller.js'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.js'
import { nativeChatSnapshot } from './chat-snapshot.js'
import { InputBar } from '../vendor/dsh-harness-conversation/skeleton/InputBar.js'
import { StatsLine } from '../vendor/dsh-harness-chat/chat/StatsLine.js'
import { en as chatEn, zh as chatZh } from '../vendor/dsh-harness-chat/locale.js'
import { ComposerAttachments } from '../vendor/dsh-harness-attachment/client/ComposerAttachments.js'
import { en as conversationEn, zh as conversationZh } from '../vendor/dsh-harness-conversation/locales.js'
import { ModelSelect } from '../vendor/dsh-model-selection/ModelSelect.js'
import { MenuView, menuFaceOf } from '../vendor/dsh-input-trigger/MenuView.js'
import css from './CanvasOverlay.module.css'

type AnyRecord = Record<string, any>
type NativeComponent = (props: AnyRecord) => ReactNode
const NativeInputBar = InputBar as unknown as NativeComponent
const NativeStatsLine = StatsLine as unknown as NativeComponent
const NativeComposerAttachments = ComposerAttachments as unknown as NativeComponent

const EMPTY_INPUT: AnyRecord = {
  draft: '',
  imageIds: [],
  draftRev: 0,
  phase: 'plain',
  occurrences: [],
  queue: [],
}

const EMPTY_INPUT_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const EMPTY_PROJECTION_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const EMPTY_PROJECTION_SNAPSHOT = (): undefined => undefined

function inputSnapshotKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const item = value as AnyRecord
  try {
    return JSON.stringify({
      draft: item.draft,
      phase: item.phase,
      imageIds: item.imageIds,
      occurrences: item.occurrences,
      queue: item.queue,
    })
  } catch {
    return `${String(item.draft)}:${String(item.phase)}`
  }
}

function inputSnapshot(window: CanvasSessionWindowSnapshot, candidate: unknown = window.input?.state?.getSnapshot()): AnyRecord {
  const override = window.inputState as AnyRecord | undefined
  if (typeof candidate !== 'object' || candidate === null) return override ?? EMPTY_INPUT
  const live = candidate as AnyRecord
  // The Canvas window snapshot is a render-time copy. Once the live input
  // face exists it is authoritative, including an empty draft and `plain`
  // phase; falling back to an older window snapshot here can leave the
  // textarea readOnly after a previous submit/adjudication has settled.
  const draft = typeof live.draft === 'string'
    ? live.draft
    : typeof override?.draft === 'string' ? override.draft : ''
  const phase = typeof live.phase === 'string'
    ? live.phase
    : typeof override?.phase === 'string' ? override.phase : 'plain'
  return {
    ...EMPTY_INPUT,
    ...candidate as AnyRecord,
    ...(override === undefined ? {} : override),
    ...live,
    draft,
    phase,
  }
}

function editableInputSnapshot(window: CanvasSessionWindowSnapshot, snapshot: AnyRecord): AnyRecord {
  // A detached Canvas window can retain the input shell's transient submit
  // phase after the session snapshot has already settled. DSH's InputBar
  // intentionally treats that phase as read-only, which leaves a visible
  // caret but drops every native edit. The session running flag is the
  // authoritative lifecycle signal for this surface: once it is settled,
  // restore the shell to the normal editable phase without mutating the
  // host-owned input machine.
  const sessionState = sessionSnapshot(window)
  const sessionRunning = typeof sessionState.running === 'boolean' ? sessionState.running : window.running
  if (sessionRunning || (snapshot.phase !== 'submitting' && snapshot.phase !== 'adjudicating')) return snapshot
  return { ...snapshot, phase: 'plain' }
}

export function composerTranslation(t: TranslateNS<typeof NS>): (key: string, params?: AnyRecord) => string {
  const isChinese = t('running') === '运行中'
  const localizedFallback: Record<string, string> = isChinese
    ? { ...conversationZh, ...chatZh }
    : { ...conversationEn, ...chatEn }
  const fallback: AnyRecord = {
    'input.commands': 'Commands', 'input.stop': 'Stop', 'input.send': 'Send',
    'input.accessMode': 'Access mode, current: {name}',
    'placeholder.default': 'Send a message', 'placeholder.unavailable': 'Session unavailable',
    'placeholder.parentOffline': 'Parent session is offline', 'placeholder.plan': 'Describe your task to generate a plan',
    'placeholder.steerQueue': 'Press Cmd/Ctrl+Enter to send queued messages', 'copy': 'Copy', 'copied': 'Copied',
    'loading': 'Loading…', 'context.aria': 'Context used {percent}', 'context.used': 'Context used',
    'context.system': 'System prompt', 'context.tools': 'Tools', 'context.messages': 'Messages',
    'access.confirm.title': 'Enable Full access?', 'access.confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly.',
    'access.confirm.acknowledge': 'I understand the risk and want to continue', 'access.confirm.cancel': 'Cancel',
    'access.confirm.enable': 'Enable Full access',
    'stats.counts': '{turns} turns · {steps} steps',
    'stats.llm': 'LLM {duration}', 'stats.toolCall': 'Tool call {duration}',
    'stats.ttftAverage': 'First token {duration}', 'stats.tokensPerSecond': '{throughput} tok/s',
    'stats.cacheHit': 'Cache hit {percent}%', 'stats.tokens': 'Input {input} tok · Output {output} tok',
    'duration.compactSeconds': '{seconds}s', 'duration.compactMinutes': '{minutes}m{seconds}s',
    'image.pending': 'Pending images', 'image.remove': 'Remove {name}',
    'image.openOriginal': 'Open original image', 'image.scrollLeft': 'Scroll images left',
    'image.scrollRight': 'Scroll images right', 'image.dropBlocked': 'Image drop unavailable',
    'image.dropTitle': 'Drop images here to add them', 'image.dropDesc': 'Up to {count} images, {size} each',
    'image.preview': 'Image preview', 'image.closePreview': 'Close image preview',
    'image.original': 'Original image',
  }
  return (key, params) => {
    let value = isChinese
      ? localizedFallback[key] ?? fallback[key] ?? key
      : fallback[key] ?? localizedFallback[key] ?? key
    try {
      const translated = t(key as never, params)
      if (typeof translated === 'string' && translated !== key) value = translated
    } catch { /* Loom locale does not own conversation keys. */ }
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }
}

function modelTranslation(key: string, params?: AnyRecord): string {
  const values: AnyRecord = {
    'trigger.fallback': 'Select model', 'trigger.selectAria': 'Select model',
    'trigger.aria': 'Select model, current {model}', 'menu.aria': 'Model and reasoning effort',
    'menu.model': 'Model', 'menu.effort': 'Effort', 'effort.providerDefault': 'Default',
    'status.loading': 'Refreshing model list…', 'error.action': 'Model operation failed: {message}',
    'warning.groupLoad': '{name} failed to load: {message}', 'empty.models': 'No models available.',
    'empty.efforts': 'This model provides no reasoning effort levels.', 'retry': 'Retry', 'action.reload': 'Reload',
  }
  let value = values[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}

function menuTranslation(key: string): string {
  const values: AnyRecord = { 'suggestions.aria': 'Suggestions', loading: 'Loading…', command: 'Commands' }
  return values[key] ?? key
}

function sessionSnapshot(window: CanvasSessionWindowSnapshot): AnyRecord {
  const snapshot = window.session?.getSnapshot() as unknown
  return typeof snapshot === 'object' && snapshot !== null ? snapshot as AnyRecord : {}
}

function projectionFace(session: CanvasSessionWindowSnapshot['session'], key: string): AnyRecord | undefined {
  const projections = session === undefined ? undefined : (session as unknown as AnyRecord).projections
  const faceOf = (projections as AnyRecord | undefined)?.faceOf
  if (typeof faceOf !== 'function') return undefined
  try {
    const face = faceOf.call(projections, key)
    return typeof face === 'object' && face !== null ? face as AnyRecord : undefined
  } catch {
    return undefined
  }
}

function useNativeProjection<T = unknown>(session: CanvasSessionWindowSnapshot['session'], key: string, selector?: (value: T) => unknown): unknown {
  const face = projectionFace(session, key)
  const subscribe = useMemo(
    () => typeof face?.subscribe === 'function' ? (listener: () => void) => face.subscribe(listener) as () => void : EMPTY_PROJECTION_SUBSCRIBE,
    [face],
  )
  const getSnapshot = useMemo(
    () => typeof face?.getSnapshot === 'function' ? () => face.getSnapshot() as T : EMPTY_PROJECTION_SNAPSHOT,
    [face],
  )
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return selector === undefined ? value : selector(value as T)
}

/**
 * The vendored DSH InputBar is kept as the visual/interaction surface. This
 * adapter supplies only public session and input faces, so Canvas does not
 * reach into the host's private composer implementation.
 */
export function NativeComposer({
  window, onDraft, onSend, onCancel, t,
}: {
  window: CanvasSessionWindowSnapshot
  onDraft: (id: CanvasSessionWindowSnapshot['id'], text: string) => void
  onSend: (id: CanvasSessionWindowSnapshot['id']) => void
  onCancel: (id: CanvasSessionWindowSnapshot['id']) => void
  t: TranslateNS<typeof NS>
}): ReactNode {
  const input = window.input
  const inputFace = input?.state
  const inputStore = useMemo(() => {
    let previousKey: string | undefined
    let previousSnapshot: unknown = EMPTY_INPUT
    return {
      subscribe: inputFace?.subscribe ?? EMPTY_INPUT_SUBSCRIBE,
      getSnapshot: () => {
        const next = inputFace?.getSnapshot() ?? EMPTY_INPUT
        const key = inputSnapshotKey(next)
        if (key === previousKey) return previousSnapshot
        previousKey = key
        previousSnapshot = next
        return next
      },
    }
  }, [inputFace])
  const liveInput = useSyncExternalStore(
    inputStore.subscribe,
    inputStore.getSnapshot,
    inputStore.getSnapshot,
  )
  const inputTriggers = input?.inputTriggers
  const launcher = useSyncExternalStore(
    inputTriggers?.launcher.subscribe ?? EMPTY_INPUT_SUBSCRIBE,
    () => inputTriggers?.launcher.getSnapshot() ?? null,
    () => inputTriggers?.launcher.getSnapshot() ?? null,
  )
  const snapshot = editableInputSnapshot(window, inputSnapshot(window, liveInput))
  const [canvasDraft, setCanvasDraft] = useState(() => snapshot.draft)
  const canvasDraftRef = useRef(canvasDraft)
  canvasDraftRef.current = canvasDraft
  const canvasDraftDirty = useRef(false)
  const pendingSubmitClear = useRef(false)
  const onDraftRef = useRef(onDraft)
  onDraftRef.current = onDraft
  const session = window.session
  const rawInput = input as unknown as AnyRecord | undefined
  const inputRuntime = rawInput ?? {}
  const editor = useMemo<LexicalEditor | undefined>(() => {
    // The host Conversation bundle has its own Lexical runtime. Its editor
    // cannot cross into the vendored InputBar in this bundle: Lexical checks
    // the runtime identity and raises error #195 even for equal versions.
    // Keep this Canvas editor and all vendored editor helpers in one bundle.
    if (input === undefined) return undefined
    return createEditor({
      namespace: `dsh-loom-canvas-${String(window.id)}`,
      onError: error => { throw error },
    })
  }, [input, window.id])
  useEffect(() => {
    if (editor === undefined) return
    return registerPlainText(editor)
  }, [editor])
  const translate = composerTranslation(t)
  const useSession = (selector: (value: AnyRecord) => unknown): unknown => {
    const state = sessionSnapshot(window)
    return selector({
    ...state,
    chat: state.chat ?? { legacy: { nodes: [] } },
    running: window.running || state.running === true,
    removed: session === undefined,
    })
  }
  const useInput = (selector: (value: AnyRecord) => unknown): unknown =>
    input === undefined ? undefined : selector({ ...snapshot, draft: canvasDraft })
  const syncDraft = (text: string): void => {
    canvasDraftDirty.current = true
    setCanvasDraft(text)
    if (input === undefined) onDraftRef.current(window.id, text)
  }
  const commitDraft = (force = false): void => {
    if (!force && !canvasDraftDirty.current) return
    canvasDraftDirty.current = false
    if (input !== undefined) input.setDraft(canvasDraftRef.current)
    else onDraftRef.current(window.id, canvasDraftRef.current)
  }
  const onComposerBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    commitDraft()
  }
  const commitDraftRef = useRef(commitDraft)
  commitDraftRef.current = commitDraft
  useEffect(() => () => { commitDraftRef.current() }, [])
  const toggleCommandMenu = (selection?: AnyRecord): void => {
    if (inputTriggers !== undefined) {
      const span = selection ?? { start: 0, end: 0, draftRev: Number(snapshot.draftRev ?? 0) }
      inputTriggers.toggleSource('command', {
        trigger: '/', query: '', quoted: false, position: 'leading',
        span: { start: Number(span.start ?? 0), end: Number(span.end ?? 0), draftRev: Number(span.draftRev ?? 0) },
      })
      return
    }
    return
  }
  useEffect(() => {
    if (editor === undefined) return
    return editor.registerUpdateListener(({ editorState, tags }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent()
        if (tags.has('loom-canvas-sync')) return
        syncDraft(text)
      })
    })
  }, [editor, window.id])
  useEffect(() => {
    // While Canvas owns focus, let its editor finish the current edit without
    // allowing the still-uncommitted host draft to overwrite it. Once focus
    // leaves, commitDraft writes the canonical value and this effect resumes
    // the ordinary host -> Canvas synchronization path.
    // After a successful Canvas send, the host may publish the submitted draft
    // once more while its own submit transaction settles. Keep the local
    // editor empty until the host publishes the corresponding empty draft.
    if (pendingSubmitClear.current) {
      if (snapshot.draft !== '') return
      pendingSubmitClear.current = false
    }
    if (canvasDraftDirty.current) return
    if (snapshot.draft !== canvasDraft) setCanvasDraft(snapshot.draft)
  }, [canvasDraft, snapshot.draft, snapshot.phase])
  useEffect(() => {
    if (editor === undefined) return
    let current = ''
    let hasParagraph = false
    editor.getEditorState().read(() => { current = $getRoot().getTextContent() })
    editor.getEditorState().read(() => { hasParagraph = $getRoot().getChildrenSize() > 0 })
    if (current === canvasDraft && (canvasDraft !== '' || hasParagraph)) return
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      if (canvasDraft !== '') paragraph.append($createTextNode(canvasDraft))
      root.append(paragraph)
    }, { tag: 'loom-canvas-sync' })
  }, [canvasDraft, editor])
  const setDraft = (text: string, _editRange?: { start: number; end: number; insertedLength: number }): void => { syncDraft(text) }
  const submit = (): void => {
    commitDraft(true)
    onSend(window.id)
    pendingSubmitClear.current = true
    canvasDraftDirty.current = false
    setCanvasDraft('')
  }
  const inputActions = {
    setDraft,
    addImages: (ids: readonly unknown[]) => input?.addImages?.(ids) ?? false,
    removeImage: (id: unknown) => { input?.removeImage?.(id) },
    pruneImages: (ids: readonly unknown[]) => { input?.pruneImages?.(ids) },
    submit,
  }
  const keyboard = editor === undefined ? undefined : {
    snapshot: { ...snapshot, draft: canvasDraft },
    editor,
    submit: (_mode: string) => { submit() },
    steerQueue: typeof inputRuntime.steerQueue === 'function' ? () => { inputRuntime.steerQueue() } : () => {},
    paste: (text: string) => { setDraft(text) },
    caretSpan: typeof inputRuntime.caretSpan === 'function' ? () => inputRuntime.caretSpan() : () => ({ start: 0, end: 0 }),
    arbitrate: typeof inputRuntime.arbitrate === 'function' ? (key: string, composing: boolean) => inputRuntime.arbitrate(key, composing) : (_key: string, _composing: boolean) => 'pass',
    space: typeof inputRuntime.space === 'function' ? () => inputRuntime.space() : () => false,
    dismissPopup: typeof inputRuntime.dismissPopup === 'function' ? () => { inputRuntime.dismissPopup() } : () => {},
  }
  const command = session === undefined || typeof (session as AnyRecord).command !== 'function'
    ? undefined
    : async (line: string): Promise<boolean> => {
      const result = await (session as AnyRecord).command(line)
      return result?.ok === true && result.value?.matched === true
    }
  const useProjection = (key: string, selector?: (value: unknown) => unknown): unknown =>
    useNativeProjection(session, key, selector)
  const addImages = input?.createDraftImages !== undefined && input.addImages !== undefined
    ? (files: readonly File[]): string | null => {
      try {
        const attachments = input.createDraftImages!(files)
        const accepted = input.addImages!(attachments.map((attachment: unknown) => (attachment as AnyRecord).id))
        if (!accepted) {
          input.releaseDraftImages?.(attachments)
          return 'Images cannot be added while the session is busy.'
        }
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    : undefined
  const renderSlot = (key: string, owner: AnyRecord): ReactNode => {
    if (key === 'conversation.input.attachments') {
      return <NativeComposerAttachments
        attachments={owner.attachments ?? []}
        canAcceptDrop={owner.canAcceptDrop === true}
        onAddImages={owner.onAddImages ?? (() => {})}
        onRemoveImage={inputActions.removeImage}
        dropLimits={owner.dropLimits}
        t={translate as never}
      />
    }
    if (key === 'conversation.input.overlay') {
      return inputTriggers === undefined ? null : <MenuView {...menuFaceOf(inputTriggers)} t={menuTranslation as never} />
    }
    if (key === 'conversation.input.model') {
      if (window.input?.model !== undefined) {
        return <ModelSelect {...window.input.model} locked={owner.locked === true} t={modelTranslation as never} />
      }
      return <span className={css.nativeComposerModel} data-canvas-model>DeepSeek <span aria-hidden>⌄</span></span>
    }
    if (key === 'conversation.composer.dock') {
      return <div className={css.nativeComposerStats} data-dsh-stats-line><NativeStatsLine
        useChat={(selector: (value: AnyRecord) => unknown) => selector(nativeChatSnapshot(window.chatSnapshot ?? sessionSnapshot(window).chat))}
        useProjection={useProjection}
        t={translate}
      /></div>
    }
    return null
  }
  return (
    <div className={css.nativeComposerSeat} data-composer-seat onBlur={onComposerBlur}>
      <NativeInputBar
      useSession={useSession}
      useInput={useInput}
      inputActions={inputActions}
      keyboard={keyboard}
      addImages={addImages}
      removeImage={input?.removeImage}
      draftImages={input?.draftImages}
      resolveSubmitMode={(_running: boolean, gesture: string) => gesture === 'steer' ? 'steer' : 'queue'}
      toggleCommandMenu={toggleCommandMenu}
      stop={() => { onCancel(window.id) }}
      command={command}
      t={translate}
      renderSlot={renderSlot}
      useNotices={(selector: (value: unknown) => unknown) => selector(rawInput?.notices?.getSnapshot?.() ?? null)}
      useLexicon={(selector: (value: ReadonlyMap<string, readonly string[]>) => unknown) => selector(rawInput?.lexicon?.getSnapshot?.() ?? inputTriggers?.lexicon.getSnapshot() ?? new Map())}
      useMenuLauncher={(selector: (value: string | null) => unknown) => selector(launcher)}
      useProjection={useProjection}
      sessionId={window.id}
      variant="composer"
      disabled={session === undefined}
      placeholder={translate('placeholder.default')}
      />
    </div>
  )
}
