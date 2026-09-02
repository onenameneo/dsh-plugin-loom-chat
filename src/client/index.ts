/**
 * Loom Chat browser surface: a plugin-owned session Canvas plus native DSH
 * single-session navigation. The host remains responsible for native UI.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LoomChatController } from './controller.js'
import type { LoomSessionInput } from './controller.js'
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
export const inject = [
  'sessions',
  'slots',
  'locale',
  'conversation',
  'uiConversation',
  'workspaces',
  'inputTriggers',
  'modelDirectories',
  'remote',
  'remote.session',
]

type UnknownRecord = Record<string, unknown>

function methodOf(value: UnknownRecord, actions: UnknownRecord | undefined, name: string): ((...args: any[]) => any) | undefined {
  const direct = value[name]
  if (typeof direct === 'function') return direct.bind(value)
  const action = actions?.[name]
  return typeof action === 'function' ? action.bind(actions) : undefined
}

/**
 * Accept both released DSH input faces: the full SessionInput facade exposes
 * verbs directly, while some host builds expose the same verbs under
 * `input.actions`. Canvas only needs one stable writable face and should not
 * make the component care which host shape supplied it.
 */
function adaptInputFace(value: unknown): LoomSessionInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as UnknownRecord
  const actions = typeof raw.actions === 'object' && raw.actions !== null ? raw.actions as UnknownRecord : undefined
  const setDraft = methodOf(raw, actions, 'setDraft')
  if (setDraft === undefined) return undefined
  const adapted: LoomSessionInput = {
    ...raw,
    setDraft: (text, editRange) => { setDraft(text, editRange) },
  } as LoomSessionInput
  for (const name of ['addImages', 'removeImage', 'pruneImages', 'submit'] as const) {
    const method = methodOf(raw, actions, name)
    if (method !== undefined) (adapted as unknown as UnknownRecord)[name] = (...args: any[]) => method(...args)
  }
  return adapted
}

/** Install Canvas navigation, native-session actions, and assistant branching. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loom-chat: dictionaries')
  ctx.effect(() => {
    const inputCache = new Map<SessionId, LoomSessionInput>()
    const controller = new LoomChatController(
      ctx.sessions,
      (sessionId: SessionId): LoomSessionInput | undefined => {
        // `scope(id)` is a use-and-discard lookup and can be absent while a
        // detached Canvas window is already assembled. The stable binding is
        // the public session-addressed assembly feed and carries the exact
        // context that created the per-session input shell. Using it keeps a
        // Canvas composer live without opening or selecting that session.
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) return undefined
        const input = adaptInputFace(ctx.conversation.input.for(binding.ctx))
        if (input === undefined) return undefined
        const conversation = ctx.conversation as unknown as {
          createDraftImages?: (files: readonly File[]) => readonly unknown[]
          draftImages?: (ids: readonly unknown[]) => readonly unknown[]
          releaseDraftImages?: (attachments: readonly unknown[]) => void
          resolveImage?: (sessionId: SessionId, attachment: unknown) => Promise<string>
        }
        const inputTriggers = ctx.inputTriggers.sessionOf(binding.ctx)
        const directory = ctx.modelDirectories.directoryFor(sessionId)
        const available = ctx.sessions.subagentAddress(sessionId) === undefined
        const value: LoomSessionInput = {
          ...input,
          ...(conversation.createDraftImages === undefined ? {} : { createDraftImages: (files: readonly File[]) => conversation.createDraftImages!(files) }),
          ...(conversation.draftImages === undefined ? {} : { draftImages: (ids: readonly unknown[]) => conversation.draftImages!(ids) }),
          ...(conversation.releaseDraftImages === undefined ? {} : { releaseDraftImages: (attachments: readonly unknown[]) => conversation.releaseDraftImages!(attachments) }),
          ...(conversation.resolveImage === undefined ? {} : { resolveImage: (attachment: unknown) => conversation.resolveImage!(sessionId, attachment) }),
          inputTriggers,
          model: {
            available,
            directory: directory.store,
            load: () => { if (available) directory.load().catch(() => {}) },
            select: selection => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
          },
        }
        const cached = inputCache.get(sessionId)
        if (cached !== undefined) {
          // Canvas renders from controller snapshots. Keep the adapter object
          // stable across those publishes so NativeComposer does not recreate
          // its Lexical editor while only the surrounding Canvas state changed.
          Object.assign(cached, value)
          return cached
        }
        inputCache.set(sessionId, value)
        return value
      },
      ctx.workspaces,
      ctx.uiConversation,
    )
    const injectFace = (): LoomChatInjected => ({
      hooks: { loom: controller },
      forkSelection: () => controller.forkSelection(),
      forkAt: (id, atSeq) => controller.forkAt(id, atSeq),
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
      inputCache.clear()
      controller.dispose()
    }
  }, 'loom-chat: Canvas controller + actions')
}
