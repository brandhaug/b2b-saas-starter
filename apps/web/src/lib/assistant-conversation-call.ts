import { type ConversationResult } from './server/assistant-conversations'
import { callServerFn } from './server-call'
import { m } from '@b2b-saas-starter/i18n/messages'

/** Preserve typed refusals and give transport failures the same safe UI contract. */
export async function callConversation<A>(
  call: () => Promise<ConversationResult<A>>
): Promise<ConversationResult<A>> {
  const result = await callServerFn(call, m.assistant_conversations_unavailable())
  if (result.ok) {
    return result.value
  }
  return {
    ok: false,
    reason: 'unavailable',
    message: result.message,
    retryAfterSeconds: null
  }
}
