import { describe, expect, it } from 'vitest'
import { buildSelectionPrompt } from '../src/client/selection-prompt.js'

describe('buildSelectionPrompt', () => {
  it('keeps the fork context and labels the selected content in one user message', () => {
    expect(buildSelectionPrompt('  explain this  ')).toBe([
      '请针对下面选中的内容进行解释，并保留此前会话上下文：',
      '',
      '<selected-content>',
      'explain this',
      '</selected-content>',
    ].join('\n'))
  })
})
