import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from 'react'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import css from './ModelSelect.module.css'

type Pane = 'root' | 'model' | 'effort'
interface EffortChoice { key: string; effort: string | undefined; label: string; description?: string }
const classes = (...values: Array<string | false | undefined>): string => values.filter(Boolean).join(' ')

/** Vendored from DSH ui-model-selection: the public package does not export its React seat. */
export function ModelSelect({ locked, available, directory, load, select, t }: ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>) {
  const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot(), () => directory.getSnapshot())
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const lastAction = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const choices = useMemo(() => state.groups.flatMap(group => group.models.map(model => ({ group, model }))), [state.groups])
  const currentChoice = choices.find(choice => state.current?.provider === choice.group.id && state.current.model === choice.model.id)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined ? undefined : effectiveEffort === undefined
    ? t('effort.providerDefault')
    : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined ? [] : [
    ...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }] : []),
    ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name, ...effort.description === undefined ? {} : { description: effort.description } })),
  ], [reasoning, t])
  const busy = state.status === 'selecting'
  const reload = (): void => { lastAction.current = 'load'; load() }
  useEffect(() => { if (available) { lastAction.current = 'load'; load() } }, [available, load])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])
  if (!available) return null
  const close = (restoreFocus = false): void => {
    setOpen(false); setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }
  const show = (): void => { setPane('root'); setOpen(true); reload() }
  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) { event.preventDefault(); pane === 'root' ? close(true) : setPane('root'); return }
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); moveFocus(event.key === 'ArrowDown' ? 1 : -1) }
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }
  const settle = (accepted: boolean): void => {
    if (accepted) { close(true); return }
    const message = directory.getSnapshot().error
    if (message !== null) { toastSeq.current += 1; setToast({ seq: toastSeq.current, text: t('error.action', { message }) }) }
  }
  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) { close(true); return }
    lastAction.current = 'select'; void select(selection).then(settle)
  }
  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) { close(true); return }
    lastAction.current = 'select'
    void select({ provider: state.current.provider, model: state.current.model, ...effort === undefined ? {} : { reasoningEffort: effort } }).then(settle)
  }
  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined ? t('trigger.selectAria') : t('trigger.aria', { model: triggerLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => { const index = itemIndex++; return (node: HTMLButtonElement | null) => { itemRefs.current[index] = node } }
  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown} onBlur={onBlur} data-native-model-select>
      <button ref={triggerRef} type="button" className={css.trigger} aria-label={triggerAria} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} title={triggerLabel} disabled={locked} onClick={() => { open ? close() : show() }}>
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={classes(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && <div id={`${id}-menu`} className={css.menu} role="menu" aria-label={t('menu.aria')} aria-busy={state.status === 'loading' || busy}>
        {pane === 'root' && <>
          <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}><span className={css.cellLabel}>{t('menu.model')}</span><span className={css.cellValue}>{modelLabel}</span><IconChevronRightOutline14 className={css.cellChevron} /></button>
          {reasoning !== undefined && <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}><span className={css.cellLabel}>{t('menu.effort')}</span><span className={css.cellValue}>{effortLabel}</span><IconChevronRightOutline14 className={css.cellChevron} /></button>}
        </>}
        {pane === 'model' && <>
          {state.status === 'loading' && <div className={css.status}>{t('status.loading')}</div>}
          {state.error !== null && lastAction.current === 'load' && <div className={css.error}><span>{t('error.action', { message: state.error })}</span><button type="button" className={css.retry} onClick={reload}>{t('retry')}</button></div>}
          {state.failures.map(failure => <div className={css.warning} key={failure.id}><span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span><button type="button" className={css.retry} onClick={reload}>{t('retry')}</button></div>)}
          <div className={classes(css.groups, 'scrollable')}>{state.groups.map(group => <section role="group" aria-label={group.name} className={css.group} key={group.id}><div className={css.groupTitle}>{group.name}</div>{group.models.map(model => { const selected = state.current?.provider === group.id && state.current.model === model.id; return <button ref={itemRef()} type="button" role="menuitemradio" aria-checked={selected} className={classes(css.option, selected && css.selected)} key={model.id} title={model.name} disabled={busy} onClick={() => { choose({ provider: group.id, model: model.id }) }}><span className={css.optionCopy}><span className={css.modelName}>{model.name}</span>{model.description !== undefined && <span className={css.description}>{model.description}</span>}</span><span className={css.check}>{selected ? <IconCheckOutline16 /> : null}</span></button> })}</section>)}</div>
          {state.status === 'ready' && choices.length === 0 && <div className={css.empty}>{t('empty.models')}</div>}
        </>}
        {pane === 'effort' && <>{effortChoices.length === 0 ? <div className={css.empty}>{t('empty.efforts')}</div> : effortChoices.map(level => <button ref={itemRef()} type="button" role="menuitemradio" aria-checked={effectiveEffort === level.effort} className={classes(css.option, effectiveEffort === level.effort && css.selected)} key={level.key} disabled={busy} onClick={() => { chooseEffort(level.effort) }}><span className={css.optionCopy}><span className={css.modelName}>{level.label}</span>{level.description !== undefined && <span className={css.description}>{level.description}</span>}</span><span className={css.check}>{effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}</span></button>)}</>}
      </div>}
      {toast !== null && <Toast key={toast.seq} text={toast.text} icon={<IconWarningOutline16 />} anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null} onDone={() => { setToast(null) }} />}
    </div>
  )
}
