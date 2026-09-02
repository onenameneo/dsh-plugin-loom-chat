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

/**
 * Hide the transport-only selection envelope when rendering a branch history.
 * The envelope is still sent to the model; Canvas already presents the
 * selected text in its separate reference card, so showing it again makes the
 * user's actual follow-up look like an injected system prompt.
 */
export function displaySelectionMessageText(message: string): string {
  const prefix = '请针对下面选中的内容进行解释，并保留此前会话上下文：\n\n<selected-content>\n'
  if (!message.startsWith(prefix)) return message
  const endTag = '\n</selected-content>'
  const end = message.indexOf(endTag, prefix.length)
  if (end < 0) return message
  return message.slice(end + endTag.length).replace(/^\n+/u, '').trim()
}
