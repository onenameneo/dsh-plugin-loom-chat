/**
 * Loom Chat browser surface: an infinite session Canvas plus native DSH
 * single-session navigation. The host remains responsible for conversation UI.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { LoomChatController } from './controller.js'
import { CanvasOverlay } from './CanvasOverlay.js'
import { LoomBranchAction } from './LoomBranchAction.js'
import { LoomCanvasAction } from './LoomCanvasAction.js'
import type { LoomBranchActionInjected, LoomCanvasActionInjected, LoomChatInjected } from './slots.js'
import { en, NS, zh } from './locales.js'

export type {
  CanvasNodeSnapshot, CanvasSessionWindowSnapshot, CanvasViewport, LoomChatSnapshot, LoomInputState, LoomMode, LoomSessionInput, SelectionRect,
} from './controller.js'
export type { LoomBranchActionInjected, LoomBranchActionProps, LoomCanvasActionInjected, LoomCanvasActionProps, LoomChatInjected, LoomChatProps } from './slots.js'
export { buildSelectionPrompt } from './selection-prompt.js'
export { buildSessionGraph, latestStableBoundary } from './session-graph.js'

/** Services used by the Canvas and locale registration. */
export const inject = ['sessions', 'slots', 'locale', 'conversation', 'workspaces']

/** Install Canvas navigation, native-session actions, and assistant branching. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loom-chat: dictionaries')
  ctx.effect(() => {
    type SessionInput = ReturnType<IConversation['input']['for']>
    const controller = new LoomChatController(
      ctx.sessions,
      (sessionId: SessionId): SessionInput | undefined => {
        const scope = ctx.sessions.scope(sessionId)
        return scope === undefined ? undefined : ctx.conversation.input.for(scope)
      },
      ctx.workspaces,
    )
    const injectFace = (): LoomChatInjected => ({
      hooks: { loom: controller },
      forkSelection: () => controller.forkSelection(),
      openSession: id => { controller.openSession(id) },
      closeCanvas: () => { controller.closeCanvas() },
      deleteSession: id => controller.deleteSession(id),
      selectNode: id => { controller.selectNode(id) },
      branchSelected: () => controller.branchSelected(),
      branchSession: id => controller.branchSession(id),
      setViewport: viewport => { controller.setViewport(viewport) },
      resetViewport: () => { controller.resetViewport() },
      setDraft: (id, text) => { controller.setDraft(id, text) },
      sendSession: id => { controller.sendSession(id) },
      cancelSession: id => controller.cancelSession(id),
    })
    const injectCanvasAction = (): LoomCanvasActionInjected => ({
      hooks: { loom: controller },
      openCanvas: () => { controller.openCanvas() },
    })
    const disposeBranchAction = ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'loom-branch',
      order: 20,
      locale: NS,
      inject: (): LoomBranchActionInjected => ({
        hooks: { loom: controller },
        forkAt: (sessionId, atSeq) => controller.forkAt(sessionId, atSeq),
      }),
    }, LoomBranchAction))
    const disposeCanvasAction = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'loom-canvas',
      order: 20,
      locale: NS,
      inject: injectCanvasAction,
    }, LoomCanvasAction))
    const disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'loom-chat',
      order: 40,
      locale: NS,
      inject: injectFace,
    }, CanvasOverlay))
    return () => {
      disposeOverlay()
      disposeCanvasAction()
      disposeBranchAction()
      controller.dispose()
    }
  }, 'loom-chat: Canvas controller + actions')
}
