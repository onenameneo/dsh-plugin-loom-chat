/**
 * The DSH Chat view is intentionally treated as an untyped boundary here.
 * Released runtimes have changed the shape of the view payload over time, so
 * Canvas owns the small compatibility adapter instead of importing Chat UI
 * implementation details.
 */

export type LoomTranscriptNodeKind = 'user' | 'assistant' | 'tool' | 'command' | 'context' | 'steering' | 'unknown'
export type LoomTranscriptBlockKind = 'text' | 'markdown' | 'code' | 'reasoning' | 'tool' | 'status' | 'command' | 'context' | 'attachment' | 'unknown'

export interface LoomTranscriptBlock {
  readonly kind: LoomTranscriptBlockKind
  readonly text: string
  readonly language?: string
  readonly raw: unknown
}

export interface LoomTranscriptNode {
  readonly key?: string
  readonly kind: LoomTranscriptNodeKind
  readonly text: string
  readonly blocks: readonly LoomTranscriptBlock[]
  readonly seq?: number
  readonly anchorSeq?: number
  readonly messageId?: string
  readonly raw: unknown
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return value !== null && typeof value === 'object' && Symbol.iterator in value
}

function collectionValues(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  const item = record(value)
  const values = item?.values
  if (typeof values !== 'function') return []
  try {
    const result: unknown = values.call(value)
    if (Array.isArray(result)) return result
    return isIterable(result) ? Array.from(result) : []
  } catch {
    return []
  }
}

function jsonFallback(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, (_key, nested: unknown) => typeof nested === 'bigint' ? `${nested}n` : nested)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

function firstString(item: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim().length > 0) return item[key].trim()
  }
  return ''
}

function readableValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().replace(/\\\\n/gu, '\n').replace(/\\\\t/gu, '\t')
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(', ')
  const item = record(value)
  if (item === null) return ''
  const direct = firstString(item, ['text', 'content', 'message', 'summary', 'label', 'name', 'path', 'url'])
  return direct || jsonFallback(value)
}

function blockText(item: UnknownRecord, kind: LoomTranscriptBlockKind): string {
  if (kind === 'tool') {
    const tool = firstString(item, ['toolName', 'name', 'command'])
    const status = firstString(item, ['status', 'state'])
    const args = readableValue(item.args ?? item.input ?? item.arguments)
    return [tool, status, args].filter(Boolean).join(' · ') || 'Tool activity'
  }
  if (kind === 'attachment') {
    const name = firstString(item, ['name', 'filename', 'path', 'url', 'mimeType', 'type'])
    return name.length > 0 ? `Attachment: ${name}` : 'Attachment'
  }
  const direct = firstString(item, ['text', 'code', 'content', 'message', 'summary', 'label', 'name', 'path', 'url'])
  if (direct.length > 0) return direct
  return jsonFallback(item)
}

function blockKind(value: unknown): LoomTranscriptBlockKind {
  const item = record(value)
  const rawKind = typeof item?.kind === 'string' ? item.kind : typeof item?.type === 'string' ? item.type : ''
  const normalized = rawKind.toLowerCase()
  if (normalized === 'text' || normalized === 'plain' || normalized === 'markdown' || normalized === 'md') return normalized === 'text' || normalized === 'plain' ? 'text' : 'markdown'
  if (normalized.includes('code')) return 'code'
  if (normalized === 'reasoning' || normalized === 'thinking') return 'reasoning'
  if (normalized.includes('tool')) return 'tool'
  if (normalized === 'status' || normalized === 'progress') return 'status'
  if (normalized === 'command' || normalized === 'shell') return 'command'
  if (normalized === 'context' || normalized === 'system') return 'context'
  if (normalized === 'image' || normalized === 'file' || normalized === 'attachment' || normalized.includes('attachment')) return 'attachment'
  return 'unknown'
}

function normalizeBlock(value: unknown): LoomTranscriptBlock {
  const item = record(value)
  if (item === null) return { kind: 'text', text: readableValue(value), raw: value }
  const kind = blockKind(value)
  const language = firstString(item, ['language', 'lang']) || undefined
  return { kind, text: blockText(item, kind), ...(language === undefined ? {} : { language }), raw: value }
}

