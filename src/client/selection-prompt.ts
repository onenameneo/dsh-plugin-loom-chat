/**
 * Build the user message that carries a selection into a forked context.
 * @param selectedText - text selected in the completed assistant response.
 * @returns the localized selection prompt sent to the forked context.
 */
export function buildSelectionPrompt(selectedText: string): string {
  const text = selectedText.trim()
  return [
    '请针对下面选中的内容进行解释，并保留此前会话上下文：',
    '',
    '<selected-content>',
    text,
    '</selected-content>',
  ].join('\n')
}
