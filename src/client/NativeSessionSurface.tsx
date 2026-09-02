import { useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasSessionWindowSnapshot } from './controller.js'
import type { NS } from './locales.js'
import { nativeChatSnapshot, readChatTranscript } from './chat-snapshot.js'
import { ChatView } from '../vendor/dsh-harness-chat/chat/ChatView.js'
import { AssistantNodeView } from '../vendor/dsh-harness-chat/chat/AssistantNodeView.js'
import {
  CompactionNodeView, ContextMessageNodeView,
  RetryNodeView, TurnErrorNodeView, TurnMaxTokensNodeView, UnknownNodeView,
  UserMessageNodeView,
} from '../vendor/dsh-harness-chat/chat/MessageItem.js'
import { CommandNodeView, ManualCompactionNodeView } from '../vendor/dsh-harness-chat/chat/CommandNodeView.js'
import { TurnTailNodeView } from '../vendor/dsh-harness-chat/chat/TurnTailNodeView.js'
import { en as chatEn, zh as chatZh } from '../vendor/dsh-harness-chat/locale.js'
import { SystemPromptNodeView } from '../vendor/dsh-harness-chat/chat/SystemPromptRow.js'
import { ToolCallNodeView } from '../vendor/dsh-harness-chat/chat/ToolCallNodeView.js'
import { en as conversationEn, zh as conversationZh } from '../vendor/dsh-harness-conversation/locales.js'
import { CanvasBranchAction } from './CanvasBranchAction.js'
import { MessageImages } from '../vendor/dsh-harness-attachment/client/MessageImages.js'
import { displaySelectionMessageText } from './selection-prompt.js'
import css from './CanvasOverlay.module.css'

type NativeComponent = (props: Record<string, unknown>) => ReactNode
const NativeChatView = ChatView as unknown as NativeComponent
const NativeAssistantNodeView = AssistantNodeView as unknown as NativeComponent
const NativeUserMessageNodeView = UserMessageNodeView as unknown as NativeComponent
const NativeContextMessageNodeView = ContextMessageNodeView as unknown as NativeComponent
const NativeCommandNodeView = CommandNodeView as unknown as NativeComponent
const NativeManualCompactionNodeView = ManualCompactionNodeView as unknown as NativeComponent
const NativeCompactionNodeView = CompactionNodeView as unknown as NativeComponent
const NativeRetryNodeView = RetryNodeView as unknown as NativeComponent
const NativeTurnErrorNodeView = TurnErrorNodeView as unknown as NativeComponent
const NativeTurnMaxTokensNodeView = TurnMaxTokensNodeView as unknown as NativeComponent
const NativeTurnTailNodeView = TurnTailNodeView as unknown as NativeComponent
const NativeSystemPromptNodeView = SystemPromptNodeView as unknown as NativeComponent
const NativeToolCallNodeView = ToolCallNodeView as unknown as NativeComponent
const NativeUnknownNodeView = UnknownNodeView as unknown as NativeComponent
const NativeMessageImages = MessageImages as unknown as NativeComponent

type NativeSnapshot = Record<string, unknown> & {
  chat: Record<string, unknown>
  running: boolean
  openState: string
  hasMore: boolean
  loadingOlder: boolean
  openError: unknown
  queue: readonly unknown[]
  pendingSubmissions: readonly unknown[]
}

type NativeTranslate = (key: string, params?: Record<string, unknown>) => string

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

