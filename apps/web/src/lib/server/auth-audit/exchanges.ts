import { type AuditEventType } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'

/**
 * One row per audited auth-catchall endpoint. Better Auth owns the endpoints;
 * this table is the whole decision of which ones are governance-sensitive
 * enough to record (ADR 0025's boundary, applied to the account lifecycle and
 * the system-admin mutations rather than just credential sign-in). It is plain
 * data, so adding a producer is a row here, not a new predicate.
 *
 * Every row is system-level: no workspace scope.
 */
export type ExchangeRow = {
  readonly method: 'POST' | 'GET'
  /** Matched against the end of the request pathname. */
  readonly suffix: string
  readonly success: AuditEventType
  /** `null` = one event regardless of outcome (the non-disclosing reset request). */
  readonly failure: AuditEventType | null
  /**
   * Where the acting user's id comes from:
   * - `session` — the pre-handler session read (`AuthAuditContext`), because
   *   the response names nobody. It predates Better Auth's judgment, so it
   *   attributes a failure too.
   * - `response` — the 2xx response body's `{ user: { id } }`. Only
   *   trustworthy on success.
   * - `none` — the event is always unattributed.
   */
  readonly actor: 'session' | 'response' | 'none'
  /** What the event is about: the session it opens/ends, or the account it changes. */
  readonly target: 'session' | 'user'
  /**
   * Where the acted-on user's id is read from, tried in this order — the first
   * that yields an id wins. Absent = the event names no target id.
   */
  readonly targetFrom?: ReadonlyArray<'request' | 'response'>
  /**
   * Record nothing at all when no pre-handler context was gathered. Set on the
   * admin mutations: a `system_admin.` event that cannot name the admin who
   * caused it is worse than no event.
   */
  readonly requiresActorContext?: boolean
  /**
   * The endpoint answers success with a redirect rather than a 2xx, so the
   * `Location` header carries the outcome: Better Auth appends an `error`
   * param on failure.
   */
  readonly successFromRedirect?: boolean
  /** Set on the sign-in rows, so the event says how the credential was presented. */
  readonly signInMethod?: string
  /**
   * A success on this row also emails the account holder — a second factor
   * or a sign-in credential must never change silently. The value names the
   * change itself, so the one credential-change notifier
   * (`credential-change-notification.ts`) can word the email without a
   * per-credential decode helper.
   */
  readonly notifyOnSuccess?: CredentialChange
}

/**
 * The credential change a row's success performs, as the security notifier
 * reads it: which credential moved, and the state the success leaves behind.
 * The password kind carries no direction — a password is always replaced,
 * never enabled or removed — and backup codes only rotate: every prior code
 * dies with the request.
 */
export type CredentialChange =
  | { readonly kind: 'two-factor'; readonly enabled: boolean }
  | { readonly kind: 'passkey'; readonly added: boolean }
  | { readonly kind: 'password' }
  | { readonly kind: 'backup-codes' }

