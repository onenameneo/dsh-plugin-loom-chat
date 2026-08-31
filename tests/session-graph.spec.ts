import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { buildSessionGraph, latestStableBoundary } from '../src/client/session-graph.js'

function summary(
  id: string,
  options: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: Number(id.replace(/\D/g, '') || 0),
    ...options,
  }
}

describe('session graph', () => {
  it('derives nested ordinary lineage with stable depth and edges', () => {
    const graph = buildSessionGraph([
      summary('grandchild', { parentId: 'child' as SessionId }),
      summary('root'),
      summary('child', { parentId: 'root' as SessionId }),
    ])

    expect(graph.nodes.map(node => [node.id, node.depth])).toEqual([
      ['root', 0], ['child', 1], ['grandchild', 2],
    ])
    expect(graph.edges).toEqual([
      { from: 'root', to: 'child' },
      { from: 'child', to: 'grandchild' },
    ])
  })

  it('excludes subagents and recovers missing parents as roots', () => {
    const graph = buildSessionGraph([
      summary('orphan', { parentId: 'missing' as SessionId }),
      summary('subagent', { origin: 'subagent' }),
    ])

    expect(graph.nodes.map(node => node.id)).toEqual(['orphan'])
    expect(graph.nodes[0]?.depth).toBe(0)
    expect(graph.edges).toEqual([])
  })

  it('terminates cyclic lineage without dropping the sessions', () => {
    const graph = buildSessionGraph([
      summary('a', { parentId: 'b' as SessionId }),
      summary('b', { parentId: 'a' as SessionId }),
    ])

    expect(graph.nodes.map(node => node.id).sort()).toEqual(['a', 'b'])
    expect(graph.nodes.every(node => node.depth >= 0)).toBe(true)
    expect(graph.edges.length).toBeLessThan(2)
  })
})

describe('latestStableBoundary', () => {
  it('returns the latest completed turn end sequence', () => {
    expect(latestStableBoundary({
      turnEnds: new Map([[1, 8], [2, 15]]),
      running: false,
    })).toBe(15)
  })

  it('does not return a boundary while the session is running', () => {
    expect(latestStableBoundary({
      turnEnds: new Map([[1, 8]]),
      running: true,
    })).toBeUndefined()
  })

  it('treats an initializing session snapshot without turn ends as unavailable', () => {
    expect(latestStableBoundary({ running: false } as never)).toBeUndefined()
  })
})

describe('Canvas node status', () => {
  it('keeps status metadata available to Canvas nodes', () => {
    const graph = buildSessionGraph([summary('active', { running: true, completed: true })])
    expect(graph.nodes[0]).toMatchObject({ id: 'active', running: true, completed: true })
  })
})
