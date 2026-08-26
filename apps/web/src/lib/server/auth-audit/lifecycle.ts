import { type RecordAuditEventInput } from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { type AuditEventType } from '@b2b-saas-starter/capabilities/src/governance/audit-event-taxonomy.ts'
import { Effect, type Scope } from 'effect'
import { runCapabilities } from '@/lib/capabilities'
import { isAdminAuthExchange, recordAdminAudit } from './admin'
import {
  readAndReportBody,
  readActorUserId,
  writeAndReport,
  type AuthAuditContext,
  type AuthAuditOutcome,
  type RunAuditCapabilities
} from './shared'

/**
 * The lifecycle exchanges the auth catchall audits, as a path→event table: one
 * row per endpoint, naming its success/failure event pair (or a single event,
 * where the endpoint's contract is to answer identically either way). Better
 * Auth owns these endpoints; this table is the whole decision of which ones
 * are governance-sensitive enough to record (ADR 0025's boundary, applied to
 * the account lifecycle rather than just credential sign-in). Both this table
 * and the admin table in `./admin` are plain data, so adding a producer is a
 * row here, not a new predicate.
 *
 * All of these are system-level: no workspace scope. A row whose response body
 * names the acting user (`namesUserInResponse`) gets its actor from there; a
 * row with `actorFromSession` — sign-out and the session revocations, whose
 * responses name nobody — needs the actor read from the session BEFORE the
 * handler runs (`needsPreHandlerActor` / `AuthAuditContext`).
 */
type LifecycleExchangeRow = {
  readonly method: 'POST' | 'GET'
  readonly suffix: string
  readonly success: AuditEventType
  /** `null` = one event regardless of outcome (the non-disclosing reset request). */
  readonly failure: AuditEventType | null
  readonly targetType: 'session' | 'user'
  /** Whether the 2xx response carries the acting user as `{ user: { id } }`. */
  readonly namesUserInResponse?: boolean
  /** Whether the actor must come from the pre-handler session read. */
  readonly actorFromSession?: boolean
  /** Set on the two sign-in rows, so the event says how the credential was presented. */
  readonly signInMethod?: string
}

const LIFECYCLE_EXCHANGE_EVENTS: ReadonlyArray<LifecycleExchangeRow> = [
  {
    method: 'POST',
    suffix: '/sign-in/email',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    targetType: 'session',
    namesUserInResponse: true,
    signInMethod: 'email'
  },
  {
    method: 'POST',
    suffix: '/sign-in/username',
    success: 'auth.sign_in',
    failure: 'auth.sign_in_failed',
    targetType: 'session',
    namesUserInResponse: true,
    signInMethod: 'username'
  },
  {
    method: 'POST',
    suffix: '/sign-up/email',
    success: 'auth.sign_up',
    failure: 'auth.sign_up_failed',
    targetType: 'user',
    namesUserInResponse: true
  },
  {
    method: 'POST',
    suffix: '/request-password-reset',
    // One event per request, success or not: the endpoint's contract is to
    // answer identically whether the email exists, and the event matches it.
    success: 'auth.password_reset_requested',
    failure: null,
    targetType: 'user'
  },
  {
    method: 'POST',
    suffix: '/reset-password',
    success: 'auth.password_reset',
    failure: 'auth.password_reset_failed',
    targetType: 'user'
  },
  {
    method: 'GET',
    suffix: '/verify-email',
    success: 'auth.email_verified',
    failure: 'auth.email_verification_failed',
    targetType: 'user',
    // Only the no-callback branch of the success answers with a JSON body.
    namesUserInResponse: true
  },
  {
    method: 'POST',
    suffix: '/sign-out',
    success: 'auth.sign_out',
    failure: 'auth.sign_out_failed',
    targetType: 'session',
    actorFromSession: true
  },
  {
    method: 'POST',
    suffix: '/user/revoke-session',
    success: 'auth.session_revoked',
    failure: 'auth.session_revocation_failed',
    targetType: 'session',
    actorFromSession: true
  },
  {
    method: 'POST',
    suffix: '/user/revoke-sessions',
    success: 'auth.session_revoked',
    failure: 'auth.session_revocation_failed',
    targetType: 'session',
    actorFromSession: true
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
    targetType: 'user',
    actorFromSession: true
  },
  {
    method: 'POST',
    suffix: '/two-factor/disable',
    success: 'auth.two_factor_disabled',
    failure: 'auth.two_factor_disable_failed',
    targetType: 'user',
    actorFromSession: true
  },
  {
    method: 'POST',
    suffix: '/two-factor/verify-totp',
    success: 'auth.two_factor_verified',
    failure: 'auth.two_factor_verification_failed',
    targetType: 'session',
    namesUserInResponse: true
  }
]

/**
 * Whether an auth catchall exchange is audit-worthy at all. Cheap by design:
 * `recordAuthAudit` runs it before touching the response body.
 */
export function isAuditedAuthExchange(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return lifecycleExchangeRow(exchange) !== null
}

export function lifecycleExchangeRow(exchange: {
  readonly method: string
  readonly pathname: string
}): LifecycleExchangeRow | null {
  return (
    LIFECYCLE_EXCHANGE_EVENTS.find(
      (row) => exchange.method === row.method && exchange.pathname.endsWith(row.suffix)
    ) ?? null
  )
}

