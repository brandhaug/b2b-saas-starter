import { AssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory'
import { AssistantConversationLifecycle } from '@b2b-saas-starter/capabilities/assistant/lifecycle'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { type ConversationResult } from './assistant-conversations'

function outcome<A, R>(effect: Effect.Effect<A, CapabilityUnavailable, R>) {
  return effect.pipe(
    Effect.match({
      onSuccess: (value): ConversationResult<A> => ({ ok: true, value }),
      onFailure: (): ConversationResult<A> => ({
        ok: false,
        reason: 'unavailable',
        message: m.assistant_conversations_unavailable(),
        retryAfterSeconds: null
      })
    })
  )
}
export async function loadOwnedConversationsHandler() {
  const session = await requireRequestSession()
  return runCapabilities(
    outcome(
      Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        const rows = yield* directory.listForCreator(session.user.id)
        return rows.map(({ id, createdAt }) => ({ id, createdAt }))
      })
    )
  )
}
export async function deleteOwnedConversationHandler(input: {
  readonly conversationId: string
}) {
  const session = await requireRequestSession()
  return runCapabilities(
    outcome(
      Effect.flatMap(AssistantConversationLifecycle, (lifecycle) =>
        lifecycle.deleteOwned(session.user.id, input.conversationId)
      )
    )
  )
}
