import { Effect } from 'effect'
import { twoFactorChangeExchange, type AuthExchange } from './auth-audit/exchanges'
import { type AuthAuditContext } from './auth-audit/shared'

/**
 * A change to an account's second factor — a hijacked session enabling its own
 * authenticator, or disabling the owner's — must not be silent, so each
 * success emails the account holder. Which exchanges those are is the
 * `notifyOnSuccess` column of the audit table in `auth-audit/exchanges`: the
 * rows already attribute these exchanges, this adds the user-facing half.
 */
export function isTwoFactorChangeExchange(exchange: AuthExchange): boolean {
  return twoFactorChangeExchange(exchange) !== null
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
  exchange: AuthExchange,
  response: Response,
  send: TwoFactorChangedSender,
  context?: AuthAuditContext
): Promise<void> {
  const change = twoFactorChangeExchange(exchange)
  if (!response.ok || change === null || context?.actorEmail === undefined) {
    return
  }
  // oxlint-disable-next-line effect/noTryCatch -- a notification failure must not fail the exchange that produced it; the wide event carries it instead
  try {
    await send({ email: context.actorEmail, enabled: change.enabled })
  } catch {
    // Swallowed by contract: the notification never fails the exchange it
    // observes; the wide event already carries the audit outcome.
  }
}

/** Effect-shaped wrapper so the route can annotate failures on the wide event. */
export function notifyTwoFactorChangedEffect(
  exchange: AuthExchange,
  response: Response,
  send: TwoFactorChangedSender,
  context?: AuthAuditContext
): Effect.Effect<void> {
  return Effect.promise(() => notifyTwoFactorChanged(exchange, response, send, context))
}
