import { createElement, Fragment, type ReactNode } from 'react'
import { vi } from 'vitest'

interface MenuItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Icon = () => null
  const Tooltip = ({ children }: { children: ReactNode }) => children
  const Menu = ({
    open, anchor, items, onSelect,
  }: {
    open: boolean
    anchor: ReactNode
    items: readonly MenuItem[]
    onSelect: (id: string) => void
  }) => createElement(Fragment, null,
    anchor,
    open && createElement('div', { role: 'menu' }, items.map(item => createElement(
      'button',
      {
        key: item.id,
        role: 'menuitem',
        disabled: item.disabled,
        onClick: () => { onSelect(item.id) },
      },
      item.icon,
      item.label,
    ))),
  )
  return {
    IconNewChatOutline16: Icon,
    IconTrashOutline16: Icon,
    IconRefreshOutline16: Icon,
    IconPlusOutline16: Icon,
    IconChevronDownOutline14: Icon,
    IconChevronLeftOutline14: Icon,
    IconChevronRightOutline14: Icon,
    Menu,
    RiskConfirmation: () => null,
    Tooltip,
  }
})
