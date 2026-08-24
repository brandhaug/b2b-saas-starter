import { annotateWide } from '@b2b-saas-starter/logger'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { type AuditEventType } from '@b2b-saas-starter/capabilities/src/governance/audit-event-taxonomy.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { Effect, Result, Schema, type Scope } from 'effect'
import { runCapabilities } from '@/lib/capabilities'
import { causeMessage } from '@/lib/cause-message'

/**
 * The lifecycle exchanges the auth catchall audits, as a path→event table: one
 * row per endpoint, naming its success/failure event pair (or a single event,
 * where the endpoint's contract is to answer identically either way). Better
 * Auth owns these endpoints; this table is the whole decision of which ones
 * are governance-sensitive enough to record (ADR 0025's boundary, applied to
 * the account lifecycle rather than just credential sign-in). Both this table
 * and `ADMIN_EXCHANGE_EVENTS` below are plain data, so adding a producer is a
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

function lifecycleExchangeRow(exchange: {
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
 * The Better Auth admin endpoints the auth catchall audits, as a path→event
 * table: one row per mutation endpoint, naming its success/failure event pair
 * from the `system_admin.` taxonomy namespace. This is the shared mapper — the
 * account-lifecycle table above and this one are both plain data, so adding a
 * producer (the remaining auth surface) is a row here, not a new predicate.
 *
 * All of these are system-level: no workspace scope, target is the user the
 * endpoint acts on (`targetId` parsed from the request body or response).
 */
const ADMIN_EXCHANGE_EVENTS: ReadonlyArray<{
  readonly suffix: string
  readonly success: AuditEventType
  readonly failure: AuditEventType
  /** Whether the endpoint's 2xx response carries the acted-on user as `{ user: { id } }` (create-user's body has no id to parse). */
  readonly namesUserInResponse?: boolean
}> = [
  {
    suffix: '/admin/create-user',
    success: 'system_admin.user_created',
    failure: 'system_admin.user_creation_failed',
    namesUserInResponse: true
  },
  {
    suffix: '/admin/remove-user',
    success: 'system_admin.user_removed',
    failure: 'system_admin.user_removal_failed'
  },
  {
    suffix: '/admin/set-role',
    success: 'system_admin.user_role_changed',
    failure: 'system_admin.user_role_change_failed'
  },
  {
    suffix: '/admin/ban-user',
    success: 'system_admin.user_banned',
    failure: 'system_admin.user_ban_failed'
  },
  {
    suffix: '/admin/unban-user',
    success: 'system_admin.user_unbanned',
    failure: 'system_admin.user_unban_failed'
  },
  {
    suffix: '/admin/set-user-password',
    success: 'system_admin.user_password_set',
    failure: 'system_admin.user_password_set_failed'
  },
  {
    suffix: '/admin/impersonate-user',
    success: 'system_admin.impersonation_started',
    failure: 'system_admin.impersonation_start_failed'
  },
  // Stop-impersonating resolves the impersonated user from the session server
  // side; its request names nobody, so the event targets an unknown user.
  {
    suffix: '/admin/stop-impersonating',
    success: 'system_admin.impersonation_stopped',
    failure: 'system_admin.impersonation_stop_failed'
  },
  {
    suffix: '/admin/revoke-user-session',
    success: 'system_admin.user_session_revoked',
    failure: 'system_admin.user_session_revocation_failed'
  },
  {
    suffix: '/admin/revoke-user-sessions',
    success: 'system_admin.user_session_revoked',
    failure: 'system_admin.user_session_revocation_failed'
  }
]

/** Whether an auth catchall exchange is one of the audited admin mutations. */
export function isAdminAuthExchange(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return (
    exchange.method === 'POST' &&
    ADMIN_EXCHANGE_EVENTS.some((row) => exchange.pathname.endsWith(row.suffix))
  )
}

function adminExchangeRow(pathname: string) {
  return ADMIN_EXCHANGE_EVENTS.find((row) => pathname.endsWith(row.suffix)) ?? null
}

