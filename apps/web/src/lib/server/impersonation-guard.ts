import {
  type ImpersonationAwareSession,
  type ImpersonationForbiddenAction,
  refuseWhileImpersonating
} from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { Effect, Result } from 'effect'
import { type AuthExchange } from './auth-audit/exchanges'
import { authRefusal } from './auth-refusal'

/**
 * Which Better Auth endpoints perform each account action an impersonation
 * session may not (ADR 0054). The vocabulary is the capability's
 * (`IMPERSONATION_FORBIDDEN_ACTIONS`); this table is the app's mapping of the
 * plugin's paths onto it, in the same shape as the audit `EXCHANGE_ROWS` —
 * plain data, matched on the end of the pathname, so a new endpoint is a row.
 * All are POSTs.
 */
const FORBIDDEN_PATHS: ReadonlyArray<{
  readonly suffix: string
  readonly action: ImpersonationForbiddenAction
}> = [
  { suffix: '/change-password', action: 'change_password' },
  { suffix: '/two-factor/enable', action: 'change_two_factor' },
  { suffix: '/two-factor/disable', action: 'change_two_factor' },
  { suffix: '/two-factor/generate-backup-codes', action: 'change_two_factor' },
  // A passkey enrolled under impersonation would keep working after the
  // impersonation ends (ADR 0056) — the same persistence concern as a
  // password change (ADR 0054).
  { suffix: '/passkey/verify-registration', action: 'change_passkey' },
  { suffix: '/passkey/delete-passkey', action: 'change_passkey' },
  { suffix: '/change-email', action: 'change_email' }
  // No `/delete-user` row: account deletion is a capability-route refusal for
  // every session, impersonated or not, so this guard never sees one.
]

/** The forbidden action an exchange performs, or `null` when it is allowed regardless. */
export function impersonationForbiddenAction(
  exchange: AuthExchange
): ImpersonationForbiddenAction | null {
  if (exchange.method !== 'POST') {
    return null
  }
  return (
    FORBIDDEN_PATHS.find((row) => exchange.pathname.endsWith(row.suffix))?.action ??
    null
  )
}

/**
 * The 403 the auth catchall answers with instead of running Better Auth, or
 * `null` to let the request through. The decision is the capability's
 * `refuseWhileImpersonating`; this only shapes it as a response. An anonymous
 * request (`session` undefined) is not an impersonation and passes — Better
 * Auth answers its own 401.
 */
export function impersonationGuardResponse(
  session: ImpersonationAwareSession | undefined,
  action: ImpersonationForbiddenAction | null
): Effect.Effect<Response | null> {
  if (action === null || session === undefined) {
    return Effect.succeed(null)
  }
  return Effect.result(refuseWhileImpersonating(session, action)).pipe(
    Effect.map((verdict) => {
      if (Result.isSuccess(verdict)) {
        return null
      }
      return authRefusal(403, 'forbidden_while_impersonating', {
        action: verdict.failure.action
      })
    })
  )
}
