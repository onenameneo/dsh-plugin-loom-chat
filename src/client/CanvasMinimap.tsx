import { useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasNodeSnapshot, CanvasViewport } from './controller.js'
import { CANVAS_WINDOW_HEIGHT, CANVAS_WINDOW_WIDTH } from './session-graph.js'
import type { NS } from './locales.js'
import css from './CanvasOverlay.module.css'

const MINIMAP_WIDTH = 224
const MINIMAP_HEIGHT = 144
const MINIMAP_PADDING = 12
const WORLD_ORIGIN = 96

interface CanvasMinimapProps {
  nodes: readonly CanvasNodeSnapshot[]
  edges: readonly { from: SessionId; to: SessionId }[]
  viewport: CanvasViewport
  viewportSize: { width: number; height: number }
  onSelect: (id: SessionId) => void
  onViewport: (viewport: CanvasViewport) => void
  t: TranslateNS<typeof NS>
}

interface MinimapProjection {
  left: number
  top: number
  scale: number
  offsetX: number
  offsetY: number
}

function projectionFor(nodes: readonly CanvasNodeSnapshot[]): MinimapProjection {
  const left = Math.min(0, ...nodes.map(node => node.x))
  const top = Math.min(0, ...nodes.map(node => node.y))
  const right = Math.max(CANVAS_WINDOW_WIDTH, ...nodes.map(node => node.x + CANVAS_WINDOW_WIDTH))
  const bottom = Math.max(CANVAS_WINDOW_HEIGHT, ...nodes.map(node => node.y + CANVAS_WINDOW_HEIGHT))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const innerWidth = MINIMAP_WIDTH - MINIMAP_PADDING * 2
  const innerHeight = MINIMAP_HEIGHT - MINIMAP_PADDING * 2
  const scale = Math.min(innerWidth / width, innerHeight / height)
  return {
    left,
    top,
    scale,
    offsetX: MINIMAP_PADDING + (innerWidth - width * scale) / 2 - left * scale,
    offsetY: MINIMAP_PADDING + (innerHeight - height * scale) / 2 - top * scale,
  }
}