/**
 * The request-body fields of admin endpoints this audit path reads.
 */
const AdminRequestBody = Schema.Struct({
  userId: Schema.optionalKey(Schema.String)
})

const decodeAdminRequestBody = Schema.decodeUnknownSync(AdminRequestBody)

/**
 * Reads the acted-on user id off an admin request body. Mirrors
 * `readActorUserId`: the body is an untrusted boundary value, decoded rather
 * than asserted.
 */
function readTargetUserId(request: {
  readonly json: <T>() => Promise<T>
}): Effect.Effect<string | null, AuthAuditBodyUnreadable> {
  return Effect.tryPromise({
    try: async () => {
      const body = decodeAdminRequestBody(await request.json())
      return body.userId ?? null
    },
    catch: (cause) =>
      new AuthAuditBodyUnreadable({
        reason: causeMessage(cause, BODY_UNREADABLE_REASON)
      })
  })
}

/**
 * Pure mapping for an audited admin exchange. The actor is always the acting
 * system admin (read from the request session before the handler ran); the
 * target is the user the endpoint acts on. Unlike the account-lifecycle
 * events — where a failed sign-in has no trustworthy actor — the session was
 * already resolved before Better Auth judged the request, so failures keep
 * their actor.
 */
export function adminAuditInput(exchange: {
  readonly pathname: string
  readonly status: number
  readonly actorUserId: string | null
  /** `userId` off the request body, when it carried one. */
  readonly targetUserId: string | null
}): RecordAuditEventInput | null {
  const row = adminExchangeRow(exchange.pathname)
  if (row === null) return null
  const success = exchange.status >= 200 && exchange.status < 300
  return {
    workspaceId: null,
    actorUserId: exchange.actorUserId,
    eventType: success ? row.success : row.failure,
    targetType: 'user',
    targetId: exchange.targetUserId,
    metadata: { statusCode: exchange.status }
  }
}

export type AuthAuditOutcome = 'skipped' | 'recorded' | 'dropped'

/** A 2xx auth response whose body did not parse as JSON. */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AuthAuditBodyUnreadable extends Schema.TaggedError<AuthAuditBodyUnreadable>()(
  'AuthAuditBodyUnreadable',
  { reason: Schema.String }
) {}

/** The audit write itself failed (D1 hiccup, layer unavailable). */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AuthAuditWriteFailed extends Schema.TaggedError<AuthAuditWriteFailed>()(
  'AuthAuditWriteFailed',
  { reason: Schema.String }
) {}

// Reasons for the two tagged errors below when the thrown value carries no
// message of its own. Each names the step that failed, so a reason column with
// one of these strings still says where the audit path gave up.
const BODY_UNREADABLE_REASON = 'sign-in response body could not be read'
const WRITE_FAILED_REASON = 'audit event could not be written'

/**
 * The only part of Better Auth's response bodies this audit path reads. The
 * response body is an untrusted boundary value, so it is decoded rather than
 * asserted; a body that does not match becomes `AuthAuditBodyUnreadable`.
 */
const ResponseBody = Schema.Struct({
  user: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.String) }))
})

const decodeResponseBody = Schema.decodeUnknownSync(ResponseBody)

/** Reads the signed-in actor out of a successful auth response body. */
function readActorUserId(
  response: Response
): Effect.Effect<string | null, AuthAuditBodyUnreadable> {
  return Effect.tryPromise({
    try: async () => {
      const body = decodeResponseBody(await response.clone().json())
      return body.user?.id ?? null
    },
    catch: (cause) =>
      new AuthAuditBodyUnreadable({
        reason: causeMessage(cause, BODY_UNREADABLE_REASON)
      })
  })
}

/**
 * How this module reaches the capability layer, as a port. Injected rather than
 * imported at the call site so a test drives the audit path with a real function
 * of this shape instead of replacing `@/lib/capabilities` — which would also
 * take `runWorkspaceCapabilities` and the error mapping down with it.
 */
