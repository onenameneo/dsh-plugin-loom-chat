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
  const Tooltip = ({ children, side }: { children: ReactNode; side?: string }) => createElement('div', { 'data-default-tooltip-side': side }, children)
  const JsonBlock = ({ label, payload }: { label: string; payload: unknown }) => createElement('div', null, label, ' ', JSON.stringify(payload))
  const StateDot = () => createElement('span')
  const useAnchoredMaxHeight = () => 320
  const DisclosureRow = ({ children, collapsedContent, title, open, onToggle }: { children?: ReactNode; collapsedContent?: ReactNode; title?: ReactNode; open?: boolean; onToggle?: () => void }) => createElement('div', null,
    createElement('button', { type: 'button', onClick: onToggle }, title, collapsedContent),
    open ? children : null,
  )
  const Button = ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => createElement('button', { type: 'button', onClick, disabled }, children)
  const Modal = ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => createElement('div', null, children, footer)
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
    CodeBlock: ({ code }: { code: string }) => createElement('pre', { 'data-testid': 'code-block' }, code),
    Button,
    Modal,
    JsonBlock,
    StateDot,
    useAnchoredMaxHeight,
    DisclosureRow,
    IconNewChatOutline16: Icon,
    IconTrashOutline16: Icon,
    IconRefreshOutline16: Icon,
    IconPlusOutline16: Icon,
    IconCopyOutline16: Icon,
    IconBranchOutline16: Icon,
    IconCheckOutline16: Icon,
    IconLikeOutline16: Icon,
    IconDislikeOutline16: Icon,
    IconChevronDownOutline14: Icon,
    IconChevronLeftOutline14: Icon,
    IconChevronRightOutline14: Icon,
    IconCloseFill14: Icon,
    IconCloseOutline16: Icon,
    IconThinkOutline14: Icon,
    IconBrowseOutline16: Icon,
    IconContextInjectionOutline16: Icon,
    IconApiOutline14: Icon,
    ReferenceIcon: Icon,
    IconWarningOutline16: Icon,
    Menu,
    MarkdownText: ({ text, labels }: { text: string; labels?: unknown }) => {
      if (labels === undefined) throw new Error('MarkdownText requires labels')
      return createElement('div', null, text)
    },
    MessageText: ({ text }: { text: string }) => createElement('span', null, text),
    projectUserText: (text: string) => createElement('span', null, text),
    writeClipboard: vi.fn(async () => true),
    Toast: () => null,
    RiskConfirmation: () => null,
    Tooltip,
  }
})
