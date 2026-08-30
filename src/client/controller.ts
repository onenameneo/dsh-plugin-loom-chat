import type { ISessions, IWorkspaces, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  buildSessionGraph, CANVAS_WINDOW_HEIGHT, CANVAS_WINDOW_WIDTH, latestStableBoundary,
} from './session-graph.js'
import type { SessionGraphEdge, SessionGraphNode } from './session-graph.js'
import { resolveSelectionTarget } from './selection-target.js'
import type { SelectionTarget } from './selection-target.js'
import { buildSelectionPrompt } from './selection-prompt.js'

/** Minimal input face needed by the Canvas and selection branch flows. */
export interface LoomSessionInput {
  setDraft(text: string): void
  submit?(): void
  state?: HostObservable<LoomInputState>
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

function textFromUserNode(node: unknown): string {
  const item = record(node)
  const data = record(item?.data)
  const content = data?.content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    const part = record(block)
    return part?.type === 'text' && typeof part.text === 'string' ? part.text : ''
  }).join('').trim()
}

function firstUserPromptAfter(session: SessionFace, atSeq: number): string | undefined {
  const snapshot = session.getSnapshot()
  if (!Array.isArray(snapshot.chat.order)) return undefined
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node?.kind !== 'user' || node.anchorSeq <= atSeq) continue
    const prompt = textFromUserNode(node)
    if (prompt.length > 0) return prompt
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

  /**
   * @param sessions - public DSH session list, selection, binding, and fork face.
   * @param inputFor - optional per-session input face used by Canvas and selection branching.
   */
  constructor(
    private readonly sessions: ISessions,
    private readonly inputFor?: (sessionId: SessionId) => LoomSessionInput | undefined,
    private readonly workspaces?: IWorkspaces,
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

  /** Update one Canvas window's draft without touching another session. */
  setDraft(sessionId: SessionId, text: string): void {
    const input = this.inputFor?.(sessionId)
    if (input === undefined) return
    input.setDraft(text)
  }

  /** Submit the current draft belonging to exactly one Canvas window. */
  sendSession(sessionId: SessionId, text?: string): void {
    try {
      const input = this.inputFor?.(sessionId)
      if (input === undefined || input.submit === undefined) throw new Error(`session ${sessionId} composer is unavailable`)
      const presentation = this.presentations.get(sessionId)
      const draft = text ?? input.state?.getSnapshot().draft ?? ''
      const userPrompt = draft.trim()
      if (presentation?.branchPrompt !== undefined && !presentation.branchContinued) {
        const selectedPrompt = buildSelectionPrompt(presentation.branchPrompt)
        input.setDraft(draft.trim().length === 0 ? selectedPrompt : `${selectedPrompt}\n\n${draft}`)
      } else if (text !== undefined) {
        input.setDraft(text)
      }
      input.submit()
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
    const atSeq = latestStableBoundary(binding.session.getSnapshot())
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
    const atSeq = latestStableBoundary(binding.session.getSnapshot())
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
      node: flowKey === undefined ? undefined : session?.getSnapshot().chat.nodes.get(flowKey),
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
        ...(input?.state === undefined ? [] : [input.state.subscribe(() => { this.publish() })]),
      ]
      if (disposers.length > 0) this.sessionUnsubs.set(node.id, () => { for (const dispose of disposers) dispose() })
    }
    this.publish()
  }

  private publish(): void {
    const list = this.sessions.list.getSnapshot()
    const summaries = this.visibleSummaries()
    const graph = buildSessionGraph(summaries)
    for (const node of graph.nodes) this.deriveBranchTitle(node.id, undefined, false)
    const nodes: CanvasNodeSnapshot[] = graph.nodes.map(node => {
      const session = this.sessions.binding(node.id)?.session
      const boundary = session === undefined ? undefined : latestStableBoundary(session.getSnapshot())
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
        const snapshot = session?.getSnapshot()
        const inputPhase = input?.state?.getSnapshot().phase
        if (!presentation.branchBoundaryResolved
          && snapshot?.openState === 'open'
          && snapshot.running === false
          && (inputPhase === undefined || inputPhase === 'plain')) {
          const inheritedAnchors = [
            ...snapshot.chat.nodes.values().map(node => node.anchorSeq),
            ...snapshot.turnEnds.values(),
          ]
          presentation.branchAtSeq = Math.max(presentation.branchAtSeq, ...inheritedAnchors)
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
    const source = prompt ?? (boundary === undefined ? undefined : firstUserPromptAfter(session, boundary))
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
  }

  private hasBranchActivity(
    session: SessionFace | undefined,
    input: LoomSessionInput | undefined,
    branchAtSeq: number,
  ): boolean {
    if (session?.getSnapshot().running === true) return true
    const inputPhase = input?.state?.getSnapshot().phase
    if (inputPhase !== undefined && inputPhase !== 'plain') return true
    const snapshot = session?.getSnapshot()
    if (snapshot === undefined) return false
    return snapshot.chat.order.some(key => {
      const node = snapshot.chat.nodes.get(key)
      return node !== undefined
        && node.anchorSeq > branchAtSeq
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