function nodeKind(value: unknown): LoomTranscriptNodeKind {
  const item = record(value)
  const normalized = (typeof item?.kind === 'string' ? item.kind : '').toLowerCase()
  if (normalized === 'user' || normalized === 'user-message') return 'user'
  if (normalized === 'assistant' || normalized === 'assistant-step' || normalized === 'assistant-message') return 'assistant'
  if (normalized.includes('tool')) return 'tool'
  if (normalized === 'command' || normalized === 'command-message') return 'command'
  if (normalized === 'context' || normalized === 'context-message' || normalized === 'system') return 'context'
  if (normalized === 'steering' || normalized === 'steering-message') return 'steering'
  return 'unknown'
}

function isHidden(value: unknown): boolean {
  const item = record(value)
  const data = record(item?.data)
  return item?.hidden === true || data?.hidden === true || item?.visible === false || data?.visible === false
}

function sourcePayload(value: unknown): UnknownRecord {
  const item = record(value)
  const data = record(item?.data)
  return data ?? item ?? {}
}

function normalizeNode(value: unknown, key?: string): LoomTranscriptNode | undefined {
  if (isHidden(value)) return undefined
  const item = record(value)
  if (item === null) return undefined
  const source = sourcePayload(value)
  const kind = nodeKind(value)
  const rawBlocks = Array.isArray(source.blocks)
    ? source.blocks
    : Array.isArray(source.content)
      ? source.content
      : []
  const blocks = rawBlocks.map(normalizeBlock).filter(block => block.text.length > 0)
  if (blocks.length === 0) {
    const direct = readableValue(source.content ?? source.message ?? source.text ?? source.summary)
    if (direct.length > 0) blocks.push({ kind: kind === 'unknown' ? 'unknown' : kind === 'context' ? 'context' : 'text', text: direct, raw: source.content ?? source.message ?? source.text ?? source.summary })
  }
  if (blocks.length === 0 && kind === 'unknown') blocks.push({ kind: 'unknown', text: jsonFallback(source), raw: source })
  const text = blocks.map(block => block.text).filter(Boolean).join('\n').trim()
  const finalNode = record(source.finalNode)
  return {
    ...(key === undefined ? {} : { key }),
    kind,
    text,
    blocks,
    ...(typeof item.seq === 'number' ? { seq: item.seq } : typeof source.seq === 'number' ? { seq: source.seq } : {}),
    ...(typeof item.anchorSeq === 'number' ? { anchorSeq: item.anchorSeq } : typeof source.anchorSeq === 'number' ? { anchorSeq: source.anchorSeq } : typeof finalNode?.seq === 'number' ? { anchorSeq: finalNode.seq } : {}),
    ...(typeof item.messageId === 'string'
      ? { messageId: item.messageId }
      : typeof source.messageId === 'string'
        ? { messageId: source.messageId }
      : typeof finalNode?.messageId === 'string'
          ? { messageId: finalNode.messageId }
          : {}),
    raw: value,
  }
}

/**
 * The released runtime keeps a legacy conversation projection beside the
 * keyed Chat view. Prefer it when a host snapshot has not materialized the
 * view nodes yet; this is common for detached Canvas sessions while history
 * is being opened. The projection also preserves the public message blocks,
 * so it is a better fallback than serializing the whole node as JSON.
 */
function legacyRawNodes(snapshot: unknown): readonly [string | undefined, unknown][] {
  const item = record(snapshot)
  const chat = record(item?.chat)
  const legacy = record(chat?.legacy)
  const nodes = legacy?.nodes !== undefined
    ? legacy.nodes
    : item?.nodes
  return collectionValues(nodes).map(value => {
    const node = record(value)
    const key = typeof node?.seq === 'number' ? String(node.seq) : undefined
    return [key, value] as const
  })
}

function transcriptQuality(nodes: readonly LoomTranscriptNode[]): number {
  return nodes.reduce((score, node) => score + (node.kind === 'unknown' ? 0 : 1) + Math.min(2, node.blocks.length), 0)
}