export function nativeTranslation(t: TranslateNS<typeof NS>): NativeTranslate {
  const isChinese = t('running') === '运行中'
  const fallback: Record<string, string> = {
    ...(isChinese ? chatZh : chatEn),
    ...(isChinese ? conversationZh : conversationEn),
    copy: 'Copy',
    copied: 'Copied',
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    loading: 'Loading…',
    'chat.loadingHistory': 'Loading history…',
    'chat.loadOlder': 'Load older',
    'chat.toBottom': 'Jump to latest',
    'chat.deepDiving': 'Deep diving...',
    'json.truncated': 'Content truncated ({total} characters)',
    'message.contextInjection': 'Context injection',
    'message.contextRecall': 'Context recall',
    'message.context.catalog.more': 'More context',
    'message.context.catalog.replaced': 'Context catalog updated',
    'message.context.recall.counts': '{messages} messages · {sessions} sessions',
    'message.context.recall.truncated': 'Context recall truncated',
    'message.context.relay.from': 'Relayed from {source}',
    'message.context.snapshot.supersedes': 'This snapshot supersedes earlier context snapshots.',
    'message.unknownBlock': 'Unknown block',
    'message.extraBlock': 'Additional content',
    'message.unknownSurface': 'Unknown message',
    'message.stopped': 'Stopped',
    'message.think': 'Think',
    'message.turnError': 'Turn failed',
    'message.maxTokens': 'Maximum tokens reached',
    'message.maxTokens.hint': 'The response was stopped at the model output limit.',
    'message.branch': 'Branch',
    'message.branchUnavailable': 'Branch unavailable',
    'image.label': 'Image',
    'image.openOriginal': 'Open original image',
    'image.openOriginalLabel': 'Open original image: {label}',
    'image.loading': 'Loading…',
    'image.loadFailed': 'Unable to load image; click to retry',
    'image.preview': 'Image preview',
    'image.closePreview': 'Close image preview',
    'message.retry.active': 'Retrying',
    'message.retry.cancelled': 'Retry cancelled',
    'message.retry.started': 'Retry started',
    'message.retry.scheduled': 'Retry scheduled',
    'message.retry.status': '{label} · attempt {retry}/{maximum} · {seconds}s',
    'message.retry.delay': 'Delay',
    'message.retry.failure': 'Failure',
    'message.referenceSummary': 'Referenced: {labels}',
    'message.referenceSeparator': ', ',
    'row.running': 'Running',
    'duration.seconds': '{seconds}s',
    'duration.minutes': '{minutes}m{seconds}s',
    'clock.md': '{m}/{d}',
    'clock.ymd': '{y}/{m}/{d}',
    'message.ranFor': 'Ran for {duration}',
    'message.ttft': 'TTFT {seconds}s',
    'message.tokensPerSecond': '{tps} tok/s',
    branchLoom: 'Branch into Loom Chat',
    'fileOpen.unknown': 'Unable to open this path.',
    'fileOpen.folderUnknown': 'Unable to open this folder.',
    'fileOpen.title': 'Unable to open file',
    'fileOpen.folderTitle': 'Unable to open folder',
  }
  const localizedFallback: Record<string, string> = isChinese
    ? { ...chatZh, ...conversationZh }
    : {}
  return (key, params) => {
    const ownKey = key as keyof typeof NS
    let value: string
    try {
      const translated = t(ownKey as never, params)
      value = typeof translated === 'string' ? translated : ''
    } catch {
      value = ''
    }
    if (isChinese) value = localizedFallback[key] ?? value
    if (value === '' || value === key) value = fallback[key] ?? key
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }
}

function dataForLegacyNode(node: ReturnType<typeof readChatTranscript>[number], index: number): Record<string, unknown> {
  const time = 0
  if (node.kind === 'user' || node.kind === 'steering') {
    return {
      key: String(node.key ?? node.seq ?? index),
      kind: node.kind,
      location: { kind: 'step', turn: 1, step: index + 1 },
      data: {
        kind: node.kind,
        seq: node.seq ?? index,
        time,
        content: displayUserContent([{ type: 'text', text: node.text }]),
        source: node.raw,
      },
    }
  }
  if (node.kind === 'assistant') {
    const messageId = node.messageId ?? String(node.key ?? node.seq ?? index)
    const seq = node.seq ?? index
    return {
      key: String(node.key ?? node.seq ?? index),
      kind: 'assistant-step',
      ...(node.seq === undefined ? {} : { seq: node.seq }),
      location: { kind: 'step', turn: 1, step: index + 1 },
      data: {
        status: 'settled',
        turn: 1,
        step: index + 1,
        ...(node.seq === undefined ? {} : { seq: node.seq }),
        time,
        finalNode: { seq, messageId },
        blocks: node.blocks.map(block => block.kind === 'code'
          ? { kind: 'other', block: block.raw }
          : block.kind === 'reasoning'
            ? { kind: 'reasoning', text: block.text }
            : { kind: 'text', text: block.text }),
      },
    }
  }
  if (node.kind === 'context') {
    return {
      key: String(node.key ?? node.seq ?? index),
      kind: 'context',
      location: { kind: 'step', turn: 1, step: index + 1 },
      data: {
        kind: 'context',
        seq: node.seq ?? index,
        time,
        content: [{ type: 'text', text: node.text }],
        source: node.raw,
        provenance: { role: 'inject', label: null },
        form: null,
      },
    }
  }
  return {
    key: String(node.key ?? node.seq ?? index),
    kind: 'unknown',
    location: { kind: 'step', turn: 1, step: index + 1 },
    data: { type: node.kind, data: node.raw },
  }
}

