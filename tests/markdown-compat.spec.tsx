// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AssistantMarkdown } from '../src/vendor/dsh-harness-chat/chat/AssistantMarkdown.js'

describe('latest MarkdownText contract', () => {
  it('passes the complete labels object to assistant Markdown', () => {
    expect(() => render(
      <AssistantMarkdown
        blocks={[{ kind: 'text', text: 'answer' }] as never}
        streaming={false}
        renderMessageImages={() => null}
        t={((key: string) => key) as never}
      />,
    )).not.toThrow()
  })
})
