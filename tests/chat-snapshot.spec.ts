import { describe, expect, it } from 'vitest'
import {
  readChatTranscript,
  type LoomTranscriptNode,
} from '../src/client/chat-snapshot.js'

function transcript(snapshot: unknown): readonly LoomTranscriptNode[] {
  return readChatTranscript(snapshot)
}

describe('plugin-owned Chat snapshot adapter', () => {
  it('preserves current Chat order and unwraps node.data payloads', () => {
    const nodes = new Map([
      ['assistant', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: 'answer' }] } }],
      ['user', { kind: 'user', data: { content: [{ type: 'text', text: 'prompt' }] } }],
    ])

    expect(transcript({ chat: { order: ['user', 'assistant'], nodes } })).toEqual([
      expect.objectContaining({ kind: 'user', text: 'prompt' }),
      expect.objectContaining({ kind: 'assistant', text: 'answer' }),
    ])
  })

  it('supports legacy node arrays and values collections', () => {
    expect(transcript({ nodes: [{ kind: 'context', content: 'legacy context' }] })).toEqual([
      expect.objectContaining({ kind: 'context', text: 'legacy context' }),
    ])
    expect(transcript({ chat: { nodes: { values: () => [{ kind: 'command', content: 'run tests' }] } } })).toEqual([
      expect.objectContaining({ kind: 'command', text: 'run tests' }),
    ])
  })

  it('reads the legacy projection nested in the released Chat snapshot', () => {
    expect(transcript({
      chat: {
        order: [],
        nodes: { get: () => undefined, values: () => [] },
        legacy: {
          nodes: [{ kind: 'user', seq: 7, content: 'parent prompt' }],
        },
      },
      nodes: [],
    })).toEqual([
      expect.objectContaining({ kind: 'user', text: 'parent prompt', seq: 7 }),
    ])
  })

  it('reads legacy nodes from iterable stores used by detached sessions', () => {
    const nodes = new Map([[7, { kind: 'user', seq: 7, content: 'iterable legacy prompt' }]])
    expect(transcript({ chat: { legacy: { nodes } } })[0]).toEqual(expect.objectContaining({
      kind: 'user', text: 'iterable legacy prompt', seq: 7,
    }))
  })

  it('returns an empty transcript for missing or malformed stores', () => {
    expect(transcript(undefined)).toEqual([])
    expect(transcript({ chat: { nodes: null } })).toEqual([])
    expect(transcript({ chat: { order: ['missing'], nodes: { get: () => undefined } } })).toEqual([])
  })

  it('filters hidden nodes but keeps readable unknown content', () => {
    const result = transcript({
      nodes: [
        { kind: 'assistant', hidden: true, content: 'internal' },
        { kind: 'mystery', data: { payload: { answer: 42 } } },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({ kind: 'unknown' }))
    expect(result[0]?.text).toContain('answer')
    expect(result[0]?.text).toContain('42')
  })

  it('normalizes text, Markdown/code, tool/status, command, context, and attachments', () => {
    const [node] = transcript({ nodes: [{
      kind: 'assistant',
      blocks: [
        { kind: 'text', text: 'plain' },
        { kind: 'code', language: 'ts', code: 'const answer = 42' },
        { kind: 'tool-call', name: 'search', status: 'done', args: { q: 'loom' } },
        { kind: 'image', name: 'diagram.png' },
      ],
    }] })

    expect(node?.blocks.map(block => block.kind)).toEqual(['text', 'code', 'tool', 'attachment'])
    expect(node?.blocks.map(block => block.text)).toEqual([
      'plain',
      'const answer = 42',
      expect.stringContaining('search'),
      expect.stringContaining('diagram.png'),
    ])
  })

  it('keeps BigInt and circular unknown payloads readable and tolerates empty content', () => {
    const circular: Record<string, unknown> = { kind: 'mystery' }
    circular.self = circular
    const result = transcript({ nodes: [
      { kind: 'mystery', data: { count: 42n } },
      { kind: 'mystery', data: { circular } },
      { kind: 'assistant', content: '' },
    ] })

    expect(result[0]?.text).toContain('42n')
    expect(result[0]?.text.length).toBeGreaterThan(0)
    expect(result[1]?.text.length).toBeGreaterThan(0)
    expect(result[2]?.text).toBe('')
  })
})