function project(value: number, offset: number, scale: number): number {
  return offset + value * scale
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Compact, interactive overview of the Canvas graph and current viewport. */
export function CanvasMinimap({ nodes, edges, viewport, viewportSize, onSelect, onViewport, t }: CanvasMinimapProps) {
  const viewportDrag = useRef<{ pointerId: number; x: number; y: number; viewport: CanvasViewport } | null>(null)
  const suppressClick = useRef(false)
  const projection = projectionFor(nodes)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const viewportScale = Math.max(0.01, viewport.scale)
  const fallbackWidth = typeof window === 'undefined' ? 960 : window.innerWidth
  const fallbackHeight = typeof window === 'undefined' ? 640 : window.innerHeight
  const visibleWidth = (viewportSize.width > 0 ? viewportSize.width : fallbackWidth) / viewportScale
  const visibleHeight = (viewportSize.height > 0 ? viewportSize.height : fallbackHeight) / viewportScale
  const visibleLeft = (-WORLD_ORIGIN - viewport.x) / viewportScale
  const visibleTop = (-WORLD_ORIGIN - viewport.y) / viewportScale
  const visibleRight = visibleLeft + visibleWidth
  const visibleBottom = visibleTop + visibleHeight
  const viewportLeft = project(visibleLeft, projection.offsetX, projection.scale)
  const viewportTop = project(visibleTop, projection.offsetY, projection.scale)
  const viewportRight = project(visibleRight, projection.offsetX, projection.scale)
  const viewportBottom = project(visibleBottom, projection.offsetY, projection.scale)
  const viewportX = clamp(Math.min(viewportLeft, viewportRight), 2, MINIMAP_WIDTH - 2)
  const viewportY = clamp(Math.min(viewportTop, viewportBottom), 2, MINIMAP_HEIGHT - 2)
  const viewportRightClamped = clamp(Math.max(viewportLeft, viewportRight), viewportX + 4, MINIMAP_WIDTH - 2)
  const viewportBottomClamped = clamp(Math.max(viewportTop, viewportBottom), viewportY + 4, MINIMAP_HEIGHT - 2)

  const moveTo = (event: ReactMouseEvent<SVGSVGElement>): void => {
    event.stopPropagation()
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = (event.clientX - rect.left) / Math.max(1, rect.width) * MINIMAP_WIDTH
    const localY = (event.clientY - rect.top) / Math.max(1, rect.height) * MINIMAP_HEIGHT
    const worldX = (localX - projection.offsetX) / projection.scale
    const worldY = (localY - projection.offsetY) / projection.scale
    onViewport({
      ...viewport,
      x: -WORLD_ORIGIN - (worldX - visibleWidth / 2) * viewportScale,
      y: -WORLD_ORIGIN - (worldY - visibleHeight / 2) * viewportScale,
    })
  }

  const beginViewportDrag = (event: ReactPointerEvent<SVGRectElement>): void => {
    event.stopPropagation()
    event.preventDefault()
    viewportDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport }
    suppressClick.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const updateViewportDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const active = viewportDrag.current
    if (active === null || active.pointerId !== event.pointerId) return
    event.stopPropagation()
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const scaleX = MINIMAP_WIDTH / Math.max(1, rect.width)
    const scaleY = MINIMAP_HEIGHT / Math.max(1, rect.height)
    const deltaX = (event.clientX - active.x) * scaleX
    const deltaY = (event.clientY - active.y) * scaleY
    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) suppressClick.current = true
    onViewport({
      ...active.viewport,
      x: active.viewport.x - deltaX / projection.scale * active.viewport.scale,
      y: active.viewport.y - deltaY / projection.scale * active.viewport.scale,
    })
  }

  const finishViewportDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (viewportDrag.current?.pointerId === event.pointerId) viewportDrag.current = null
  }

  return (
    <div
      className={css.minimap}
      data-canvas-overview
      role="group"
      aria-label={t('canvasOverview')}
      onPointerDown={event => { event.stopPropagation() }}
    >
      <div className={css.minimapHeader}>
        <span>{t('canvasOverview')}</span>
        <span>{nodes.length}</span>
      </div>
      <svg
        className={css.minimapSvg}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        aria-hidden="false"
        onClick={moveTo}
        onPointerMove={updateViewportDrag}
        onPointerUp={finishViewportDrag}
        onPointerCancel={finishViewportDrag}
      >
        {edges.flatMap(edge => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          return from === undefined || to === undefined ? [] : [
            <line
              className={css.minimapEdge}
              key={String(edge.from) + '-' + String(edge.to)}
              x1={project(from.x + CANVAS_WINDOW_WIDTH, projection.offsetX, projection.scale)}
              y1={project(from.y + CANVAS_WINDOW_HEIGHT / 2, projection.offsetY, projection.scale)}
              x2={project(to.x, projection.offsetX, projection.scale)}
              y2={project(to.y + CANVAS_WINDOW_HEIGHT / 2, projection.offsetY, projection.scale)}
            />,
          ]
        })}
        {nodes.map(node => {
          const x = project(node.x, projection.offsetX, projection.scale)
          const y = project(node.y, projection.offsetY, projection.scale)
          return (
            <rect
              className={css.minimapNode}
              data-minimap-node={String(node.id)}
              data-selected={node.selected || undefined}
              data-running={node.running || undefined}
              key={node.id}
              x={x}
              y={y}
              width={Math.max(5, CANVAS_WINDOW_WIDTH * projection.scale)}
              height={Math.max(5, CANVAS_WINDOW_HEIGHT * projection.scale)}
              rx="2"
          role="button"
          tabIndex={0}
              aria-label={node.title}
          onClick={event => { event.stopPropagation(); onSelect(node.id) }}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect(node.id)
              }}
            />
          )
        })}
        <rect
          className={css.minimapViewport}
          x={viewportX}
          y={viewportY}
          width={Math.max(4, viewportRightClamped - viewportX)}
          height={Math.max(4, viewportBottomClamped - viewportY)}
          rx="2"
          aria-hidden="true"
          onPointerDown={beginViewportDrag}
        />
      </svg>
    </div>
  )
}
