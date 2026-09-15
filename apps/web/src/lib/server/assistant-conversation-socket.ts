import { Effect } from 'effect'
import { AssistantConversations } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversations'
import { runCapabilities } from '../capabilities'
import { sessionFromHeaders } from './auth-session-read'
import { answeringLocalD1 } from './auth-local-d1'

/** Cookies authenticate the upgrade; neither the URL nor client headers choose its member identity. */
export async function connectAssistantConversation(
  request: Request,
  conversationId: string
) {
  const url = new URL(request.url)
  if (
    request.headers.get('origin') !== url.origin ||
    request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
  ) {
    return new Response(null, { status: 403 })
  }
  return answeringLocalD1(() =>
    runCapabilities(
      Effect.gen(function* () {
        const session = yield* sessionFromHeaders(request.headers)
        if (session === null) {
          return new Response(null, { status: 401 })
        }
        const conversations = yield* AssistantConversations
        return yield* conversations.connect({
          conversationId,
          request,
          credential: {
            kind: 'session',
            userId: session.user.id,
            sessionId: session.session.id,
            expiresAt: session.session.expiresAt.getTime()
          }
        })
      }).pipe(
        Effect.catch((error) => {
          let status = 503
          if (error._tag === 'ConversationNotFound') {
            status = 404
          }
          if (error._tag === 'AssistantAuthorityDenied') {
            status = 403
          }
          return Effect.succeed(new Response(null, { status }))
        })
      )
    )
  )
}
