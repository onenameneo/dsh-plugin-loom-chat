import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { IconRefreshOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CanvasNodeSnapshot, CanvasViewport, SelectionRect } from './controller.js'
import type { CanvasSessionWindowSnapshot } from './controller.js'
import { CANVAS_WINDOW_HEIGHT, CANVAS_WINDOW_WIDTH } from './session-graph.js'
import type { LoomChatProps } from './slots.js'
import { NS } from './locales.js'
import { CanvasSessionWindow } from './CanvasSessionWindow.js'
import { CanvasMinimap } from './CanvasMinimap.js'
import { LoomCanvasIcon } from './LoomCanvasIcon.js'
import css from './CanvasOverlay.module.css'

interface CanvasSurfaceProps {
  nodes: readonly CanvasNodeSnapshot[]
  windows: readonly CanvasSessionWindowSnapshot[]
  edges: readonly { from: SessionId; to: SessionId }[]
  viewport: CanvasViewport
  onSelect: (id: SessionId) => void
  onOpen: (id: SessionId) => void
  onDelete: (id: SessionId) => Promise<void> | void
  onDraft: (id: SessionId, text: string) => void
  onSend: (id: SessionId) => void
  onCancel: (id: SessionId) => void
  onBranch?: (id: SessionId, atSeq: number) => Promise<void> | void
  onForkSelection?: () => void
  onViewport: (viewport: CanvasViewport) => void
  onResetViewport: () => void
  selectionRect?: SelectionRect | null
  selectionPending?: boolean
  selectionError?: string | null
  onClose?: () => void
  t: TranslateNS<typeof NS>
}

interface ViewportOffset {
  left: number
  top: number
  width: number
  height: number
}

function edgePath(from: CanvasNodeSnapshot, to: CanvasNodeSnapshot): string {
  const startX = from.x + CANVAS_WINDOW_WIDTH
  const startY = from.y + CANVAS_WINDOW_HEIGHT / 2
  const endX = to.x
  const endY = to.y + CANVAS_WINDOW_HEIGHT / 2
  const curve = Math.max(48, (endX - startX) / 2)
  return 'M ' + startX + ' ' + startY + ' C ' + (startX + curve) + ' ' + startY + ', ' + (endX - curve) + ' ' + endY + ', ' + endX + ' ' + endY
}

