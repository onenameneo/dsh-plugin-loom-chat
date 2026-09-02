import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

type SnapshotStore<T> = { getSnapshot: () => T; subscribe: (listener: () => void) => () => void }

export interface MenuItem {
  name: string
  description?: string
  section?: string
  icon?: any
  drill?: boolean
}

export interface MenuGroup {
  source: string
  status: string
  items: readonly MenuItem[]
  showGroupTitle?: boolean
}

export interface MenuState {
  open: boolean
  highlight: { source: string; index: number } | null
  groups: readonly MenuGroup[]
}

export interface MenuViewInjected {
  menu: SnapshotStore<MenuState>
  headers: SnapshotStore<ReadonlyMap<string, readonly { value: string; label: string; current?: boolean }[]>>
  onPick: (source: string, index: number, action?: any) => void
  onHover: (source: string, index: number) => void
  onCrumb: (source: string, index: number) => void
  onDismiss: () => void
}

export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>
