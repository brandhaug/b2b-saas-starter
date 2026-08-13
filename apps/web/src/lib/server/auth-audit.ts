import { Effect, Result, Schema, type Scope } from 'effect'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities'
import { annotateWide } from '@b2b-saas-starter/logger'
import { runCapabilities } from '@/lib/capabilities'

/**
 * Whether an auth catchall exchange is audit-worthy at all. Only credential
 * sign-in attempts are recorded today. Cheap by design: `recordAuthAudit`
 * runs it before touching the response body.
 */
export function isAuditedAuthExchange(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/email')
}

/**
 * Pure mapping from an auth catchall exchange to the audit event it should
 * record, or `null` when the exchange is not audit-worthy: success attributes
 * the actor, failure records the attempt as a system event (workspaceId null
 * on both — sessions are not workspace-scoped).
 */
export function signInAuditInput(exchange: {
  readonly method: string
  readonly pathname: string
  readonly status: number
  readonly userId: string | null
}): RecordAuditEventInput | null {
  if (!isAuditedAuthExchange(exchange)) {
    return null
  }
  const success = exchange.status >= 200 && exchange.status < 300
  return {
    workspaceId: null,
    actorUserId: success ? exchange.userId : null,
    eventType: success ? 'auth.sign_in' : 'auth.sign_in_failed',
    targetType: 'session',
    metadata: { method: 'email', statusCode: exchange.status }
  }
}

export type AuthAuditOutcome = 'skipped' | 'recorded' | 'dropped'

/** A 2xx auth response whose body did not parse as JSON. */
export class AuthAuditBodyUnreadable extends Schema.TaggedError<AuthAuditBodyUnreadable>()(
  'AuthAuditBodyUnreadable',
  { reason: Schema.String }
) {}

/** The audit write itself failed (D1 hiccup, layer unavailable). */
export class AuthAuditWriteFailed extends Schema.TaggedError<AuthAuditWriteFailed>()(
  'AuthAuditWriteFailed',
  { reason: Schema.String }
) {}

function failureReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The only part of Better Auth's sign-in response this audit path reads. The
 * response body is an untrusted boundary value, so it is decoded rather than
 * asserted; a body that does not match becomes `AuthAuditBodyUnreadable`.
 */
const SignInResponseBody = Schema.Struct({
  user: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.String) }))
})

const decodeSignInResponseBody = Schema.decodeUnknownSync(SignInResponseBody)

/** Reads the signed-in actor out of a successful sign-in response body. */
function readActorUserId(
  response: Response
): Effect.Effect<string | null, AuthAuditBodyUnreadable> {
  return Effect.tryPromise({
    try: async () => {
      const body = decodeSignInResponseBody(await response.clone().json())
      return body.user?.id ?? null
    },
    catch: (cause) => new AuthAuditBodyUnreadable({ reason: failureReason(cause) })
  })
}

function writeAuditEvent(
  input: RecordAuditEventInput
): Effect.Effect<void, AuthAuditWriteFailed> {
  return Effect.tryPromise({
    try: () =>
      runCapabilities(
        Effect.gen(function* () {
          const audit = yield* AuditEventLog
          yield* audit.record(input)
        })
      ),
    catch: (cause) => new AuthAuditWriteFailed({ reason: failureReason(cause) })
  })
}

/**
 * Best-effort audit recording for the auth catchall: it never fails, so a D1
 * hiccup can't fail a sign-in that Better Auth already accepted. Under the
 * Seed layer (no DB binding) `record` is a no-op by design.
 *
 * "Best effort" applies to the auth response, not to the failure itself — an
 * audit path must never drop a failure silently. Both failure modes are
 * captured as tagged errors and annotated onto the caller's wide event
 * (`authAuditError` / `authAuditBodyError`) before the outcome is returned, so
 * a dropped write is always queryable.
 */
export function recordAuthAudit(
  request: Request,
  response: Response
): Effect.Effect<AuthAuditOutcome, never, Scope.Scope> {
  return Effect.gen(function* () {
    const method = request.method
    const pathname = new URL(request.url).pathname
    if (!isAuditedAuthExchange({ method, pathname })) return 'skipped'

    let userId: string | null = null
    if (response.ok) {
      const actor = yield* Effect.result(readActorUserId(response))
      if (Result.isFailure(actor)) {
        // A 2xx sign-in with a non-JSON body is unexpected. The event is still
        // recorded, unattributed, and the reason lands on the wide event.
        yield* annotateWide({
          authAuditBodyError: actor.failure.reason,
          authAuditBodyErrorTag: actor.failure._tag
        })
      } else {
        userId = actor.success
      }
    }

    const input = signInAuditInput({
      method,
      pathname,
      status: response.status,
      userId
    })
    if (!input) return 'skipped'

    const written = yield* Effect.result(writeAuditEvent(input))
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
