// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CanvasBranchAction } from '../src/client/CanvasBranchAction.js'
import { composerTranslation } from '../src/client/NativeComposer.js'
import { nativeTranslation } from '../src/client/NativeSessionSurface.js'
import { MessageIconActions } from '../src/vendor/dsh-harness-chat/chat/MessageIconActions.js'
import { StatsLine } from '../src/vendor/dsh-harness-chat/chat/StatsLine.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Canvas action tooltips', () => {
  it('does not leak compact duration translation keys from the stats line', () => {
    const translate = composerTranslation(((key: string) => key) as never)

    expect(translate('duration.compactSeconds', { seconds: 4.2 })).toBe('4.2s')
    expect(translate('duration.compactMinutes', { minutes: 2, seconds: 4 })).toBe('2m4s')
    expect(translate('stats.counts', { turns: 2, steps: 8 })).toBe('2 turns · 8 steps')
  })

  it('uses the reference Chinese Chat dictionaries when the Canvas locale is Chinese', () => {
    const composer = composerTranslation(((key: string) => key === 'running' ? '运行中' : key) as never)
    const session = nativeTranslation(((key: string) => key === 'running' ? '运行中' : key) as never)

    expect(composer('duration.compactSeconds', { seconds: 4.2 })).toBe('4.2秒')
    expect(composer('stats.counts', { turns: 2, steps: 8 })).toBe('2 轮 · 8 步')
    expect(session('duration.seconds', { seconds: 5 })).toBe('5秒')
    expect(session('message.ranFor', { duration: '5秒' })).toBe('用时 5秒')
  })

  it('uses the same default Tooltip as the native Loom action', () => {
    const ui = render(<CanvasBranchAction onBranch={() => {}} branchLabel="Branch into Loom Chat" />)

    expect(ui.container.querySelector('[data-default-tooltip-side="bottom"]')).not.toBeNull()
    expect(ui.container.querySelector('.canvasTooltip')).toBeNull()
    expect(ui.getByRole('button', { name: 'Branch into Loom Chat' })).toBeTruthy()
  })

  it('resolves the embedded Chat usage and timing labels instead of leaking keys', () => {
    const translate = nativeTranslation(((key: string) => key) as never)

    expect(translate('message.turnUsage.consumed', { total: '12 tok' })).toBe('Usage 12 tok')
    expect(translate('message.turnUsage.title')).toBe('Turn usage')
    expect(translate('message.turnTime.title')).toBe('Turn time and speed')
    expect(translate('message.turnUsage.count', { count: '12' })).toBe('12 tok')
  })

  it('keeps the Harness action row and its native tooltip contract', () => {
    const t = ((key: string) => ({ copy: 'Copy', copied: 'Copied', 'message.branch': 'Branch', 'message.branchUnavailable': 'Branch unavailable' }[key] ?? key)) as never
    const ui = render(
      <MessageIconActions
        text="answer"
        clock="end"
        onBranch={() => {}}
        t={t}
      />,
    )

    expect(ui.getByRole('button', { name: 'Branch' })).toBeTruthy()
    expect(ui.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('routes the native stats tooltip through the Canvas coordinate adapter', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 100 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 50 })
    vi.stubGlobal('ResizeObserver', class {
      private readonly callback: () => void
      constructor(callback: () => void) { this.callback = callback }
      observe(): void { this.callback() }
      disconnect(): void {}
    })
    const t = ((key: string, params?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'stats.counts': '{turns} round · {steps} steps',
        'stats.llm': 'LLM {duration}',
      }
      return (values[key] ?? key).replaceAll('{turns}', String(params?.turns ?? '')).replaceAll('{steps}', String(params?.steps ?? '')).replaceAll('{duration}', String(params?.duration ?? ''))
    }) as never
    render(
      <StatsLine
        useChat={((selector: (snapshot: unknown) => unknown) => selector({ legacy: { nodes: [{ kind: 'assistant', turn: 1, timing: { stepStartTime: 0, firstTokenTime: null, completedTime: 1000 }, blocks: [] }] } })) as never}
        useProjection={() => undefined}
        t={t}
      />,
    )

    await waitFor(() => expect(screen.getByText('1 round · 1 steps')).toBeTruthy())
  })
})
