import { type Session } from '@b2b-saas-starter/auth'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { sessionCall } from './plugin-call'
import { RateLimiter, makeRateLimiterLayer } from '../rate-limit'
import { env } from 'cloudflare:workers'

export async function readStrongAuthenticationStatus() {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.status({ userId: session.user.id, sessionId: session.session.id })
    )
  )
}

export function requireStrongAuthentication(session: Session) {
  return runCapabilities(
    Effect.flatMap(StrongAuthentication, (authentication) =>
      authentication.require({ userId: session.user.id, sessionId: session.session.id })
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
