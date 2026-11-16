import { type Session } from '@b2b-saas-starter/auth'
import {
  StrongAuthentication,
  type StrongAuthenticationInput,
  type StrongAuthenticationStatus
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { annotateWideEvent } from '@b2b-saas-starter/logger'
import { Effect, Option, Schema } from 'effect'
import { runCapabilities } from '../capabilities'
import { memoizePerRequest } from '../observability'
import { requireRequestSession } from './auth'
import { sessionCall } from './plugin-call'
import { RateLimiter, makeRateLimiterLayer } from '../rate-limit'
import { env } from 'cloudflare:workers'

/**
 * One strong-authentication evidence read per request, per session.
 *
 * `LiveStrongAuthentication.status` costs three D1 selects (the session row,
 * the verified TOTP factor, the passkeys) and one navigation asks the same
 * question more than once: the workspace subtree's gate asks it in
 * `beforeLoad`, and the page's own permission check asks it again. The reads
 * join the app's request-scoped memo slot rather than each paying for the
 * round trip.
 *
 * A slot cannot outlive the truth it holds: evidence only changes through a
 * verification ceremony, and a ceremony is its own request.
 */
export function strongAuthenticationStatusFor(
  input: StrongAuthenticationInput
): Promise<StrongAuthenticationStatus> {
  return memoizePerRequest(
    `strong-authentication.status:${input.userId}:${input.sessionId}`,
    () =>
      runCapabilities(
        Effect.flatMap(StrongAuthentication, (authentication) =>
          authentication.status(input)
        )
      )
  )
}

export async function readStrongAuthenticationStatus() {
  const session = await requireRequestSession()
  return strongAuthenticationStatusFor({
    userId: session.user.id,
    sessionId: session.session.id
  })
}

export function requireStrongAuthentication(session: Session) {
  return runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.require({ userId: session.user.id, sessionId: session.session.id })
    )
  )
}

export function requireRecentAuthentication(session: Session) {
  return runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.requireRecent({
        userId: session.user.id,
        sessionId: session.session.id
      })
    )
  )
}

export async function verifyCurrentPassword(password: string): Promise<boolean> {
  const session = await requireRequestSession()
  if (session.session.impersonatedBy) {
    return false
  }
  return runCapabilities(
    Effect.gen(function* () {
      const limiter = yield* RateLimiter
      if (!(yield* limiter.take({ bucket: 'auth_sign_in', key: session.user.id }))) {
        return false
      }
      return yield* checkCurrentPassword(password)
    }).pipe(Effect.provide(makeRateLimiterLayer(env)), Effect.scoped)
  )
}

const STRONG_AUTHENTICATION = 'strong-authentication'

/** The plugin's code for a password that does not match the account's. */
const INVALID_PASSWORD = 'INVALID_PASSWORD'

const PluginStatus = Schema.Struct({ statusCode: Schema.Number })
const decodePluginStatus = Schema.decodeUnknownOption(PluginStatus)

/** Why the check failed, in code-owned terms: the plugin's message stays out. */
type PasswordCheckFailure = {
  readonly reason:
    | 'plugin_rate_limited'
    | 'plugin_session_rejected'
    | 'plugin_failed'
    | 'auth_store_unavailable'
}

/** The plugin's status as a code-owned class; `statusCode` belongs to the request's own event. */
function pluginFailure(statusCode: number): PasswordCheckFailure {
  if (statusCode === 429) {
    return { reason: 'plugin_rate_limited' }
  }
  if (statusCode === 401 || statusCode === 403) {
    return { reason: 'plugin_session_rejected' }
  }
  return { reason: 'plugin_failed' }
}

/**
 * Only the plugin's `INVALID_PASSWORD` is a wrong password. Every other
 * failure — its 5xx, its own 429, a 401 for a session that expired
 * mid-ceremony, a D1 throw or a missing binding — is the check failing, which
 * the page must not present as a wrong password.
 */
function checkCurrentPassword(
  password: string
): Effect.Effect<boolean, CapabilityUnavailable> {
  return Effect.tryPromise({
    try: () =>
      sessionCall((api, headers) =>
        api.verifyPassword({ body: { password }, headers }).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error.code === INVALID_PASSWORD,
            () => Effect.succeed(false)
          )
        )
      ),
    catch: (cause): PasswordCheckFailure =>
      Option.match(decodePluginStatus(cause), {
        onNone: () => ({ reason: 'auth_store_unavailable' }),
        onSome: ({ statusCode }) => pluginFailure(statusCode)
      })
  }).pipe(
    Effect.tapError((failure) =>
      annotateWideEvent({ capability: STRONG_AUTHENTICATION, ...failure })
    ),
    Effect.mapError(
      ({ reason }) =>
        new CapabilityUnavailable({ capability: STRONG_AUTHENTICATION, reason })
    )
  )
}