function displayUserContent(content: readonly unknown[]): unknown[] {
  const textBlocks = content.filter(item => record(item)?.type === 'text')
  const text = textBlocks.map(item => record(item)?.text).filter((item): item is string => typeof item === 'string').join('')
  const displayed = displaySelectionMessageText(text)
  if (displayed === text) return [...content]
  const firstTextIndex = content.findIndex(item => record(item)?.type === 'text')
  return content.flatMap((item, index) => {
    if (record(item)?.type !== 'text') return [item]
    if (index !== firstTextIndex || displayed === '') return []
    return [{ type: 'text', text: displayed }]
  })
}

function displayNodeForCanvas(node: Record<string, unknown>): Record<string, unknown> {
  if (node.kind === 'assistant-step') {
    const data = record(node.data)
    if (data !== undefined && Array.isArray(data.blocks)) {
      const blocks = data.blocks.map(block => {
        const item = record(block)
        if (item?.kind === 'markdown') return { ...item, kind: 'text' }
        if (item?.kind === 'code' && typeof item.code === 'string') return { kind: 'text', text: item.code }
        if (item?.kind === 'tool-call' && typeof item.callId !== 'string') {
          const name = typeof item.name === 'string' ? item.name : 'Tool activity'
          return { kind: 'text', text: name }
        }
        if (item?.kind === 'image' && item.attachment === undefined) {
          return { kind: 'text', text: typeof item.name === 'string' ? item.name : 'Image' }
        }
        return block
      })
      return { ...node, data: { ...data, blocks } }
    }
    return node
  }
  if (node.kind !== 'user' && node.kind !== 'steering') return node
  const data = record(node.data)
  if (data === undefined || !Array.isArray(data.content)) return node
  return { ...node, data: { ...data, content: displayUserContent(data.content) } }
}

function addLegacyLocations(sourceChat: Record<string, unknown>, order: readonly unknown[], nodes: unknown): Record<string, unknown> {
  const getter = record(nodes)?.get
  if (typeof getter !== 'function') return sourceChat
  const normalized = new Map<string, unknown>()
  order.forEach((keyValue, index) => {
    const key = String(keyValue)
    const item = record(getter.call(nodes, keyValue))
    if (item === undefined) return
    if (item.location !== undefined) {
      normalized.set(key, item)
      return
    }
    const data = record(item.data)
    normalized.set(key, {
      ...item,
      key: item.key ?? key,
      location: {
        kind: 'step',
        turn: typeof data?.turn === 'number' ? data.turn : 1,
        step: typeof data?.step === 'number' ? data.step : index + 1,
      },
    })
  })
  return { ...sourceChat, nodes: normalized }
}

function keyedNodeCount(order: unknown, nodes: unknown): number {
  if (!Array.isArray(order)) return 0
  const getter = record(nodes)?.get
  if (typeof getter !== 'function') return 0
  let count = 0
  for (const key of order) {
    try {
      const node = getter.call(nodes, key)
      if (node !== undefined && node !== null) count += 1
    } catch {
      return 0
    }
  }
  return count
}

