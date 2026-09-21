import { Auth } from '@b2b-saas-starter/auth'
import { errorMessage } from '@b2b-saas-starter/failure'
import { Effect, Schema } from 'effect'
import { authAvailability } from '../../auth-runtime'
import { MissingD1Binding } from '../auth-local-d1'
import { exchangeRow, type AuthExchange } from './exchanges'
import {
  AuthAuditBodyUnreadable,
  readAndReportBody,
  readRequestUserId,
  type AuthAuditContext
} from './shared'

const TokenBody = Schema.Struct({ sessionToken: Schema.String })

/** Resolve destructive endpoint targets while their sessions still exist. */
export const resolveAuthTarget = Effect.fn('AuthAudit.resolveTarget')(function* (
  exchange: AuthExchange,
  context: AuthAuditContext
) {
  const sources = exchangeRow(exchange)?.targetFrom
  if (context.request === undefined || sources === undefined) {
    return context
  }
  const request = context.request
  let targetUserId: string | null = null
  if (sources.includes('session-token')) {
    const body = yield* readAndReportBody(
      Effect.tryPromise(() => request.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(TokenBody)),
        Effect.mapError(
          (cause) =>
            new AuthAuditBodyUnreadable({
              reason: errorMessage(cause) ?? 'auth request body could not be read'
            })
        )
      )
    )
    if (body === null) {
      return { ...context, targetUserId }
    }
    const { sessionToken } = body
    const availability = authAvailability()
    if (!availability.available) {
      return yield* Effect.fail(new MissingD1Binding({ property: 'DB' }))
    }
    targetUserId = yield* Effect.tryPromise(() =>
      availability.runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const plugin = yield* Effect.promise(() => auth.instance.$context)
          const session = yield* Effect.promise(() =>
            plugin.internalAdapter.findSession(sessionToken)
          )
          return session?.user.id ?? null
        })
      )
    )
  } else if (sources.includes('request')) {
    targetUserId = yield* readAndReportBody(readRequestUserId(request))
  }
  return { ...context, targetUserId }
})
