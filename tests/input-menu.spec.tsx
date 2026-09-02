// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MenuView } from '../src/vendor/dsh-input-trigger/MenuView.js'

afterEach(cleanup)

describe('Canvas command menu', () => {
  it('keeps the Harness menu open while another control in the composer card is pressed', () => {
    let state = {
      open: true,
      hit: null,
      generation: 1,
      highlight: null,
      groups: [{
        source: 'command',
        status: 'ready' as const,
        items: [{ name: 'compact', description: 'Compact history' }],
      }],
    }
    const listeners = new Set<() => void>()
    const onDismiss = vi.fn(() => {
      state = { ...state, open: false }
      listeners.forEach(listener => listener())
    })
    const t = ((key: string) => key) as never
    const headers = {
      getSnapshot: () => new Map([['command', [{ value: 'command', label: 'Commands', current: true }]]]),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    const ui = render(
      <div data-composer-card>
        <MenuView
          menu={{
            getSnapshot: () => state,
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
          }}
          headers={headers}
          onPick={vi.fn()}
          onHover={vi.fn()}
          onCrumb={vi.fn()}
          onDismiss={onDismiss}
          t={t}
        />
        <button type="button" data-testid="outside-control">Model</button>
      </div>,
    )

    fireEvent.pointerDown(ui.getByTestId('outside-control'))

    expect(onDismiss).not.toHaveBeenCalled()
    expect(ui.queryByRole('listbox')).toBeTruthy()
  })
})
