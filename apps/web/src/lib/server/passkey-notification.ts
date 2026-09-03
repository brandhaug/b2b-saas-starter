import { Effect } from 'effect'
import { passkeyChangeExchange, type AuthExchange } from './auth-audit/exchanges'
import { type AuthAuditContext } from './auth-audit/shared'

/**
 * A change to an account's sign-in credentials — a hijacked session adding
 * its own passkey, or stripping the owner's — must not be silent, so each
 * success emails the account holder. Same contract as
 * `two-factor-notification.ts`, which this mirrors for the passkey rows of
 * the audit table in `auth-audit/exchanges`.
 */
export type PasskeyChangedSender = (input: {
  readonly email: string
  readonly added: boolean
}) => Promise<void>

/**
 * Best-effort security notification after a successful passkey add or remove.
 * Never fails the auth exchange it observes: a missing pre-handler context
 * (no session), a non-2xx response, or a dispatcher rejection all resolve
 * quietly — the failure mode belongs to the wide event, not to Better Auth's
 * answer.
 */
export async function notifyPasskeyChanged(
  exchange: AuthExchange,
  response: Response,
  send: PasskeyChangedSender,
  context?: AuthAuditContext
): Promise<void> {
  const change = passkeyChangeExchange(exchange)
  if (!response.ok || change === null || context?.actorEmail === undefined) {
    return
  }
  // oxlint-disable-next-line effect/noTryCatch -- a notification failure must not fail the exchange that produced it; the wide event carries it instead
  try {
    await send({ email: context.actorEmail, added: change.added })
  } catch {
    // Swallowed by contract: the notification never fails the exchange it
    // observes; the wide event already carries the audit outcome.
  }
}

/** Effect-shaped wrapper so the route can annotate failures on the wide event. */
export function notifyPasskeyChangedEffect(
  exchange: AuthExchange,
  response: Response,
  send: PasskeyChangedSender,
  context?: AuthAuditContext
): Effect.Effect<void> {
  return Effect.promise(() => notifyPasskeyChanged(exchange, response, send, context))
}
