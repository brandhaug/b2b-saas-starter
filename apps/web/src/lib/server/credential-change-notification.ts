import { Effect } from 'effect'
import {
  exchangeRow,
  type AuthExchange,
  type CredentialChange
} from './auth-audit/exchanges'
import { type AuthAuditContext } from './auth-audit/shared'

/**
 * A change to an account's sign-in credentials — a hijacked session enabling
 * its own authenticator, enrolling its own passkey, or stripping the owner's —
 * must not be silent, so each success emails the account holder. Which
 * exchanges those are is the `notifyOnSuccess` column of the audit table in
 * `auth-audit/exchanges`: the rows already attribute these exchanges, this
 * adds the user-facing half. One notifier for every credential, because the
 * rows name the change themselves.
 */
export type CredentialChangeSender = (input: {
  readonly email: string
  readonly change: CredentialChange
}) => Promise<void>

/**
 * Best-effort security notification after a successful two-factor enable or
 * disable, or passkey add or remove. Never fails the auth exchange it
 * observes: a missing pre-handler context (no session), a non-2xx response,
 * or a dispatcher rejection all resolve quietly — the failure mode belongs to
 * the wide event, not to Better Auth's answer.
 */
export async function notifyCredentialChanged(
  exchange: AuthExchange,
  response: Response,
  send: CredentialChangeSender,
  context?: AuthAuditContext
): Promise<void> {
  const change = exchangeRow(exchange)?.notifyOnSuccess
  if (!response.ok || change === undefined || context?.actorEmail === undefined) {
    return
  }
  // oxlint-disable-next-line effect/noTryCatch -- a notification failure must not fail the exchange that produced it; the wide event carries it instead
  try {
    await send({ email: context.actorEmail, change })
  } catch {
    // Swallowed by contract: the notification never fails the exchange it
    // observes; the wide event already carries the audit outcome.
  }
}

/** Effect-shaped wrapper so the route can annotate failures on the wide event. */
export function notifyCredentialChangedEffect(
  exchange: AuthExchange,
  response: Response,
  send: CredentialChangeSender,
  context?: AuthAuditContext
): Effect.Effect<void> {
  return Effect.promise(() =>
    notifyCredentialChanged(exchange, response, send, context)
  )
}