/**
 * Whether the caller must read the actor off the request session BEFORE the
 * handler runs: the audited admin mutations (their responses never name their
 * actor) and the session-ending rows above (whose responses name nobody). The
 * route gathers an `AuthAuditContext` for exactly these exchanges.
 */
export function needsPreHandlerActor(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return (
    isAdminAuthExchange(exchange) ||
    lifecycleExchangeRow(exchange)?.actorFromSession === true
  )
}

/**
 * Pure mapping from an auth catchall exchange to the audit event it should
 * record, or `null` when the exchange is not audit-worthy. Success attributes
 * the actor where the response body names one; failure records the attempt as
 * a system event — except the session-ending rows, whose actor was read from
 * the session before the handler ran and therefore survives a failure (same
 * reasoning as the admin events). `workspaceId` is null on both — sessions
 * are not workspace-scoped.
 *
 * The password-reset request records exactly one event whether or not the
 * email exists: the response is deliberately identical either way, and so is
 * the event. The reset itself and email verification get the success/failure
 * pair every other mutation gets. For email verification the "success" is a
 * 302 redirect without an `error` query param (the token-exchange hop appends
 * one on failure), so the Location header carries the outcome there — the
 * body only names a user on the branch without a callback URL.
 */
export function authAuditInput(exchange: {
  readonly method: string
  readonly pathname: string
  readonly status: number
  readonly userId: string | null
  readonly locationHeader?: string | null
}): RecordAuditEventInput | null {
  const row = lifecycleExchangeRow(exchange)
  if (row === null) return null

  const success =
    (exchange.status >= 200 && exchange.status < 300) ||
    // The verify-email hop answers successful verification with a redirect to
    // the callback URL, and failed verification with a redirect carrying an
    // `error` param — the param is the discriminator.
    (row.suffix === '/verify-email' &&
      exchange.status >= 300 &&
      exchange.status < 400 &&
      !locationCarriesError(exchange.locationHeader ?? null))

  const eventType = success || row.failure === null ? row.success : row.failure

  // A session read before the handler predates Better Auth's judgment, so it
  // keeps the actor on a failure too; an actor scraped from a response body
  // is only trustworthy on success.
  const attributed = row.actorFromSession
    ? exchange.userId !== null
    : success && exchange.userId !== null
  return {
    workspaceId: null,
    actorUserId: attributed ? exchange.userId : null,
    eventType,
    // Sign-in's target is the session it opens (the established shape); the
    // lifecycle events target the account they change.
    targetType: row.targetType,
    metadata:
      row.signInMethod === undefined
        ? { statusCode: exchange.status }
        : { method: row.signInMethod, statusCode: exchange.status }
  }
}

/** Whether a redirect Location is Better Auth's failure shape (`?error=`). */
function locationCarriesError(location: string | null): boolean {
  // An unparseable or absent Location is not a success this audit vouches for.
  if (location === null) return true
  return URL.parse(location)?.searchParams.has('error') ?? true
}

/**
 * Best-effort audit recording for the auth catchall: it never fails, so a D1
 * hiccup can't fail an auth exchange that Better Auth already answered. Under
 * the Seed layer (no DB binding) `record` is a no-op by design.
 *
 * Pass an `AuthAuditContext` to also audit the exchanges whose responses
 * never name their actor: the Better Auth admin mutations
 * (`POST /api/auth/admin/*`) and the session-ending rows (sign-out, the user
 * session revocations). Without one those record unattributed.
 *
 * "Best effort" applies to the auth response, not to the failure itself — an
 * audit path must never drop a failure silently. Both failure modes are
 * captured as tagged errors and annotated onto the caller's wide event
 * (`authAuditError` / `authAuditBodyError`) before the outcome is returned, so
 * a dropped write is always queryable.
 */
export function recordAuthAudit(
  request: Request,
  response: Response,
  run: RunAuditCapabilities = runCapabilities,
  context?: AuthAuditContext
): Effect.Effect<AuthAuditOutcome, never, Scope.Scope> {
  return Effect.gen(function* () {
    const method = request.method
    const pathname = new URL(request.url).pathname

    if (context !== undefined && isAdminAuthExchange({ method, pathname })) {
      return yield* recordAdminAudit({ pathname, response, run, admin: context })
    }

    const row = lifecycleExchangeRow({ method, pathname })
    if (row === null) return 'skipped'

    let userId: string | null = null
    if (row.actorFromSession === true) {
      // The response names nobody: the actor comes from the pre-handler
      // session read, or the event records unattributed.
      userId = context?.actorUserId ?? null
    } else if (response.ok && row.namesUserInResponse === true) {
      // A 2xx lifecycle response with a non-JSON body is unexpected. The
      // event is still recorded, unattributed, and the reason lands on the
      // wide event.
      userId = yield* readAndReportBody(readActorUserId(response))
    }

    const input = authAuditInput({
      method,
      pathname,
      status: response.status,
      userId,
      locationHeader: response.headers.get('location')
    })
    if (!input) return 'skipped'

    return yield* writeAndReport(input, run)
  })
}
