import { Effect } from 'effect'
import { type AuthAuditContext } from './auth-audit/shared'

/**
 * The two two-factor endpoints whose success changes the account's second
 * factor. A change made by someone else — a hijacked session enabling its own
 * authenticator, or disabling the owner's — must not be silent, so each
 * success emails the account holder. The audit rows in `auth-audit/lifecycle`
 * already attribute these exchanges; this adds the user-facing half.
 */
export function isTwoFactorChangeExchange(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  if (exchange.method !== 'POST') {
    return false
  }
  return (
    exchange.pathname.endsWith('/two-factor/enable') ||
    exchange.pathname.endsWith('/two-factor/disable')
  )
}

export type TwoFactorChangedSender = (input: {
  readonly email: string
  readonly enabled: boolean
}) => Promise<void>

/**
 * Best-effort security notification after a successful two-factor enable or
 * disable. Never fails the auth exchange it observes: a missing pre-handler
 * context (no session), a non-2xx response, or a dispatcher rejection all
 * resolve quietly — the failure mode belongs to the wide event, not to Better
 * Auth's answer.
 */
export async function notifyTwoFactorChanged(
  request: Request,
  response: Response,
  send: TwoFactorChangedSender,
  context?: AuthAuditContext
): Promise<void> {
  const pathname = new URL(request.url).pathname
  if (
    !response.ok ||
    !isTwoFactorChangeExchange({ method: request.method, pathname }) ||
    context?.actorEmail === undefined
  ) {
    return
  }
  // oxlint-disable-next-line effect/noTryCatch -- a notification failure must not fail the exchange that produced it; the wide event carries it instead
  try {
    await send({
      email: context.actorEmail,
      enabled: pathname.endsWith('/two-factor/enable')
    })
  } catch {
    // Swallowed by contract: the notification never fails the exchange it
    // observes; the wide event already carries the audit outcome.
  }
}

/** Effect-shaped wrapper so the route can annotate failures on the wide event. */
export function notifyTwoFactorChangedEffect(
  request: Request,
  response: Response,
  send: TwoFactorChangedSender,
  context?: AuthAuditContext
): Effect.Effect<void> {
  return Effect.promise(() => notifyTwoFactorChanged(request, response, send, context))
}
