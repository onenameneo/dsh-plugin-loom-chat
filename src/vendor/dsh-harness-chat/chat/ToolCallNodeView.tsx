import { memo, useState, type ReactNode } from 'react'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.js'
import type { ToolCallBlock } from '../contract/snapshot.js'
import css from './ToolCallNodeView.module.css'

type ToolTranslate = (key: string, params?: Record<string, unknown>) => string

function settled(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map(item => {
    if (typeof item !== 'object' || item === null) return ''
    const block = item as Record<string, unknown>
    return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
  }).join('').trim()
}

function toolTitle(name: string | null, t: ToolTranslate): string {
  const normalized = (name ?? '').toLowerCase()
  const keys: Record<string, string> = {
    search: 'tool.title.search',
    read: 'tool.title.read',
    bash: 'tool.title.bash',
    write: 'tool.title.write',
    edit: 'tool.title.edit',
    code: 'tool.title.code',
    inspect: 'tool.title.inspect',
    pwsh: 'tool.title.pwsh',
    grep: 'tool.title.grep',
    glob: 'tool.title.glob',
    web_search: 'tool.title.webSearch',
    web_fetch: 'tool.title.webFetch',
  }
  const key = keys[normalized]
  return key === undefined ? name ?? t('tool.title.generic') : t(key)
}

function detailsFor(block: ToolCallBlock): { input: string; output: string; error: boolean } {
  if (!settled(block)) return { input: block.argsRaw, output: '', error: false }
  return {
    input: block.call?.argsRaw ?? '',
    output: textContent(block.content),
    error: block.isError,
  }
}

/** Renderer for the durable Tool-call surface node used by the native Chat view. */
export const ToolCallNodeView = memo(function ToolCallNodeView({
  node, t,
}: Pick<ChatNodeViewProps<'tool-call'>, 'node'> & { t: ToolTranslate }) {
  const root = node.data.root
  const isSettled = settled(root)
  const name = isSettled ? root.call?.name ?? null : root.name
  const details = detailsFor(root)
  const summary = isSettled
    ? root.isError ? t('row.failed') : details.output || t('terminal.done')
    : t('row.running')
  const body = [
    details.input === '' ? '' : `${t('row.input')}\n${details.input}`,
    details.output === '' ? '' : `${t('row.output')}\n${details.output}`,
  ].filter(Boolean).join('\n\n')
  const [expanded, setExpanded] = useState(false)
  const open = expanded && body !== ''
  const state = !isSettled ? 'running' : root.isError ? 'error' : 'ok'
  const leading: ReactNode = state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />

  return (
    <div className={css.root} data-tool-call={root.callId} data-state={state}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leading}
        title={toolTitle(name, t)}
        open={open}
        expandable={body !== ''}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-error={details.error || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.body} data-error={details.error || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
})
