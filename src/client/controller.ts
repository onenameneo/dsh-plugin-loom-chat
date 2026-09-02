import type { ISessions, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  buildSessionGraph, CANVAS_WINDOW_HEIGHT, CANVAS_WINDOW_WIDTH, latestStableBoundary,
} from './session-graph.js'
import type { SessionGraphEdge, SessionGraphNode } from './session-graph.js'
import { resolveSelectionTarget } from './selection-target.js'
import type { SelectionTarget } from './selection-target.js'
import { buildSelectionPrompt } from './selection-prompt.js'
import { readChatTranscript } from './chat-snapshot.js'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Minimal input face needed by the Canvas and selection branch flows. */
export interface LoomSessionInput {
  setDraft(text: string, editRange?: { start: number; end: number; insertedLength: number }): void
  addImages?(ids: readonly unknown[]): boolean
  removeImage?(id: unknown): void
  pruneImages?(ids: readonly unknown[]): void
  submit?(): void
  state?: HostObservable<LoomInputState>
  createDraftImages?(files: readonly File[]): readonly unknown[]
  draftImages?(ids: readonly unknown[]): readonly unknown[]
  releaseDraftImages?(attachments: readonly unknown[]): void
  resolveImage?(attachment: unknown): Promise<string>
  /** Host-owned model directory and selector operations for this session. */
  model?: ModelSelectInjected
  /** Host-owned slash command controller used by the native MenuView. */
  inputTriggers?: InputTriggerController
}

/** Stable input state projection consumed by a Canvas composer. */
export interface LoomInputState {
  readonly draft: string
  readonly phase: string
}

/** Rectangle used by the selection action popover. */
export interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

/** Top-level Loom navigation state. */
export type LoomMode = 'canvas' | 'session'

/** Runtime viewport of the in-memory Canvas surface. */
export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

/** Canvas node with controller-owned selection and branch affordances. */
export interface CanvasNodeSnapshot extends SessionGraphNode {
  selected: boolean
  canBranch: boolean
  error: string | null
}

/** One directly interactive Canvas window bound to one DSH session. */
export interface CanvasSessionWindowSnapshot extends CanvasNodeSnapshot {
  session: SessionFace | undefined
  /** Current host Chat target snapshot; kept separate from Session lifecycle state in alpha4. */
  chatSnapshot?: unknown
  input: LoomSessionInput | undefined
  inputState: LoomInputState | undefined
  /** Plugin-owned prompt shown instead of inherited history for a selection branch. */
  branchPrompt?: string
  /** Durable sequence before which inherited fork history stays hidden. */
  branchAtSeq?: number
  /** True after the branch receives its first accepted continuation. */
  branchContinued?: boolean
}

/** Observable state consumed by Canvas and additive conversation actions. */
export interface LoomChatSnapshot {
  mode: LoomMode
  currentSessionId: SessionId | undefined
  selectedSessionId: SessionId | undefined
  nodes: readonly CanvasNodeSnapshot[]
  windows: readonly CanvasSessionWindowSnapshot[]
  edges: readonly SessionGraphEdge[]
  viewport: CanvasViewport
  selection: {
    target: SelectionTarget | null
    rect: SelectionRect | null
    pending: boolean
    error: string | null
  }
}

/** Stable observable source used by the renderer without importing React. */
class SnapshotSource<T> implements HostObservable<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private snapshot: T) {}

  getSnapshot = (): T => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(snapshot: T): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 }
const BRANCH_PRESENTATION_STORAGE_PREFIX = 'dsh-loom-chat:branch-presentation:'
const BRANCH_TITLE_STORAGE_PREFIX = 'dsh-loom-chat:branch-title-derived:'
const BRANCH_BOUNDARY_STORAGE_PREFIX = 'dsh-loom-chat:branch-boundary:'
const BRANCH_TITLE_MAX_CHARS = 30

interface BranchPresentation {
  branchPrompt: string
  branchAtSeq: number
  branchContinued: boolean
  branchBoundaryResolved: boolean
}

function branchPresentationStorageKey(id: SessionId): string {
  return `${BRANCH_PRESENTATION_STORAGE_PREFIX}${String(id)}`
}

function readBranchPresentation(id: SessionId): BranchPresentation | undefined {
  try {
    const raw = window.localStorage.getItem(branchPresentationStorageKey(id))
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return undefined
    const item = value as Record<string, unknown>
    return typeof item.branchPrompt === 'string'
      && typeof item.branchAtSeq === 'number'
      && Number.isFinite(item.branchAtSeq)
      && typeof item.branchContinued === 'boolean'
      && typeof item.branchBoundaryResolved === 'boolean'
      ? {
        branchPrompt: item.branchPrompt,
        branchAtSeq: item.branchAtSeq,
        branchContinued: item.branchContinued,
        branchBoundaryResolved: item.branchBoundaryResolved,
      }
      : undefined
  } catch {
    return undefined
  }
}