function addCompatibilityTurnTails(chat: Record<string, unknown>): Record<string, unknown> {
  const order = Array.isArray(chat.order) ? chat.order.map(String) : []
  const nodes = chat.nodes
  const getter = record(nodes)?.get
  if (typeof getter !== 'function') return chat
  const hasTail = order.some(key => record(getter.call(nodes, key))?.kind === 'turn-tail')
  if (hasTail) return chat
  const additions: Record<string, unknown>[] = []
  for (const key of order) {
    const node = record(getter.call(nodes, key))
    if (node?.kind !== 'assistant-step') continue
    const data = record(node.data) ?? {}
    if (data.status === 'running') continue
    const seq = typeof data.seq === 'number' ? data.seq : typeof node.seq === 'number' ? node.seq : 0
    const turn = typeof data.turn === 'number' ? data.turn : 1
    const time = typeof data.time === 'number' ? data.time : 0
    const finalNode = record(data.finalNode) ?? { seq, messageId: key }
    additions.push({
      key: `${key}:tail`,
      kind: 'turn-tail',
      location: node.location ?? { kind: 'step', turn, step: typeof data.step === 'number' ? data.step : 1 },
      data: {
        turn,
        seq: typeof finalNode.seq === 'number' ? finalNode.seq : seq,
        time,
        closing: { finalNode, blocks: Array.isArray(data.blocks) ? data.blocks : [], time },
        branchUnavailable: false,
      },
    })
  }
  if (additions.length === 0) return chat
  const map = new Map<string, unknown>(order.map(key => [key, getter.call(nodes, key)]))
  additions.forEach(item => map.set(String(item.key), item))
  return { ...chat, order: [...order, ...additions.map(item => String(item.key))], nodes: map }
}

function runningPartialNode(sourceChat: Record<string, unknown>): Record<string, unknown> | undefined {
  const legacy = record(sourceChat.legacy)
  const partial = record(legacy?.partial)
  if (partial === undefined || !Array.isArray(partial.blocks)) return undefined
  return {
    key: '__loom-running-partial__',
    kind: 'assistant-step',
    location: {
      kind: 'step',
      turn: typeof partial.turn === 'number' ? partial.turn : 1,
      step: typeof partial.step === 'number' ? partial.step : 1,
    },
    data: {
      status: 'running',
      turn: typeof partial.turn === 'number' ? partial.turn : 1,
      step: typeof partial.step === 'number' ? partial.step : 1,
      blocks: partial.blocks,
    },
  }
}

function hasRunningAssistant(order: readonly unknown[], nodes: unknown): boolean {
  const getter = record(nodes)?.get
  if (typeof getter !== 'function') return false
  return order.some(key => {
    try {
      const node = record(getter.call(nodes, key))
      return node?.kind === 'assistant-step' && record(node.data)?.status === 'running'
    } catch {
      return false
    }
  })
}

const stableSourceCache = new WeakMap<object, { signature: string; value: unknown }>()

function snapshotSignature(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Map) return [...item.entries()]
      if (item instanceof Set) return [...item.values()]
      if (typeof item === 'function') return undefined
      return item
    })
  } catch {
    return String(value)
  }
}

function stableSessionSnapshot(session: SessionFace): unknown {
  const value = session.getSnapshot() as unknown
  if (typeof value !== 'object' || value === null) return value
  const signature = snapshotSignature(value)
  const cached = stableSourceCache.get(session as object)
  if (cached?.signature === signature) return cached.value
  stableSourceCache.set(session as object, { signature, value })
  return value
}

