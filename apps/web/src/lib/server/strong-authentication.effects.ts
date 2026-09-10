import { type Session } from '@b2b-saas-starter/auth'
import {
  StrongAuthentication,
  type StrongAuthenticationInput,
  type StrongAuthenticationStatus
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
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
  const allowed = await runCapabilities(
    Effect.flatMap(RateLimiter, (limiter) =>
      limiter.take({ bucket: 'auth_sign_in', key: session.user.id })
    ).pipe(Effect.provide(makeRateLimiterLayer(env)), Effect.scoped)
  )
  if (!allowed) {
    return false
  }
  return sessionCall((api, headers) =>
    api.verifyPassword({ body: { password }, headers }).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    )
  )
}