function writeBranchPresentation(id: SessionId, presentation: BranchPresentation): void {
  try {
    window.localStorage.setItem(branchPresentationStorageKey(id), JSON.stringify(presentation))
  } catch {
    return
  }
}

function removeBranchPresentation(id: SessionId): void {
  try {
    window.localStorage.removeItem(branchPresentationStorageKey(id))
  } catch {
    return
  }
}

function branchTitleStorageKey(id: SessionId): string {
  return `${BRANCH_TITLE_STORAGE_PREFIX}${String(id)}`
}

function readDerivedBranchTitle(id: SessionId): string | undefined {
  try {
    const value = window.localStorage.getItem(branchTitleStorageKey(id))
    return value === null || value === '1' ? undefined : value
  } catch {
    return undefined
  }
}

function writeDerivedBranchTitle(id: SessionId, title: string): void {
  try {
    window.localStorage.setItem(branchTitleStorageKey(id), title)
  } catch {
    return
  }
}

function removeDerivedBranchTitle(id: SessionId): void {
  try {
    window.localStorage.removeItem(branchTitleStorageKey(id))
  } catch {
    return
  }
}

function branchBoundaryStorageKey(id: SessionId): string {
  return `${BRANCH_BOUNDARY_STORAGE_PREFIX}${String(id)}`
}

function readBranchBoundary(id: SessionId): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(branchBoundaryStorageKey(id)))
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  } catch {
    return undefined
  }
}

function writeBranchBoundary(id: SessionId, atSeq: number): void {
  try {
    window.localStorage.setItem(branchBoundaryStorageKey(id), String(atSeq))
  } catch {
    return
  }
}

function removeBranchBoundary(id: SessionId): void {
  try {
    window.localStorage.removeItem(branchBoundaryStorageKey(id))
  } catch {
    return
  }
}

/** Derive a compact child title without sending an auxiliary model request. */
function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length > BRANCH_TITLE_MAX_CHARS
    ? `${characters.slice(0, BRANCH_TITLE_MAX_CHARS).join('')}…`
    : normalized
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function chatNodeAt(snapshot: unknown, key: string): ChatConversationViewNode | undefined {
  const item = record(snapshot)
  const chat = record(item?.chat)
  const nodes = record(chat?.nodes)
  const get = nodes?.get
  if (typeof get !== 'function') return undefined
  const node = get.call(chat?.nodes, key) as ChatConversationViewNode | undefined
  if (node === undefined || node.key === key) return node
  // Released snapshots may keep the stable node key only in the ordered map.
  // Add it back at the public adapter boundary so Canvas selection can use the
  // same validation path as the host conversation renderer.
  return { ...node, key }
}

function firstUserPromptAfter(snapshot: unknown, atSeq: number): string | undefined {
  for (const node of readChatTranscript(snapshot)) {
    const seq = node.anchorSeq ?? node.seq
    if (node.kind !== 'user' || seq === undefined || seq <= atSeq) continue
    if (node.text.length > 0) return node.text
  }
  return undefined
}

const INITIAL_SNAPSHOT: LoomChatSnapshot = {
  mode: 'session',
  currentSessionId: undefined,
  selectedSessionId: undefined,
  nodes: [],
  windows: [],
  edges: [],
  viewport: DEFAULT_VIEWPORT,
  selection: { target: null, rect: null, pending: false, error: null },
}

/** Find the conversation flow row owning one DOM selection endpoint. */
function flowElement(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-chat-flow-key]') ?? null
}

/**
 * Coordinates Canvas navigation, live per-session windows, DSH session
 * selection, and durable forks. Native focus-mode rendering remains owned by
 * the host session surface.
 */
