import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** A user-visible ordinary session projected as a Canvas node. */
export interface SessionGraphNode {
  id: SessionId
  title: string
  parentId: SessionId | undefined
  depth: number
  x: number
  y: number
  running: boolean
  pending: boolean
  completed: boolean
  blank: boolean
  updatedAt: number
}

/** One visible parent-child edge in the Canvas graph. */
export interface SessionGraphEdge {
  from: SessionId
  to: SessionId
}

/** Complete ordinary-session graph used by Canvas rendering and navigation. */
export interface SessionGraph {
  nodes: readonly SessionGraphNode[]
  edges: readonly SessionGraphEdge[]
}

/** CSS width of one interactive Canvas window. Shared with edge geometry. */
export const CANVAS_WINDOW_WIDTH = 480
/** CSS height of one interactive Canvas window. Shared with edge geometry. */
export const CANVAS_WINDOW_HEIGHT = 640

const NODE_X_GAP = CANVAS_WINDOW_WIDTH + 100
const NODE_Y_GAP = CANVAS_WINDOW_HEIGHT + 80

function compareSummary(a: SessionSummary, b: SessionSummary): number {
  return a.updatedAt - b.updatedAt || String(a.id).localeCompare(String(b.id))
}

/**
 * Build a deterministic graph from the host's complete session summary list.
 * Missing parents become roots and cyclic references are rendered without an edge.
 * @param summaries - host session summaries.
 * @returns the ordinary-session graph for Canvas.
 */
export function buildSessionGraph(summaries: readonly SessionSummary[]): SessionGraph {
  const ordinary = summaries.filter(summary => summary.origin !== 'subagent').sort(compareSummary)
  const byId = new Map(ordinary.map(summary => [summary.id, summary]))
  const depths = new Map<SessionId, number>()

  const depthOf = (id: SessionId, visiting: ReadonlySet<SessionId> = new Set()): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    const summary = byId.get(id)
    if (summary === undefined || summary.parentId === undefined || !byId.has(summary.parentId)) {
      depths.set(id, 0)
      return 0
    }
    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    const depth = depthOf(summary.parentId, nextVisiting)
    const resolved = nextVisiting.has(summary.parentId) ? 0 : depth + 1
    depths.set(id, resolved)
    return resolved
  }

  for (const summary of ordinary) depthOf(summary.id)

  const childrenByParent = new Map<SessionId, SessionSummary[]>()
  for (const summary of ordinary) {
    if (summary.parentId === undefined || !byId.has(summary.parentId)) continue
    const children = childrenByParent.get(summary.parentId) ?? []
    children.push(summary)
    childrenByParent.set(summary.parentId, children)
  }
  const ordered: SessionSummary[] = []
  const visited = new Set<SessionId>()
  const visit = (summary: SessionSummary): void => {
    if (visited.has(summary.id)) return
    visited.add(summary.id)
    ordered.push(summary)
    for (const child of childrenByParent.get(summary.id) ?? []) visit(child)
  }
  for (const summary of ordinary) {
    if (summary.parentId === undefined || !byId.has(summary.parentId) || (depths.get(summary.id) ?? 0) === 0) visit(summary)
  }
  for (const summary of ordinary) visit(summary)

  const rowsByDepth = new Map<number, number>()
  const nodes = ordered.map((summary) => {
    const depth = depths.get(summary.id) ?? 0
    const row = rowsByDepth.get(depth) ?? 0
    rowsByDepth.set(depth, row + 1)
    return {
      id: summary.id,
      title: summary.displayTitle,
      parentId: summary.parentId,
      depth,
      x: depth * NODE_X_GAP,
      y: row * NODE_Y_GAP,
      running: summary.running,
      pending: summary.pendingInteraction !== undefined,
      completed: summary.completed === true,
      blank: summary.blank,
      updatedAt: summary.updatedAt,
    }
  })
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const edges = nodes.flatMap((node) => {
    if (node.parentId === undefined) return []
    const parent = nodeById.get(node.parentId)
    return parent !== undefined && parent.depth < node.depth
      ? [{ from: parent.id, to: node.id }]
      : []
  })
  return { nodes, edges }
}

/**
 * Resolve the latest safe fork boundary from a session conversation snapshot.
 * @param snapshot - DSH session snapshot.
 * @returns a completed turn-end sequence, or undefined while no safe boundary exists.
 */
export function latestStableBoundary(snapshot: Pick<ConversationSnapshot, 'turnEnds' | 'running'>): number | undefined {
  const turnEnds = snapshot.turnEnds
  if (snapshot.running || turnEnds === undefined || turnEnds.size === 0) return undefined
  return Math.max(...turnEnds.values())
}