function snapshotFromSource(value: unknown, branchBoundary: number | undefined, runningOverride: boolean): NativeSnapshot {
  const source = record(value) ?? {}
  const sourceChat = record(source.chat) ?? {}
  const order = sourceChat.order
  const nodes = sourceChat.nodes
  const legacyTranscript = readChatTranscript(source)
  // Detached sessions can expose the compatibility `nodes` projection before
  // the registered Chat target has been materialized. The order array exists,
  // but its keyed store is empty; using it would make ChatView render a blank
  // card even though the host conversation already has history.
  const keyedStoreReady = Array.isArray(order)
    && (order.length === 0 ? legacyTranscript.length === 0 : keyedNodeCount(order, nodes) === order.length)
  if (Array.isArray(order) && nodes !== undefined && (keyedStoreReady || legacyTranscript.length === 0)) {
    const normalizedOrder = order.map(key => String(key))
    let base = {
      ...source,
      chat: {
        ...addLegacyLocations(sourceChat, order, nodes),
        order: normalizedOrder,
        timeline: sourceChat.timeline ?? { turns: new Map() },
      },
      running: runningOverride || source.running === true,
      openState: typeof source.openState === 'string' ? source.openState : 'open',
      hasMore: source.hasMore === true,
      loadingOlder: source.loadingOlder === true,
      openError: source.openError ?? null,
      queue: Array.isArray(source.queue) ? source.queue : [],
      pendingSubmissions: Array.isArray(source.pendingSubmissions) ? source.pendingSubmissions : [],
    } as unknown as NativeSnapshot
    const partial = runningPartialNode(sourceChat)
    if (partial !== undefined && !hasRunningAssistant(order, nodes)) {
      const baseNodes = base.chat.nodes as unknown as Map<string, unknown>
      const partialNodes = new Map(baseNodes)
      partialNodes.set(String(partial.key), partial)
      base = {
        ...base,
        chat: {
          ...base.chat,
          nodes: partialNodes,
          order: [...base.chat.order as readonly string[], String(partial.key)],
        },
      } as NativeSnapshot
    }
    if (branchBoundary === undefined) {
      return { ...base, chat: addCompatibilityTurnTails(base.chat) } as NativeSnapshot
    }
    const baseOrder = base.chat.order as readonly string[]
    const baseNodes = base.chat.nodes as unknown
    const kept = baseOrder.filter(key => {
      const getter = record(baseNodes)?.get
      const node = typeof getter === 'function' ? getter.call(baseNodes, key) : undefined
      const item = record(node)
      const data = record(item?.data)
      const seq = typeof data?.seq === 'number' ? data.seq : typeof item?.seq === 'number' ? item.seq : undefined
      return seq === undefined || seq > branchBoundary
    })
    return { ...base, chat: { ...base.chat, order: kept.map(key => String(key)) } } as unknown as NativeSnapshot
  }

    const transcript = legacyTranscript
    .filter(node => branchBoundary === undefined || (node.anchorSeq ?? node.seq ?? Number.MAX_SAFE_INTEGER) > branchBoundary)
  const legacyNodes = transcript.map(dataForLegacyNode)
  const withTurnTails = legacyNodes.flatMap((node, index) => {
    if (node.kind !== 'assistant-step') return [node]
    const data = record(node.data) ?? {}
    const finalNode = record(data.finalNode) ?? { seq: node.seq ?? index, messageId: node.key }
    return [node, {
      key: `${node.key}:tail`,
      kind: 'turn-tail',
      location: node.location,
      data: {
        turn: 1,
        seq: typeof finalNode.seq === 'number' ? finalNode.seq : index,
        time: 0,
        closing: { finalNode, blocks: Array.isArray(data.blocks) ? data.blocks : [], time: 0 },
        branchUnavailable: false,
      },
    }]
  })
  const nodeMap = new Map(withTurnTails.map(node => [node.key, node]))
  const legacyOrder = withTurnTails.map(node => node.key)
  return {
    ...source,
    chat: {
      ...sourceChat,
      order: legacyOrder,
      nodes: nodeMap,
      timeline: { turnOrder: [1], turns: new Map() },
      locations: sourceChat.locations ?? {
        getTurn: () => legacyOrder,
        getStep: () => legacyOrder,
      },
    },
    running: runningOverride || source.running === true,
    openState: typeof source.openState === 'string' ? source.openState : 'open',
    hasMore: source.hasMore === true,
    loadingOlder: source.loadingOlder === true,
    openError: source.openError,
    queue: Array.isArray(source.queue) ? source.queue : [],
    pendingSubmissions: Array.isArray(source.pendingSubmissions) ? source.pendingSubmissions : [],
  }
}