export class LoomChatController implements HostObservable<LoomChatSnapshot> {
  /** Observable root snapshot consumed by the Canvas and selection action. */
  readonly view = new SnapshotSource(INITIAL_SNAPSHOT)
  private readonly sessionUnsubs = new Map<SessionId, () => void>()
  private readonly errors = new Map<SessionId, string>()
  private readonly presentations = new Map<SessionId, {
    branchPrompt: string
    branchAtSeq: number
    branchContinued: boolean
    branchBoundaryResolved: boolean
  }>()
  private readonly derivedBranchTitles = new Map<SessionId, string>()
  private readonly failedBranchTitles = new Map<SessionId, string>()
  private readonly branchBoundaries = new Map<SessionId, number>()
  private readonly archivedLocally = new Set<SessionId>()
  private readonly archiveFailures = new Set<SessionId>()
  private selectedSessionId: SessionId | undefined
  private canvasReturnSessionId: SessionId | undefined
  private pendingFocusId: SessionId | undefined
  private mode: LoomMode = 'session'
  private viewport: CanvasViewport = DEFAULT_VIEWPORT
  private selectionTarget: SelectionTarget | null = null
  private selectionRect: SelectionRect | null = null
  private selectionPending = false
  private selectionError: string | null = null
  private selectionPointerActive = false
  private readonly disposeList: () => void
  private readonly disposeWorkspaces: (() => void) | undefined
  private disposed = false
  private operationSeq = 0
  private hydrationQueue: Promise<void> = Promise.resolve()
  private readonly hydrating = new Set<SessionId>()

  /**
   * @param sessions - public DSH session list, selection, binding, and fork face.
   * @param inputFor - optional per-session input face used by Canvas and selection branching.
   */
  constructor(
    private readonly sessions: ISessions,
    private readonly inputFor?: (sessionId: SessionId) => LoomSessionInput | undefined,
    private readonly workspaces?: IWorkspaces,
    private readonly uiConversation?: UiConversation,
  ) {
    this.disposeList = sessions.list.subscribe(() => { this.reconcile() })
    this.disposeWorkspaces = workspaces?.list.subscribe(() => { this.reconcile() })
    document.addEventListener('selectionchange', this.onSelectionChange)
    document.addEventListener('pointerdown', this.onPointerDown, true)
    document.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('resize', this.onViewportChange)
    window.addEventListener('scroll', this.onViewportChange, true)
    this.reconcile()
  }

  getSnapshot = (): LoomChatSnapshot => this.view.getSnapshot()
  subscribe = (listener: () => void): (() => void) => this.view.subscribe(listener)

  /** Open the full-workspace Canvas without changing the selected DSH session. */
  openCanvas(): void {
    const current = this.sessions.list.getSnapshot().current
    if (this.mode !== 'canvas') this.canvasReturnSessionId = current ?? this.selectedSessionId
    if (this.selectedSessionId === undefined) {
      const visible = this.visibleSummaries()
      this.selectedSessionId = visible.find(summary => summary.id === current)?.id ?? visible[0]?.id
    }
    this.mode = 'canvas'
    this.publish()
    this.queueDetachedHydration()
  }

  /** Leave Canvas and reopen the session that was active before Canvas. */
  closeCanvas(): void {
    const visible = new Set(this.visibleSummaries().map(summary => summary.id))
    const current = this.sessions.list.getSnapshot().current
    const id = [this.canvasReturnSessionId, this.selectedSessionId, current]
      .find(candidate => candidate !== undefined && visible.has(candidate))
      ?? this.visibleSummaries()[0]?.id
    this.mode = 'session'
    if (id !== undefined) {
      this.selectedSessionId = id
      this.sessions.open(id)
    }
    this.publish()
  }

  /** Select and open one native DSH session, leaving Canvas mode. */
  openSession(id: SessionId): void {
    this.selectedSessionId = id
    this.sessions.open(id)
    this.mode = 'session'
    this.publish()
  }

  /** Select a Canvas node without opening the native conversation. */
  selectNode(id: SessionId): void {
    if (!this.getSnapshot().nodes.some(node => node.id === id)) return
    this.selectedSessionId = id
    this.publish()
  }

  /** Keep the Canvas composer and ordinary composer on the same host draft. */
  setDraft(sessionId: SessionId, text: string): void {
    this.inputFor?.(sessionId)?.setDraft(text)
  }

  /** Submit the current draft belonging to exactly one Canvas window. */
  sendSession(sessionId: SessionId, text?: string): void {
    try {
      const input = this.inputFor?.(sessionId)
      if (input === undefined || input.submit === undefined) throw new Error(`session ${sessionId} composer is unavailable`)
      const presentation = this.presentations.get(sessionId)
      const draft = text ?? input.state?.getSnapshot()?.draft ?? ''
      const userPrompt = draft.trim()
      if (presentation?.branchPrompt !== undefined && !presentation.branchContinued) {
        const selectedPrompt = buildSelectionPrompt(presentation.branchPrompt)
        input.setDraft(draft.trim().length === 0 ? selectedPrompt : `${selectedPrompt}\n\n${draft}`)
      } else if (text !== undefined) {
        input.setDraft(text)
      }
      input.submit()
      // The input machine keeps a submitting draft visible for ordinary
      // composer recovery. Canvas has already handed the draft to submit,
      // so clear it after acceptance to leave the Canvas editor ready for
      // the next message. Failed submits stay intact for retry via catch.
      input.setDraft('')
      const summary = this.sessions.list.getSnapshot().byId[sessionId]
      const session = this.sessions.binding(sessionId)?.session
      if (summary?.parentId !== undefined && session !== undefined) this.deriveBranchTitle(sessionId, userPrompt)
      if (presentation !== undefined && !presentation.branchContinued) {
        presentation.branchContinued = true
        writeBranchPresentation(sessionId, presentation)
        this.publish()
      }
    } catch (error) {
      this.errors.set(sessionId, error instanceof Error ? error.message : String(error))
      this.publish()
    }
  }