function rawNodes(snapshot: unknown): readonly [string | undefined, unknown][] {
  const item = record(snapshot)
  if (item === null) return []
  const chat = record(item.chat)
  const nodes = chat?.nodes
  const order = chat?.order
  const get = record(nodes)?.get
  if (Array.isArray(order) && typeof get === 'function') {
    try {
      return order.map(key => [typeof key === 'string' ? key : undefined, get.call(nodes, key)] as const)
        .filter((entry): entry is [string | undefined, unknown] => entry[1] !== undefined && entry[1] !== null)
    } catch {
      return []
    }
  }
  const current = collectionValues(nodes)
  const keys = record(nodes)?.keys
  if (typeof get === 'function' && typeof keys === 'function') {
    try {
      const orderedKeys: unknown = keys.call(nodes)
      if (isIterable(orderedKeys)) {
        return Array.from(orderedKeys).map(key => [typeof key === 'string' ? key : undefined, get.call(nodes, key)] as const)
          .filter((entry): entry is [string | undefined, unknown] => entry[1] !== undefined && entry[1] !== null)
      }
    } catch {
      return []
    }
  }
  if (current.length > 0) return current.map(value => [undefined, value])
  return collectionValues(item.nodes).map(value => [undefined, value])
}

/** Normalize one released-runtime Chat snapshot into plugin-owned transcript data. */
export function readChatTranscript(snapshot: unknown): readonly LoomTranscriptNode[] {
  const viewNodes = rawNodes(snapshot)
    .map(([key, value]) => normalizeNode(value, key))
    .filter((node): node is LoomTranscriptNode => node !== undefined)
  const legacyNodes = legacyRawNodes(snapshot)
    .map(([key, value]) => normalizeNode(value, key))
    .filter((node): node is LoomTranscriptNode => node !== undefined)
  return transcriptQuality(legacyNodes) > transcriptQuality(viewNodes) ? legacyNodes : viewNodes
}

/**
 * Supply the small live Chat shape required by the official Harness renderers.
 * Released Canvas snapshots can contain either the keyed store or the legacy
 * projection, so this adapter normalizes only the reader methods; it does not
 * render or reinterpret message content.
 */
export function nativeChatSnapshot(value: unknown): Record<string, unknown> {
  const source = record(value) ?? {}
  const order = Array.isArray(source.order) ? source.order.map(String) : []
  const rawNodes = record(source.nodes)
  const getter = rawNodes?.get
  const get = typeof getter === 'function'
    ? (key: unknown): unknown => getter.call(source.nodes, key)
    : (_key: unknown): unknown => undefined
  const legacy = record(source.legacy)
  const legacyNodes = legacy?.nodes !== undefined ? legacy.nodes : []
  const navigation = record(source.navigation)
  const timeline = record(source.timeline)
  const locations = record(source.locations)
  const legacySource = legacy ?? {}
  return {
    ...source,
    order,
    nodes: {
      get,
      values: () => order.map(get).filter(item => item !== undefined),
      source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    },
    navigation: typeof navigation?.items === 'function' ? navigation : { items: () => [] },
    locations: {
      ...(locations ?? {}),
      getTurn: typeof locations?.getTurn === 'function' ? locations.getTurn : () => order,
      getStep: typeof locations?.getStep === 'function' ? locations.getStep : () => order,
    },
    timeline: {
      ...(timeline ?? {}),
      turnOrder: Array.isArray(timeline?.turnOrder) ? timeline.turnOrder : [],
      turns: timeline?.turns ?? new Map(),
    },
    legacy: {
      ...legacySource,
      nodes: Array.isArray(legacySource.nodes) ? legacySource.nodes : legacyNodes,
      turnTimings: legacySource.turnTimings ?? new Map(),
      turnEnds: legacySource.turnEnds ?? new Map(),
      partial: legacySource.partial ?? null,
      runningCalls: Array.isArray(legacySource.runningCalls) ? legacySource.runningCalls : [],
    },
  }
}