export type RunAuditCapabilities = (
  effect: Effect.Effect<void, CapabilityUnavailable, AuditEventLog>
) => Promise<void>

function writeAuditEvent(
  input: RecordAuditEventInput,
  run: RunAuditCapabilities
): Effect.Effect<void, AuthAuditWriteFailed> {
  return Effect.tryPromise({
    try: () =>
      run(
        Effect.gen(function* () {
          const audit = yield* AuditEventLog
          yield* audit.record(input)
        })
      ),
    catch: (cause) =>
      new AuthAuditWriteFailed({ reason: causeMessage(cause, WRITE_FAILED_REASON) })
  })
}

/**
 * Everything the pre-handler-actor audits need that only the caller can
 * supply: the acting user's id, read from the request session BEFORE the
 * handler ran (admin responses never name their actor, sign-out and session
 * revocation name nobody), and — for the admin mutations — a clone of the
 * request, since Better Auth consumes the original body.
 */
export type AuthAuditContext = {
  readonly actorUserId: string
  /** A clone of the request, gathered before the handler consumed the body. Only `json()` is read. */
  readonly request?: { readonly json: <T>() => Promise<T> }
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
/**
 * Reads an untrusted body value, reporting a decode failure on the wide event
 * (`authAuditBodyError`) instead of failing: a body that does not parse still
 * records an event — just an unattributed or untargeted one.
 */
function readAndReportBody<A>(
  reader: Effect.Effect<A, AuthAuditBodyUnreadable>
): Effect.Effect<A | null, never, Scope.Scope> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.result(reader)
    if (Result.isFailure(parsed)) {
      yield* annotateWide({
        authAuditBodyError: parsed.failure.reason,
        authAuditBodyErrorTag: parsed.failure._tag
      })
      return null
    }
    return parsed.success
  })
}

/**
 * Writes one audit event best-effort: a failed write is annotated on the wide
 * event (`authAuditError`) and reported as `dropped` rather than thrown.
 */
function writeAndReport(
  input: RecordAuditEventInput,
  run: RunAuditCapabilities
): Effect.Effect<'recorded' | 'dropped', never, Scope.Scope> {
  return Effect.gen(function* () {
    const written = yield* Effect.result(writeAuditEvent(input, run))
    if (Result.isFailure(written)) {
      yield* annotateWide({
        authAuditError: written.failure.reason,
        authAuditErrorTag: written.failure._tag
      })
      return 'dropped'
    }
    return 'recorded'
  })
}

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

/**
 * The admin half of the catchall audit: same best-effort contract, same
 * tagged-error annotations, but the actor comes from the caller's session
 * read (admin responses never name their actor) and the target from the
 * request body — or, for create-user, from the response it answers with.
 */
function recordAdminAudit(args: {
  readonly pathname: string
  readonly response: Response
  readonly run: RunAuditCapabilities
  readonly admin: AuthAuditContext
}): Effect.Effect<AuthAuditOutcome, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pathname, response, run, admin } = args
    if (adminExchangeRow(pathname) === null) return 'skipped'

    let targetUserId: string | null = null
    if (admin.request !== undefined) {
      // A request body that does not parse still records an event — just an
      // untargeted one — with the reason on the wide event.
      targetUserId = yield* readAndReportBody(readTargetUserId(admin.request))
    }
    if (targetUserId === null && response.ok && rowNamesUserInResponse(pathname)) {
      targetUserId = yield* readAndReportBody(readActorUserId(response))
    }

    const input = adminAuditInput({
      pathname,
      status: response.status,
      actorUserId: admin.actorUserId,
      targetUserId
    })
    if (!input) return 'skipped'

    return yield* writeAndReport(input, run)
  })
}

function rowNamesUserInResponse(pathname: string): boolean {
  return adminExchangeRow(pathname)?.namesUserInResponse === true
}