/** Full-workspace interactive Canvas surface. */
export function CanvasSurface({
  nodes, windows, edges, viewport, onSelect, onOpen, onDelete, onDraft, onSend, onCancel,
  onBranch, onForkSelection = () => {}, onViewport, onResetViewport, selectionRect = null,
  selectionPending = false, selectionError = null, onClose, t,
}: CanvasSurfaceProps) {
  const [panning, setPanning] = useState(false)
  const [viewportOffset, setViewportOffset] = useState<ViewportOffset>({ left: 0, top: 0, width: 0, height: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; viewport: CanvasViewport } | null>(null)
  useLayoutEffect(() => {
    const measure = (): void => {
      const element = viewportRef.current
      if (element === null) return
      const rect = element.getBoundingClientRect()
      setViewportOffset(previous => previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height
        ? previous
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [])

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button, [role="button"], [data-loom-session-id]') !== null) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPanning(true)
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    event.preventDefault()
    onViewport({
      ...active.viewport,
      x: active.viewport.x + event.clientX - active.x,
      y: active.viewport.y + event.clientY - active.y,
    })
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
    setPanning(false)
  }
  const wheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const factor = event.deltaY > 0 ? .9 : 1.1
    onViewport({ ...viewport, scale: viewport.scale * factor })
  }

  return (
    <section className={css.canvas} aria-label={t('canvasTitle')}>
      <header className={css.toolbar}>
        <div className={css.heading}>
          <div>
            <p className={css.eyebrow}>Loom / sessions</p>
            <h1 className={css.title}>{t('canvasTitle')}</h1>
          </div>
          <span className={css.count}>{nodes.length}</span>
        </div>
        <div className={css.toolbarActions}>
          <button
            type="button"
            className={css.toolbarIconButton}
            aria-label={t('resetCanvas')}
            title={t('resetCanvas')}
            onClick={onResetViewport}
          >
            <IconRefreshOutline16 />
          </button>
          {onClose !== undefined && <button type="button" className={css.closeButton} aria-label={t('closeCanvas')} onClick={onClose}>×</button>}
        </div>
      </header>
      <div
        className={css.viewport}
        ref={viewportRef}
        data-panning={panning || undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={wheel}
      >
        {nodes.length === 0 ? <p className={css.empty}>{t('canvasEmpty')}</p> : <CanvasWorld
          nodes={nodes}
          windows={windows}
          edges={edges}
          viewport={viewport}
          onSelect={onSelect}
          onOpen={onOpen}
          onDelete={onDelete}
          onDraft={onDraft}
          onSend={onSend}
          onCancel={onCancel}
          {...(onBranch === undefined ? {} : { onBranch })}
          t={t}
        />}
        {nodes.length > 0 && (
          <CanvasMinimap
            nodes={nodes}
            edges={edges}
            viewport={viewport}
            viewportSize={{ width: viewportOffset.width, height: viewportOffset.height }}
            onSelect={onSelect}
            onViewport={onViewport}
            t={t}
          />
        )}
        <CanvasSelectionMenu
          rect={selectionRect}
          pending={selectionPending}
          error={selectionError}
          onSelect={id => { if (id === 'branch') onForkSelection() }}
          onClose={() => { window.getSelection()?.removeAllRanges() }}
          t={t}
        />
      </div>
    </section>
  )
}

function CanvasWorld({
  nodes, windows, edges, viewport, onSelect, onOpen, onDelete, onDraft, onSend, onCancel, onBranch,
  t,
}: {
  nodes: readonly CanvasNodeSnapshot[]
  windows: readonly CanvasSessionWindowSnapshot[]
  edges: readonly { from: SessionId; to: SessionId }[]
  viewport: CanvasViewport
  onSelect: (id: SessionId) => void
  onOpen: (id: SessionId) => void
  onDelete: (id: SessionId) => Promise<void> | void
  onDraft: (id: SessionId, text: string) => void
  onSend: (id: SessionId) => void
  onCancel: (id: SessionId) => void
  onBranch?: (id: SessionId, atSeq: number) => Promise<void> | void
  t: TranslateNS<typeof NS>
}) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  return (
    <div
      className={css.world}
      // Keep Tooltip's fixed bubble out of a transformed containing block.
      // `zoom` scales the world without making fixed descendants local to it;
      // the equivalent origin is placed explicitly in viewport coordinates.
      style={{
        left: viewport.x + 96 * viewport.scale,
        top: viewport.y + 96 * viewport.scale,
        zoom: viewport.scale,
      }}
    >
      <svg className={css.edges} width="3200" height="2600" aria-hidden>
        {edges.flatMap(edge => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          return from === undefined || to === undefined
            ? []
            : [<path className={css.edge} d={edgePath(from, to)} key={String(edge.from) + '-' + String(edge.to)} />]
        })}
      </svg>
      {windows.map(window => (
        <div className={css.windowPosition} key={window.id} style={{ left: window.x, top: window.y }}>
          <CanvasSessionWindow
            window={window}
            onSelect={onSelect}
            onOpen={onOpen}
            onDelete={onDelete}
            onDraft={onDraft}
            onSend={onSend}
            onCancel={onCancel}
            {...(onBranch === undefined ? {} : { onBranch })}
            t={t}
          />
        </div>
      ))}
    </div>
  )
}

/** Selection action rendered in viewport coordinates above the selected text. */
function SelectionBranchMenu({ rect, anchorScale, className, style, pending, error, onSelect, onClose, t }: {
  rect: SelectionRect | null
  anchorScale: number
  className: string | undefined
  style: { left: number; top: number } | null
  pending: boolean
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
  t: TranslateNS<typeof NS>
}) {
  const [display, setDisplay] = useState(() => rect === null || style === null ? null : { rect, anchorScale, style })
  const [visible, setVisible] = useState(() => rect !== null && style !== null)

  useEffect(() => {
    if (rect === null || style === null) {
      setVisible(false)
      const timer = setTimeout(() => { setDisplay(null) }, 150)
      return () => { clearTimeout(timer) }
    }
    setDisplay({ rect, anchorScale, style })
    setVisible(true)
    return undefined
  }, [anchorScale, rect, style?.left, style?.top])

  if (display === null) return null
  const menuClassName = [className, visible ? css.selectionMenuVisible : css.selectionMenuClosing].filter(Boolean).join(' ')
  return (
    <div
      className={menuClassName}
      style={display.style}
      data-loom-selection-menu
      aria-hidden={!visible}
      onPointerDown={event => { event.stopPropagation() }}
    >
      <Menu
        open={visible}
        side="top"
        compact
        anchor={<span className={css.selectionMenuReference} style={{ width: 0, height: 0 }} aria-hidden />}
        items={[{
          id: 'branch',
          label: pending ? t('branching') : t('branch'),
          icon: <LoomCanvasIcon />,
          disabled: pending,
        }]}
        {...(error === null ? {} : {
          footer: [{ type: 'label' as const, id: 'error', text: error }],
        })}
        onSelect={onSelect}
        onClose={onClose}
      />
    </div>
  )
}

function CanvasSelectionMenu({ rect, pending, error, onSelect, onClose, t }: {
  rect: SelectionRect | null
  pending: boolean
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
  t: TranslateNS<typeof NS>
}) {
  return (
    <SelectionBranchMenu
      rect={rect}
      anchorScale={1}
      className={css.sessionSelectionMenuAnchor}
      style={rect === null ? null : { left: rect.left + rect.width / 2, top: rect.top }}
      pending={pending}
      error={error}
      onSelect={onSelect}
      onClose={onClose}
      t={t}
    />
  )
}

/** Selection action positioned over the native session when Canvas is closed. */
function SessionSelectionMenu({ rect, pending, error, onSelect, onClose, t }: {
  rect: SelectionRect | null
  pending: boolean
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
  t: TranslateNS<typeof NS>
}) {
  return (
    <SelectionBranchMenu
      rect={rect}
      anchorScale={1}
      className={css.sessionSelectionMenuAnchor}
      style={rect === null ? null : { left: rect.left + rect.width / 2, top: rect.top }}
      pending={pending}
      error={error}
      onSelect={onSelect}
      onClose={onClose}
      t={t}
    />
  )
}

/** Canvas surface plus the existing text-selection branch menu. */
export function CanvasOverlay({
  useLoom, forkSelection, forkAt, openSession, closeCanvas, deleteSession, selectNode,
  setViewport, resetViewport, setDraft, sendSession, cancelSession, t,
}: LoomChatProps) {
  const snapshot = useLoom(value => value)
  const selection = snapshot.selection
  return (
    <>
      {snapshot.mode === 'canvas' && (
        <CanvasSurface
          nodes={snapshot.nodes}
          windows={snapshot.windows}
          edges={snapshot.edges}
          viewport={snapshot.viewport}
          onSelect={selectNode}
          onOpen={openSession}
          onDelete={deleteSession}
          onDraft={setDraft}
          onSend={sendSession}
          onCancel={id => { void cancelSession(id) }}
          onBranch={(id, atSeq) => { void forkAt(id, atSeq) }}
          onForkSelection={() => { void forkSelection() }}
          onViewport={setViewport}
          onResetViewport={resetViewport}
          selectionRect={selection.rect}
          selectionPending={selection.pending}
          selectionError={selection.error}
          onClose={closeCanvas}
          t={t}
        />
      )}
      {snapshot.mode === 'session' && (
        <SessionSelectionMenu
          rect={selection.rect}
          pending={selection.pending}
          error={selection.error}
          onSelect={id => { if (id === 'branch') void forkSelection() }}
          onClose={() => { window.getSelection()?.removeAllRanges() }}
          t={t}
        />
      )}
    </>
  )
}
