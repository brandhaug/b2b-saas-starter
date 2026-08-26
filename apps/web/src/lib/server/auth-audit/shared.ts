import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { Effect, Result, Schema, type Scope } from 'effect'
import { causeMessage } from '@/lib/cause-message'

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
export function readActorUserId(
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
 * Reads an untrusted body value, reporting a decode failure on the wide event
 * (`authAuditBodyError`) instead of failing: a body that does not parse still
 * records an event — just an unattributed or untargeted one.
 */
export function readAndReportBody<A>(
  reader: Effect.Effect<A, AuthAuditBodyUnreadable>
): Effect.Effect<A | null, never, Scope.Scope> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.result(reader)
    if (Result.isFailure(parsed)) {
      yield* Effect.annotateLogsScoped({
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
export function writeAndReport(
  input: RecordAuditEventInput,
  run: RunAuditCapabilities
): Effect.Effect<'recorded' | 'dropped', never, Scope.Scope> {
  return Effect.gen(function* () {
    const written = yield* Effect.result(writeAuditEvent(input, run))
    if (Result.isFailure(written)) {
      yield* Effect.annotateLogsScoped({
        authAuditError: written.failure.reason,
        authAuditErrorTag: written.failure._tag
      })
      return 'dropped'
    }
    return 'recorded'
  })
}