function useSessionSelector<T>(
  session: SessionFace,
  chatSnapshot: unknown,
  branchBoundary: number | undefined,
  runningOverride: boolean,
  selector: (snapshot: NativeSnapshot) => T,
): T {
  const getSnapshot = useMemo(() => () => stableSessionSnapshot(session), [session])
  const subscribe = useMemo(() => (listener: () => void) => session.subscribe(listener), [session])
  // The host can mutate the released Session snapshot in place while the
  // notification is being flushed. Use uSES as the invalidation channel, but
  // read the latest public snapshot for the actual projection in this render.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const sessionSnapshot = stableSessionSnapshot(session)
  const source = useMemo(() => {
    const base = sessionSnapshot
    if (chatSnapshot === undefined || typeof base !== 'object' || base === null) return base
    return { ...(base as Record<string, unknown>), chat: chatSnapshot }
  }, [sessionSnapshot, chatSnapshot])
  const snapshot = useMemo(
    () => snapshotFromSource(source, branchBoundary, runningOverride),
    [source, branchBoundary, runningOverride],
  )
  return selector(snapshot)
}

function EmptyStore<T>(selector: (value: { selection?: undefined }) => T): T {
  return selector({})
}

export function NativeSessionSurface({
  window, running, onBranch, t,
}: {
  window: CanvasSessionWindowSnapshot
  running: boolean
  onBranch?: (atSeq: number) => Promise<void> | void
  t: TranslateNS<typeof NS>
}) {
  const session = window.session
  const translate = useMemo(() => nativeTranslation(t), [t])
  if (session === undefined) return null
  const branchBoundary = window.branchPrompt === undefined ? undefined : window.branchAtSeq
  const useSession = <T,>(selector: (snapshot: NativeSnapshot) => T): T => (
    useSessionSelector(session, window.chatSnapshot, branchBoundary, running, selector)
  )
  const useChat = <T,>(selector: (snapshot: Record<string, any>) => T): T => useSessionSelector(
    session,
    window.chatSnapshot,
    branchBoundary,
    running,
    snapshot => selector(nativeChatSnapshot(snapshot.chat)),
  )
  const useChatNode = (key: string): unknown => useChat(snapshot => {
    const nodes = record(snapshot.nodes)
    const getter = nodes?.get
    return typeof getter === 'function' ? getter.call(snapshot.nodes, key) : undefined
  })
  const useChatNodeProcess = (_key: string): undefined => undefined
  const renderSlotChain = (_key: string, _owner: Record<string, unknown>, opts?: { fallback?: ReactNode }): ReactNode => opts?.fallback ?? null
  const renderSlot = (key: string, owner: Record<string, unknown>, opts?: { fallback?: ReactNode; entryKey?: string }) => {
    if (key === 'conversation.message.images') {
      const images = Array.isArray(owner.images) ? owner.images as { attachment: any }[] : []
      const align = owner.align === 'end' ? 'end' : 'start'
      const loadImage = async (attachment: any): Promise<string> => {
        const loaded = await window.input?.resolveImage?.(attachment)
        return loaded ?? ''
      }
      return <NativeMessageImages images={images} loadImage={loadImage} align={align} t={translate as never} />
    }
    if (key === 'conversation.chat.assistant-actions') {
      const messageId = typeof owner.messageId === 'string' ? owner.messageId : undefined
      if (onBranch === undefined || messageId === undefined) return null
      const transcript = readChatTranscript({ ...session.getSnapshot(), chat: window.chatSnapshot })
      const message = transcript.find(node => node.kind === 'assistant'
        && (node.messageId === messageId || String(node.key) === messageId))
      const directChat = record(record(session.getSnapshot())?.chat)
      const directNodes = record(directChat?.nodes)
      const directGetter = directNodes?.get
      const direct = typeof directGetter === 'function' ? record(directGetter.call(directChat?.nodes, messageId)) : undefined
      const directData = record(direct?.data)
      const atSeq = message?.anchorSeq ?? message?.seq
        ?? (typeof directData?.seq === 'number' ? directData.seq : typeof direct?.seq === 'number' ? direct.seq : undefined)
      return typeof atSeq === 'number'
        ? <CanvasBranchAction onBranch={() => { void onBranch(atSeq) }} branchLabel={translate('branchLoom')} />
        : null
    }
    if (key !== 'conversation.chat.node') return opts?.fallback ?? null
    const node = record(owner.node) ?? {}
    const nodeKind = typeof node.kind === 'string' ? node.kind : 'unknown'
    const props = {
      ...owner,
      node: displayNodeForCanvas(node),
      useChat,
      useSession,
      renderSlot,
      renderSlotChain,
      useTurnData: (_key: string) => undefined,
      t: translate,
    }
    if (nodeKind === 'user' || nodeKind === 'steering') return <NativeUserMessageNodeView {...props} />
    if (nodeKind === 'assistant-step') return <NativeAssistantNodeView {...props} />
    if (nodeKind === 'context') return <NativeContextMessageNodeView {...props} />
    if (nodeKind === 'command') return <NativeCommandNodeView {...props} />
    if (nodeKind === 'manual-compaction') return <NativeManualCompactionNodeView {...props} />
    if (nodeKind === 'compaction') return <NativeCompactionNodeView {...props} />
    if (nodeKind === 'model-retry') return <NativeRetryNodeView {...props} />
    if (nodeKind === 'turn-error') return <NativeTurnErrorNodeView {...props} />
    if (nodeKind === 'turn-max-tokens') return <NativeTurnMaxTokensNodeView {...props} />
    if (nodeKind === 'turn-tail') return <NativeTurnTailNodeView {...props} />
    if (nodeKind === 'system-prompt') return <NativeSystemPromptNodeView {...props} />
    if (nodeKind === 'tool-call') return <NativeToolCallNodeView {...props} />
    if (nodeKind === 'turn-process') return null
    return <NativeUnknownNodeView {...props} />
  }
  const sessionProps = {
    useSession,
    useChat,
    useChatNode,
    useChatNodeProcess,
    useSessions: <T,>(selector: (value: { byId: Record<string, { cwd?: string }> }) => T): T => {
      const state = record(session.getSnapshot()) ?? {}
      const cwd = typeof state.cwd === 'string' ? state.cwd : undefined
      return selector({ byId: { [String(window.id)]: cwd === undefined ? {} : { cwd } } })
    },
    useStore: EmptyStore,
    actions: { setTurnProcessOpen: () => {} },
    useInput: <T,>(selector: (value: Record<string, unknown>) => T): T => selector({}),
    inputActions: { setDraft: () => {}, submit: () => {} },
    useTranscriptView: <T,>(selector: (value: 'normal' | 'compact') => T): T => selector('normal'),
    useProjection: () => undefined,
    sessionId: window.id as SessionId,
    openFile: async (_path: string) => {},
    loadOlder: () => { void session.loadOlder() },
    loadThrough: async (seq: number) => {
      const load = (session as unknown as Record<string, unknown>).loadThrough
      if (typeof load === 'function') await load.call(session, seq)
      else await session.loadOlder()
    },
    openView: (_view: string, _focus: string) => {},
    loadImage: async (attachment: unknown) => window.input?.resolveImage?.(attachment) ?? '',
    inspectCall: (_callId: string) => {},
    chatScroll: { save: (_position: unknown) => {}, read: () => null },
    forkAt: (seq: number) => { if (onBranch !== undefined) void onBranch(seq) },
    fileMentions: (_owner: unknown) => undefined,
    renderSlot,
    renderSlotChain,
    t: translate,
  }
  return (
    <div
      className={css.nativeSession}
      data-loom-native-session
      data-dsh-chat-view
      data-conversation-embedded=""
    >
      <NativeChatView
        {...sessionProps}
        {...(branchBoundary === undefined ? {} : { afterSeq: branchBoundary })}
        key={`${String(window.id)}:${branchBoundary ?? 'all'}`}
      />
    </div>
  )
}
