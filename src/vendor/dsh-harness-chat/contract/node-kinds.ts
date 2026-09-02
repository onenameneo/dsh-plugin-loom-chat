/** Official Harness node-kind registration, kept with the copied renderers. */
declare module './chat-nodes.js' {
  interface ChatNodeDataMap {
    'assistant-step': import('./chat-nodes.js').AssistantChatData
    command: import('./snapshot.js').CommandNode
    'manual-compaction': import('./chat-nodes.js').ManualCompactionChatData
    compaction: import('./snapshot.js').CompactionSummaryNode
    unknown: { readonly type: string; readonly data: unknown }
    'system-prompt': { readonly text: string }
    user: import('./snapshot.js').UserMessageNode
    steering: import('./snapshot.js').SteeringMessageNode
    context: import('./snapshot.js').ContextMessageNode
    'model-retry': import('./chat-nodes.js').RetryChatData
    'tool-call': import('./chat-nodes.js').ToolChatData
    'turn-error': import('./snapshot.js').TurnErrorNode
    'turn-max-tokens': import('./snapshot.js').TurnMaxTokensNode
    'turn-process': import('./chat-nodes.js').TurnProcessChatData
    'turn-tail': import('./chat-nodes.js').TurnTailChatData
  }
}