export const EXCHANGE_ROWS: ReadonlyArray<ExchangeRow> = [
  // Account lifecycle.
  {
    method: 'POST',
    suffix: '/sign-in/email',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'response',
    target: 'session',
    signInMethod: 'email'
  },
  {
    method: 'POST',
    suffix: '/sign-in/username',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'response',
    target: 'session',
    signInMethod: 'username'
  },
  // Social sign-in completes at the provider callback — the response is a
  // redirect, so the Location header carries the outcome (an `error` param on
  // failure) and the body names nobody. The actor is the pre-handler session
  // read when one exists (the link flow); a fresh social sign-in has no
  // session yet and records unattributed — the account-linking events carry
  // the user attribution for that path instead (see `social-account-audit`).
  {
    method: 'GET',
    suffix: '/callback/github',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'session',
    target: 'session',
    successFromRedirect: true,
    signInMethod: 'github'
  },
  {
    method: 'GET',
    suffix: '/callback/google',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'session',
    target: 'session',
    successFromRedirect: true,
    signInMethod: 'google'
  },
  {
    // The magic-link consume hop: the emailed URL points here, the plugin
    // validates the single-use token, opens the session, and redirects to the
    // app's landing page — so the Location header carries the outcome, same
    // shape as the verification row below. The send endpoint
    // (`POST /sign-in/magic-link`) records nothing: it is non-disclosing by
    // design and answers `{ status: true }` whether or not the address exists.
    method: 'GET',
    suffix: '/magic-link/verify',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'response',
    target: 'session',
    signInMethod: 'magic-link',
    successFromRedirect: true
  },
  {
    method: 'POST',
    suffix: '/sign-up/email',
    success: 'auth.sign_up',
    failure: 'auth.sign_up_failed',
    actor: 'response',
    target: 'user'
  },
  {
    method: 'POST',
    suffix: '/request-password-reset',
    // One event per request, success or not: the endpoint's contract is to
    // answer identically whether the email exists, and the event matches it.
    success: 'auth.password_reset_requested',
    failure: null,
    actor: 'none',
    target: 'user'
  },
  {
    method: 'POST',
    suffix: '/reset-password',
    success: 'auth.password_reset',
    failure: 'auth.password_reset_failed',
    actor: 'none',
    target: 'user'
  },
  {
    method: 'GET',
    suffix: '/verify-email',
    success: 'auth.email_verified',
    failure: 'auth.email_verification_failed',
    // Only the no-callback branch of the success answers with a JSON body.
    actor: 'response',
    target: 'user',
    successFromRedirect: true
  },
  // Email one-time codes (the email-otp plugin). Two of the code endpoints
  // need their own rows; the code-based reset request and reset deliberately
  // reuse the link-flow rows below — `/email-otp/request-password-reset` and
  // `/email-otp/reset-password` end with the link rows' suffixes, and record
  // the same events. The send endpoint records nothing: the sign-in,
  // verification, or reset it enables is the audited outcome.
  {
    method: 'POST',
    suffix: '/sign-in/email-otp',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'response',
    target: 'session',
    signInMethod: 'email-otp'
  },
  {
    method: 'POST',
    suffix: '/email-otp/verify-email',
    success: 'auth.email_verified',
    failure: 'auth.email_verification_failed',
    // The endpoint answers in JSON (never a redirect), so `response` is the
    // only source and `successFromRedirect` stays off.
    actor: 'response',
    target: 'user'
  },
  // Session end. These responses name nobody, so the actor is the pre-handler
  // session read; without one the event still records, unattributed.
  {
    method: 'POST',
    suffix: '/sign-out',
    success: 'auth.sign_out',
    failure: 'auth.sign_out_failed',
    actor: 'session',
    target: 'session'
  },
  {
    method: 'POST',
    suffix: '/user/revoke-session',
    success: 'auth.session_revoked',
    failure: 'auth.session_revocation_failed',
    actor: 'session',
    target: 'session'
  },
  {
    method: 'POST',
    suffix: '/user/revoke-sessions',
    success: 'auth.session_revoked',
    failure: 'auth.session_revocation_failed',
    actor: 'session',
    target: 'session'
  },
  // Signed-in account changes (distinct from the anonymous reset rows above:
  // these demand a live session — and the password change demands the current
  // password too). All three take the pre-handler actor — the endpoint
  // already proved who is calling, and a failed change is exactly the event
  // worth attributing, which a response-scraped actor could never be.
  {
    method: 'POST',
    suffix: '/change-password',
    success: 'auth.password_changed',
    failure: 'auth.password_change_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'password' }
  },
  {
    // The endpoint is disabled today (`user.changeEmail` stays off in
    // `packages/auth`), and the route still exists — it answers the plugin's
    // CHANGE_EMAIL_DISABLED failure — so until the day it is turned on every
    // exchange this row sees is a probe of a sensitive endpoint, audited as
    // the failed change it is. Turning it on later flips exactly the success
    // half: the audit exists before the surface does, instead of an email
    // change shipping unaudited. No notification: the verification email the
    // endpoint itself sends IS the holder-facing notice, and it covers both
    // addresses.
    method: 'POST',
    suffix: '/change-email',
    success: 'auth.email_changed',
    failure: 'auth.email_change_failed',
    actor: 'session',
    target: 'user'
  },
  {
    // Profile changes (name, image): benign, but they are signed-in writes to
    // the account row, so they record without emailing — a name change the
    // holder did not make is a compromised-session clue, not an emergency.
    method: 'POST',
    suffix: '/update-user',
    success: 'auth.user_updated',
    failure: 'auth.user_update_failed',
    actor: 'session',
    target: 'user'
  },
  // Two-factor lifecycle. Enable and disable demand an authenticated session
  // and answer with secrets (totpURI, backup codes), never an actor, so both
  // take the pre-handler actor — a failed enable is exactly the event worth
  // attributing. Verify-totp is the sign-in challenge hop: its response names
  // the user on success, and on failure there may be no session at all yet.
  {
    method: 'POST',
    suffix: '/two-factor/enable',
    success: 'auth.two_factor_enabled',
    failure: 'auth.two_factor_enabled_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'two-factor', enabled: true }
  },
  {
    method: 'POST',
    suffix: '/two-factor/disable',
    success: 'auth.two_factor_disabled',
    failure: 'auth.two_factor_disable_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'two-factor', enabled: false }
  },
  {
    method: 'POST',
    suffix: '/two-factor/verify-totp',
    success: 'auth.two_factor_verified',
    failure: 'auth.two_factor_verification_failed',
    actor: 'response',
    target: 'session'
  },
  {
    // Backup-code rotation. The endpoint REPLACES every stored recovery code —
    // the codes the account holder printed or saved at enrollment die here —
    // so it is a second-factor change like enable/disable, down to the
    // security notification. Demands a session and a password; its response
    // is the new codes (never an actor), so the pre-handler actor applies,
    // and the impersonation guard already refuses it (ADR 0054).
    method: 'POST',
    suffix: '/two-factor/generate-backup-codes',
    success: 'auth.two_factor_backup_codes_rotated',
    failure: 'auth.two_factor_backup_codes_rotation_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'backup-codes' }
  },
  // Passkey lifecycle (ADR 0056). Registration demands a fresh session and
  // its response is the passkey row (never an actor), so both management rows
  // take the pre-handler actor — a failed add or remove is exactly the event
  // worth attributing. Sign-in is a session-opening exchange like the
  // credential ones, and rides the shared `auth.sign_in` pair with its own
  // method marker.
  {
    method: 'POST',
    suffix: '/passkey/verify-registration',
    success: 'auth.passkey_added',
    failure: 'auth.passkey_added_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'passkey', added: true }
  },
  {
    method: 'POST',
    suffix: '/passkey/delete-passkey',
    success: 'auth.passkey_removed',
    failure: 'auth.passkey_removed_failed',
    actor: 'session',
    target: 'user',
    notifyOnSuccess: { kind: 'passkey', added: false }
  },
  {
    method: 'POST',
    suffix: '/passkey/verify-authentication',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    actor: 'response',
    target: 'session',
    signInMethod: 'passkey'
  },
  // Better Auth admin mutations, from the `system_admin.` taxonomy namespace.
  // The response never names the acting admin, so the actor is always the
  // pre-handler session read and the target is parsed off the request body.
  {
    method: 'POST',
    suffix: '/admin/create-user',
    success: 'system_admin.user_created',
    failure: 'system_admin.user_creation_failed',
    actor: 'session',
    target: 'user',
    // Create-user's request has no id to parse — the response answers with one.
    targetFrom: ['request', 'response'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/remove-user',
    success: 'system_admin.user_removed',
    failure: 'system_admin.user_removal_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/set-role',
    success: 'system_admin.user_role_changed',
    failure: 'system_admin.user_role_change_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/ban-user',
    success: 'system_admin.user_banned',
    failure: 'system_admin.user_ban_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/unban-user',
    success: 'system_admin.user_unbanned',
    failure: 'system_admin.user_unban_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/set-user-password',
    success: 'system_admin.user_password_set',
    failure: 'system_admin.user_password_set_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/impersonate-user',
    success: 'system_admin.impersonation_started',
    failure: 'system_admin.impersonation_start_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  // Stop-impersonating resolves the impersonated user from the session server
  // side; its request names nobody, so the event targets an unknown user.
  {
    method: 'POST',
    suffix: '/admin/stop-impersonating',
    success: 'system_admin.impersonation_stopped',
    failure: 'system_admin.impersonation_stop_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/revoke-user-session',
    success: 'system_admin.user_session_revoked',
    failure: 'system_admin.user_session_revocation_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  },
  {
    method: 'POST',
    suffix: '/admin/revoke-user-sessions',
    success: 'system_admin.user_session_revoked',
    failure: 'system_admin.user_session_revocation_failed',
    actor: 'session',
    target: 'user',
    targetFrom: ['request'],
    requiresActorContext: true
  }
]

/** Method and pathname — everything the table matches on. */
export type AuthExchange = {
  readonly method: string
  readonly pathname: string
}

/**
 * The row for an auth catchall exchange, or `null` when it is not audit-worthy.
 * Cheap by design: `recordAuthAudit` runs it before touching any body.
 */
export function exchangeRow(exchange: AuthExchange): ExchangeRow | null {
  return (
    EXCHANGE_ROWS.find(
      (row) => exchange.method === row.method && exchange.pathname.endsWith(row.suffix)
    ) ?? null
  )
}

/**
 * Whether the caller must read the actor off the request session BEFORE the
 * handler runs: every row whose actor is the session — the admin mutations
 * (their responses never name their actor) and the session-ending rows (whose
 * responses name nobody). The route gathers an `AuthAuditContext` for exactly
 * these exchanges.
 */
export function needsPreHandlerActor(exchange: AuthExchange): boolean {
  return exchangeRow(exchange)?.actor === 'session'
}