  /** Cancel only the selected Canvas window's running DSH session. */
  async cancelSession(sessionId: SessionId): Promise<void> {
    try {
      const session = this.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`session ${sessionId} is unavailable`)
      await session.cancel()
    } catch (error) {
      this.errors.set(sessionId, error instanceof Error ? error.message : String(error))
      this.publish()
    }
  }

  /** Create a Canvas child while keeping the Canvas mounted and interactive. */
  async branchSession(sessionId: SessionId): Promise<void> {
    const binding = this.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`session ${sessionId} is unavailable`)
    const atSeq = latestStableBoundary(this.snapshotFor(sessionId, binding.session))
    if (atSeq === undefined) throw new Error(`session ${sessionId} has no stable fork boundary`)
    const operation = ++this.operationSeq
    try {
      const childId = await this.sessions.fork({ sessionId, atSeq, increaseTitle: true })
      if (!this.activeOperation(operation)) return
      this.setBranchBoundary(childId, atSeq)
      this.enterCanvasWith(childId, sessionId)
      this.errors.delete(sessionId)
      this.publish()
    } catch (error) {
      if (this.activeOperation(operation)) {
        this.errors.set(sessionId, error instanceof Error ? error.message : String(error))
        this.publish()
      }
      throw error
    }
  }

  /** Update the in-memory Canvas viewport. */
  setViewport(viewport: CanvasViewport): void {
    this.viewport = {
      x: viewport.x,
      y: viewport.y,
      scale: Math.min(2, Math.max(0.55, viewport.scale)),
    }
    this.publish()
  }

  /** Restore the default Canvas viewport. */
  resetViewport(): void {
    this.viewport = DEFAULT_VIEWPORT
    this.publish()
  }

  /** Create a child from the selected session's latest completed turn. */
  async branchSelected(): Promise<void> {
    const id = this.selectedSessionId ?? this.sessions.list.getSnapshot().current
    if (id === undefined) throw new Error('no session selected')
    const binding = this.sessions.binding(id)
    if (binding === undefined) throw new Error(`session ${id} is unavailable`)
    const atSeq = latestStableBoundary(this.snapshotFor(id, binding.session))
    if (atSeq === undefined) throw new Error(`session ${id} has no stable fork boundary`)
    await this.forkAndCanvas(id, atSeq)
  }

  /** Fork one completed assistant message and focus the child in Canvas. */
  async forkAt(sessionId: SessionId, atSeq: number): Promise<void> {
    const target = this.selectionTarget?.sessionId === sessionId && this.selectionTarget.atSeq === atSeq
      ? this.selectionTarget
      : undefined
    await this.forkAndCanvas(sessionId, atSeq, target?.text)
  }

  /** Fork the current finalized assistant selection into a reference-only Canvas window. */
  async forkSelection(): Promise<void> {
    const target = this.selectionTarget
    if (target === null || this.selectionPending) return
    const operation = ++this.operationSeq
    this.selectionPending = true
    this.selectionError = null
    this.publish()
    try {
      const childId = await this.sessions.fork({
        sessionId: target.sessionId,
        atSeq: target.atSeq,
        increaseTitle: true,
      })
      if (!this.activeOperation(operation)) return
      this.setBranchBoundary(childId, target.atSeq)
      const input = this.inputFor?.(childId)
      if (input === undefined) throw new Error(`fork child ${childId} composer is unavailable`)
      input.setDraft('')
      this.setPresentation(childId, {
        branchPrompt: target.text,
        branchAtSeq: target.atSeq,
        branchContinued: false,
        branchBoundaryResolved: false,
      })
      this.enterCanvasWith(childId, target.sessionId)
      this.selectionTarget = null
      this.selectionRect = null
      this.selectionError = null
    } catch (error) {
      if (this.activeOperation(operation)) this.selectionError = error instanceof Error ? error.message : String(error)
    } finally {
      if (!this.activeOperation(operation)) return
      this.selectionPending = false
      this.publish()
    }
  }

  /** Archive one Canvas window and all ordinary descendants. */
  async deleteSession(sessionId: SessionId): Promise<void> {
    if (this.workspaces === undefined) throw new Error('session archive is unavailable')
    const graph = buildSessionGraph(this.visibleSummaries())
    const target = graph.nodes.find(node => node.id === sessionId)
    if (target === undefined) throw new Error(`session ${sessionId} is unavailable`)
    const subtree = graph.nodes.filter(node => node.id === sessionId || this.isDescendant(node.id, sessionId, graph.nodes))
    try {
      for (const node of subtree) await this.workspaces.archiveSession(node.id)
      for (const node of subtree) {
        this.archivedLocally.add(node.id)
        this.archiveFailures.delete(node.id)
        this.presentations.delete(node.id)
        removeBranchPresentation(node.id)
        this.derivedBranchTitles.delete(node.id)
        this.failedBranchTitles.delete(node.id)
        removeDerivedBranchTitle(node.id)
        this.branchBoundaries.delete(node.id)
        removeBranchBoundary(node.id)
        this.errors.delete(node.id)
      }
      if (subtree.some(node => node.id === this.selectedSessionId)) {
        const parent = target.parentId === undefined || this.archivedLocally.has(target.parentId)
          ? graph.nodes.find(node => !this.archivedLocally.has(node.id) && node.id !== sessionId)
          : graph.nodes.find(node => node.id === target.parentId)
        this.selectedSessionId = parent?.id
      }
      this.publish()
    } catch (error) {
      for (const node of subtree) this.archiveFailures.add(node.id)
      this.errors.set(sessionId, error instanceof Error ? error.message : String(error))
      this.publish()
      throw error
    }
  }

  /** Release DOM listeners and all session subscriptions. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.operationSeq += 1
    this.disposeList()
    this.disposeWorkspaces?.()
    for (const dispose of this.sessionUnsubs.values()) dispose()
    this.sessionUnsubs.clear()
    document.removeEventListener('selectionchange', this.onSelectionChange)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    document.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('resize', this.onViewportChange)
    window.removeEventListener('scroll', this.onViewportChange, true)
  }

  private async forkAndCanvas(sessionId: SessionId, atSeq: number, branchPromptText?: string): Promise<void> {
    const operation = ++this.operationSeq
    try {
      const childId = await this.sessions.fork({ sessionId, atSeq, increaseTitle: true })
      if (!this.activeOperation(operation)) return
      this.setBranchBoundary(childId, atSeq)
      if (branchPromptText !== undefined) {
        const input = this.inputFor?.(childId)
        if (input === undefined) throw new Error(`fork child ${childId} composer is unavailable`)
        input.setDraft('')
        this.setPresentation(childId, {
          branchPrompt: branchPromptText,
          branchAtSeq: atSeq,
          branchContinued: false,
          branchBoundaryResolved: false,
        })
        this.selectionTarget = null
        this.selectionRect = null
        this.selectionError = null
      }
      this.enterCanvasWith(childId, sessionId)
      this.errors.delete(childId)
      this.publish()
    } catch (error) {
      if (this.activeOperation(operation)) {
        this.errors.set(sessionId, error instanceof Error ? error.message : String(error))
        this.publish()
      }
      throw error
    }
  }

  private readonly onViewportChange = (): void => {
    if (this.selectionTarget === null) return
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return
    this.selectionRect = this.rectOf(selection.getRangeAt(0))
    this.publish()
  }

  private readonly onSelectionChange = (): void => {
    if (this.disposed || this.selectionPending || this.selectionPointerActive) return
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount !== 1 || selection.toString().trim().length === 0) {
      this.selectionTarget = null
      this.selectionRect = null
      this.selectionError = null
      this.publish()
      return
    }
    const range = selection.getRangeAt(0)
    const start = flowElement(range.startContainer)
    const end = flowElement(range.endContainer)
    if (start === null || end === null || start !== end) {
      this.selectionTarget = null
      this.selectionRect = null
      this.publish()
      return
    }
    const flowKey = start.dataset.chatFlowKey
    const flowKind = start.dataset.chatFlowKind
    const canvasSessionId = start.closest<HTMLElement>('[data-loom-session-id]')?.dataset.loomSessionId as SessionId | undefined
    const sessionId = canvasSessionId ?? this.sessions.list.getSnapshot().current
    const session = sessionId === undefined
      ? undefined
      : this.sessions.binding(sessionId)?.session
    const target = resolveSelectionTarget({
      sessionId,
      text: selection.toString(),
      flowKey,
      flowKind,
      node: flowKey === undefined || session === undefined ? undefined : chatNodeAt(this.snapshotFor(sessionId!, session), flowKey),
    })
    this.selectionTarget = target
    this.selectionRect = target === null ? null : this.rectOf(range)
    this.selectionError = null
    this.publish()
  }

  /** Re-read the completed pointer selection after drag selection finishes. */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('[data-loom-selection-menu]') !== null) return
    this.selectionPointerActive = true
    if (this.selectionTarget === null && this.selectionRect === null && this.selectionError === null) return
    this.selectionTarget = null
    this.selectionRect = null
    this.selectionError = null
    this.publish()
  }

  /** Re-read the completed pointer selection after drag selection finishes. */
  private readonly onPointerUp = (): void => {
    this.selectionPointerActive = false
    this.onSelectionChange()
  }

  private rectOf(range: Range): SelectionRect {
    const rect = range.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  private activeOperation(operation: number): boolean {
    return !this.disposed && this.operationSeq === operation
  }

  /** Combine the alpha4 Session lifecycle snapshot with the target-neutral Chat view. */
  private snapshotFor(sessionId: SessionId, session: SessionFace): unknown {
    const base = session.getSnapshot()
    if (this.uiConversation === undefined) return base
    try {
      return { ...base, chat: this.uiConversation.binding(sessionId).target('chat').getSnapshot() }
    } catch {
      return base
    }
  }

  private chatSnapshotFor(sessionId: SessionId): unknown {
    if (this.uiConversation === undefined) return undefined
    try {
      return this.uiConversation.binding(sessionId).target('chat').getSnapshot()
    } catch {
      return undefined
    }
  }

  private chatSourceFor(sessionId: SessionId): HostObservable<unknown> | undefined {
    if (this.uiConversation === undefined) return undefined
    try {
      return this.uiConversation.binding(sessionId).target('chat')
    } catch {
      return undefined
    }
  }

  private reconcile(): void {
    const list = this.sessions.list.getSnapshot()
    const summaries = this.visibleSummaries()
    const graph = buildSessionGraph(summaries)
    const graphIds = new Set(graph.nodes.map(node => node.id))
    for (const node of graph.nodes) {
      if (!this.presentations.has(node.id)) {
        const persisted = readBranchPresentation(node.id)
        if (persisted !== undefined) this.presentations.set(node.id, persisted)
      }
      const persistedTitle = node.parentId === undefined ? undefined : readDerivedBranchTitle(node.id)
      if (persistedTitle !== undefined) this.derivedBranchTitles.set(node.id, persistedTitle)
      const persistedBoundary = readBranchBoundary(node.id)
      if (persistedBoundary !== undefined) this.branchBoundaries.set(node.id, persistedBoundary)
    }
    if (this.selectedSessionId === undefined || (!graphIds.has(this.selectedSessionId) && list.current !== undefined)) {
      this.selectedSessionId = graph.nodes.find(node => node.id === list.current)?.id ?? graph.nodes[0]?.id
    }
    if (this.pendingFocusId !== undefined && graphIds.has(this.pendingFocusId)) {
      this.focusWhenVisible(this.pendingFocusId)
      this.pendingFocusId = undefined
    }
    for (const [id, dispose] of this.sessionUnsubs) {
      if (!graphIds.has(id)) {
        dispose()
        this.sessionUnsubs.delete(id)
      }
    }
    for (const node of graph.nodes) {
      if (this.sessionUnsubs.has(node.id)) continue
      const session = this.sessions.binding(node.id)?.session
      const input = this.inputFor?.(node.id)
      const disposers = [
        ...(session === undefined ? [] : [session.subscribe(() => { this.publish() })]),
        ...(this.chatSourceFor(node.id) === undefined ? [] : [this.chatSourceFor(node.id)!.subscribe(() => { this.publish() })]),
        ...(input?.state === undefined ? [] : [input.state.subscribe(() => { this.publish() })]),
      ]
      if (disposers.length > 0) this.sessionUnsubs.set(node.id, () => { for (const dispose of disposers) dispose() })
    }
    this.publish()
    if (this.mode === 'canvas') this.queueDetachedHydration()
  }

  /** Stage cold sessions one at a time so their public history bindings hydrate. */
  private queueDetachedHydration(): void {
    for (const summary of this.visibleSummaries()) {
      const binding = this.sessions.binding(summary.id)
      const openState = binding?.session.getSnapshot()?.openState as string | undefined
      if (openState !== 'cold' || this.hydrating.has(summary.id)) continue
      this.hydrating.add(summary.id)
      this.hydrationQueue = this.hydrationQueue
        .catch(() => {})
        .then(() => this.hydrateDetached(summary.id))
        .finally(() => { this.hydrating.delete(summary.id) })
    }
  }

  /** Hydrate one cold detached session without stealing native selection. */
  private async hydrateDetached(id: SessionId): Promise<void> {
    const session = this.sessions.binding(id)?.session
    if (session === undefined || (session.getSnapshot()?.openState as string | undefined) !== 'cold') return
    const previous = this.sessions.list.getSnapshot().current
    const open = (session as SessionFace & { open?: () => Promise<void> }).open
    const usesSelectionFallback = open === undefined
    try {
      // `sessions.open(id)` changes the native selected session but does not
      // pull a cold session's history. The bound Session instance owns that
      // operation. Keep the selection fallback for older host runtimes that
      // do not expose Session.open on their binding object.
      if (open !== undefined) await open.call(session)
      else this.sessions.open(id)
      await this.waitForSessionOpen(session)
      this.publish()
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : String(error))
      this.publish()
    } finally {
      if (this.disposed) return
      if (!usesSelectionFallback) return
      const state = this.sessions.list.getSnapshot()
      if (previous !== undefined && state.byId[previous] !== undefined) {
        if (previous !== id) this.sessions.open(previous)
      } else {
        this.sessions.clear()
      }
      this.publish()
    }
  }

  private waitForSessionOpen(session: SessionFace): Promise<void> {
    const snapshotState = (): string | undefined => session.getSnapshot()?.openState as string | undefined
    if (snapshotState() === 'open') return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      let dispose = (): void => {}
      let timeout = 0
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        dispose()
        if (error === undefined) resolve()
        else reject(error)
      }
      timeout = window.setTimeout(() => { finish(new Error('session history hydration timed out')) }, 10000)
      dispose = session.subscribe(() => {
        const state = snapshotState()
        if (state === 'open') finish()
        else if (state === 'error') finish(new Error('session history is unavailable'))
      })
      const state = snapshotState()
      if (state === 'open') finish()
      else if (state === 'error') finish(new Error('session history is unavailable'))
    })
  }

  private publish(): void {
    const list = this.sessions.list.getSnapshot()
    const summaries = this.visibleSummaries()
    const graph = buildSessionGraph(summaries)
      for (const node of graph.nodes) this.deriveBranchTitle(node.id, undefined, false)
    const nodes: CanvasNodeSnapshot[] = graph.nodes.map(node => {
      const session = this.sessions.binding(node.id)?.session
      const boundary = session === undefined ? undefined : latestStableBoundary(this.snapshotFor(node.id, session))
      const derivedTitle = this.derivedBranchTitles.get(node.id)
      return {
        ...node,
        ...(derivedTitle === undefined ? {} : { title: derivedTitle }),
        selected: node.id === this.selectedSessionId,
        canBranch: boundary !== undefined,
        error: this.errors.get(node.id) ?? null,
      }
    })
    const windows: CanvasSessionWindowSnapshot[] = nodes.map(node => {
      const session = this.sessions.binding(node.id)?.session
      const input = this.inputFor?.(node.id)
      const presentation = this.presentations.get(node.id)
      if (presentation !== undefined && !presentation.branchContinued) {
        let presentationChanged = false
        const snapshot = session === undefined ? undefined : this.snapshotFor(node.id, session) as { openState?: string; running?: boolean; turnEnds?: Map<number, number>; chat?: { legacy?: { turnEnds?: Map<number, number> } } }
        const inputPhase = input?.state?.getSnapshot()?.phase
        const turnEnds = snapshot?.turnEnds ?? snapshot?.chat?.legacy?.turnEnds
        if (!presentation.branchBoundaryResolved
          && snapshot?.openState === 'open'
          && snapshot.running === false
          && turnEnds !== undefined
          && (inputPhase === undefined || inputPhase === 'plain')) {
          const inheritedAnchors = [
            ...readChatTranscript({ ...snapshot, chat: this.chatSnapshotFor(node.id) }).map(node => node.anchorSeq ?? node.seq),
            ...turnEnds.values(),
          ].filter((seq): seq is number => typeof seq === 'number' && Number.isFinite(seq))
          if (inheritedAnchors.length > 0) presentation.branchAtSeq = Math.max(presentation.branchAtSeq, ...inheritedAnchors)
          presentation.branchBoundaryResolved = true
          presentationChanged = true
        }
        if (this.hasBranchActivity(session, input, presentation.branchAtSeq)) {
          presentation.branchContinued = true
          presentationChanged = true
        }
        if (presentationChanged) writeBranchPresentation(node.id, presentation)
      }
      return {
        ...node,
        session,
        ...(session === undefined ? {} : { chatSnapshot: this.chatSnapshotFor(node.id) }),
        input,
        inputState: input?.state?.getSnapshot(),
        ...(presentation ?? {}),
      }
    })
    this.view.set({
      mode: this.mode,
      currentSessionId: list.current,
      selectedSessionId: this.selectedSessionId,
      nodes,
      windows,
      edges: graph.edges,
      viewport: this.viewport,
      selection: {
        target: this.selectionTarget,
        rect: this.selectionRect,
        pending: this.selectionPending,
        error: this.selectionError,
      },
    })
  }

  private visibleSummaries() {
    const list = this.sessions.list.getSnapshot()
    const archived = new Set(this.workspaces?.list.getSnapshot().archivedSessionIds ?? [])
    return list.ids
      .filter(id => (!archived.has(id) || this.archiveFailures.has(id)) && !this.archivedLocally.has(id))
      .map(id => list.byId[id])
      .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined)
  }

  private setPresentation(id: SessionId, presentation: BranchPresentation): void {
    this.presentations.set(id, presentation)
    writeBranchPresentation(id, presentation)
  }

  private setBranchBoundary(id: SessionId, atSeq: number): void {
    this.branchBoundaries.set(id, atSeq)
    writeBranchBoundary(id, atSeq)
  }

  private deriveBranchTitle(id: SessionId, prompt?: string, publishNow = true): void {
    const summary = this.sessions.list.getSnapshot().byId[id]
    if (summary?.parentId === undefined || this.derivedBranchTitles.has(id)) return
    const session = this.sessions.binding(id)?.session
    if (session === undefined) return
    const boundary = this.presentations.get(id)?.branchAtSeq ?? this.branchBoundaries.get(id)
    const source = prompt ?? (boundary === undefined ? undefined : firstUserPromptAfter(this.snapshotFor(id, session), boundary))
    if (source === undefined) return
    const title = titleFromPrompt(source)
    if (title.length === 0) return
    if (this.failedBranchTitles.get(id) === title) return
    this.derivedBranchTitles.set(id, title)
    writeDerivedBranchTitle(id, title)
    if (publishNow) this.publish()
    void session.rename(title).then(result => {
      if (result.ok) {
        this.failedBranchTitles.delete(id)
        this.publish()
        return
      }
      this.derivedBranchTitles.delete(id)
      this.failedBranchTitles.set(id, title)
      removeDerivedBranchTitle(id)
      this.publish()
    }, () => {
      this.derivedBranchTitles.delete(id)
      this.failedBranchTitles.set(id, title)
      removeDerivedBranchTitle(id)
      this.publish()
    })
  }

  private enterCanvasWith(id: SessionId, returnTo?: SessionId): void {
    if (this.mode !== 'canvas') this.canvasReturnSessionId = returnTo ?? this.sessions.list.getSnapshot().current
    this.selectedSessionId = id
    this.mode = 'canvas'
    if (!this.focusWhenVisible(id)) this.pendingFocusId = id
    this.queueDetachedHydration()
  }

  private hasBranchActivity(
    session: SessionFace | undefined,
    input: LoomSessionInput | undefined,
    branchAtSeq: number,
  ): boolean {
    if (session?.getSnapshot()?.running === true) return true
    const inputPhase = input?.state?.getSnapshot()?.phase
    if (inputPhase !== undefined && inputPhase !== 'plain') return true
    const snapshot = session === undefined ? undefined : this.snapshotFor(session.sessionId, session)
    if (snapshot === undefined) return false
    return readChatTranscript(snapshot).some(node => {
      const seq = node.anchorSeq ?? node.seq
      return seq !== undefined
        && seq > branchAtSeq
        && (node.kind === 'user' || node.kind === 'steering' || node.kind === 'command')
    })
  }

  private focusWhenVisible(id: SessionId): boolean {
    const node = buildSessionGraph(this.visibleSummaries()).nodes.find(item => item.id === id)
    if (node === undefined) return false
    const scale = this.viewport.scale
    this.viewport = {
      scale,
      x: window.innerWidth / 2 - 96 - (node.x + CANVAS_WINDOW_WIDTH / 2) * scale,
      y: window.innerHeight / 2 - 96 - (node.y + CANVAS_WINDOW_HEIGHT / 2) * scale,
    }
    return true
  }

  private isDescendant(id: SessionId, ancestorId: SessionId, nodes: readonly SessionGraphNode[]): boolean {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const seen = new Set<SessionId>()
    let parent = byId.get(id)?.parentId
    while (parent !== undefined && !seen.has(parent)) {
      if (parent === ancestorId) return true
      seen.add(parent)
      parent = byId.get(parent)?.parentId
    }
    return false
  }
}
