import { Effect, Result, Schema, type Scope } from 'effect'
import {
  AuditEventLog,
  type CapabilityUnavailable,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities'
import { annotateWide } from '@b2b-saas-starter/logger'
import { runCapabilities } from '@/lib/capabilities'
import { causeMessage } from '@/lib/cause-message'

/**
 * The lifecycle exchanges the auth catchall audits. Better Auth owns these
 * endpoints; this table is the whole decision of which ones are
 * governance-sensitive enough to record (ADR 0025's boundary, applied to the
 * account lifecycle rather than just credential sign-in).
 */
export type AuthExchangeKind =
  | 'sign_in'
  | 'sign_up'
  | 'password_reset_requested'
  | 'password_reset'
  | 'email_verified'

/**
 * Whether an auth catchall exchange is audit-worthy at all. Cheap by design:
 * `recordAuthAudit` runs it before touching the response body.
 */
export function isAuditedAuthExchange(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return authExchangeKind(exchange) !== null
}

function authExchangeKind(exchange: {
  readonly method: string
  readonly pathname: string
}): AuthExchangeKind | null {
  const { method, pathname } = exchange
  if (method === 'POST') {
    if (pathname.endsWith('/sign-in/email')) return 'sign_in'
    if (pathname.endsWith('/sign-up/email')) return 'sign_up'
    if (pathname.endsWith('/request-password-reset')) return 'password_reset_requested'
    if (pathname.endsWith('/reset-password')) return 'password_reset'
    return null
  }
  if (method === 'GET' && pathname.endsWith('/verify-email')) return 'email_verified'
  return null
}

/**
 * The audit event kinds whose 2xx response body carries the acting user as
 * `{ user: { id } }`: credential sign-in, sign-up, and the no-callback branch
 * of email verification. The reset endpoints answer with constant,
 * non-attributing bodies, so they never get a body read.
 */
function carriesUserIdInBody(kind: AuthExchangeKind): boolean {
  return kind === 'sign_in' || kind === 'sign_up' || kind === 'email_verified'
}

/**
 * Pure mapping from an auth catchall exchange to the audit event it should
 * record, or `null` when the exchange is not audit-worthy. Success attributes
 * the actor where the response body names one; failure records the attempt as
 * a system event (workspaceId null on both — sessions are not
 * workspace-scoped).
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
  const kind = authExchangeKind(exchange)
  if (kind === null) return null

  const success =
    (exchange.status >= 200 && exchange.status < 300) ||
    // The verify-email hop answers successful verification with a redirect to
    // the callback URL, and failed verification with a redirect carrying an
    // `error` param — the param is the discriminator.
    (kind === 'email_verified' &&
      exchange.status >= 300 &&
      exchange.status < 400 &&
      !locationCarriesError(exchange.locationHeader ?? null))

  const eventType = authExchangeEventType(kind, success)
  if (eventType === null) return null

  const attributed = success && exchange.userId !== null
  return {
    workspaceId: null,
    actorUserId: attributed ? exchange.userId : null,
    eventType,
    // Sign-in's target is the session it opens (the established shape); the
    // lifecycle events target the account they change.
    targetType: kind === 'sign_in' ? 'session' : 'user',
    metadata: { method: 'email', statusCode: exchange.status }
  }
}

/** Whether a redirect Location is Better Auth's failure shape (`?error=`). */
function locationCarriesError(location: string | null): boolean {
  // An unparseable or absent Location is not a success this audit vouches for.
  if (location === null) return true
  return URL.parse(location)?.searchParams.has('error') ?? true
}

function authExchangeEventType(
  kind: AuthExchangeKind,
  success: boolean
): string | null {
  switch (kind) {
    case 'sign_in': {
      return success ? 'auth.sign_in' : 'auth.sign_in_failed'
    }
    case 'sign_up': {
      return success ? 'auth.sign_up' : 'auth.sign_up_failed'
    }
    case 'password_reset_requested': {
      // One event per request, success or not: the endpoint's contract is to
      // answer identically whether the email exists, and the audit event
      // matches that contract.
      return 'auth.password_reset_requested'
    }
    case 'password_reset': {
      return success ? 'auth.password_reset' : 'auth.password_reset_failed'
    }
    case 'email_verified': {
      return success ? 'auth.email_verified' : 'auth.email_verification_failed'
    }
  }
}

export type AuthAuditOutcome = 'skipped' | 'recorded' | 'dropped'

/** A 2xx auth response whose body did not parse as JSON. */
export class AuthAuditBodyUnreadable extends Schema.TaggedErrorClass<AuthAuditBodyUnreadable>()(
  'AuthAuditBodyUnreadable',
  { reason: Schema.String }
) {}

/** The audit write itself failed (D1 hiccup, layer unavailable). */
export class AuthAuditWriteFailed extends Schema.TaggedErrorClass<AuthAuditWriteFailed>()(
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
 * Best-effort audit recording for the auth catchall: it never fails, so a D1
 * hiccup can't fail an auth exchange that Better Auth already answered. Under
 * the Seed layer (no DB binding) `record` is a no-op by design.
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
  run: RunAuditCapabilities = runCapabilities
): Effect.Effect<AuthAuditOutcome, never, Scope.Scope> {
  return Effect.gen(function* () {
    const method = request.method
    const pathname = new URL(request.url).pathname
    const kind = authExchangeKind({ method, pathname })
    if (kind === null) return 'skipped'

    let userId: string | null = null
    if (response.ok && carriesUserIdInBody(kind)) {
      const actor = yield* Effect.result(readActorUserId(response))
      if (Result.isFailure(actor)) {
        // A 2xx lifecycle response with a non-JSON body is unexpected. The
        // event is still recorded, unattributed, and the reason lands on the
        // wide event.
        yield* annotateWide({
          authAuditBodyError: actor.failure.reason,
          authAuditBodyErrorTag: actor.failure._tag
        })
      } else {
        userId = actor.success
      }
    }

    const input = authAuditInput({
      method,
      pathname,
      status: response.status,
      userId,
      locationHeader: response.headers.get('location')
    })
    if (!input) return 'skipped'

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
