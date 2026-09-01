import { type RecordAuditEventInput } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { Effect, type Scope } from 'effect'
import { runCapabilities } from '@/lib/capabilities'
import { exchangeRow, type AuthExchange, type ExchangeRow } from './exchanges'
import {
  readAndReportBody,
  readRequestUserId,
  readResponseUserId,
  writeAndReport,
  type AuthAuditContext,
  type AuthAuditOutcome,
  type RunAuditCapabilities
} from './shared'

/**
 * Pure mapping from an auth catchall exchange to the audit event it should
 * record, or `null` when the exchange is not audit-worthy. Every decision
 * comes off the row: which event pair, what the event targets, and whether the
 * actor survives a failure. `workspaceId` is null throughout — none of these
 * exchanges are workspace-scoped.
 *
 * A row with `actor: 'session'` was attributed before Better Auth judged the
 * request, so it keeps its actor on a failure; an actor scraped from a
 * response body is only trustworthy on success.
 *
 * The password-reset request records exactly one event whether or not the
 * email exists: the response is deliberately identical either way, and so is
 * the event.
 */
export function authAuditInput(
  exchange: AuthExchange & {
    readonly status: number
    readonly actorUserId: string | null
    /** The acted-on user, for the rows that name one. */
    readonly targetUserId?: string | null
    readonly locationHeader?: string | null
  }
): RecordAuditEventInput | null {
  const row = exchangeRow(exchange)
  if (row === null) {
    return null
  }

  const success = isSuccess(row, exchange.status, exchange.locationHeader ?? null)
  const eventType = success || row.failure === null ? row.success : row.failure
  const actorUserId =
    row.actor === 'none' || (row.actor === 'response' && !success)
      ? null
      : exchange.actorUserId

  const input: RecordAuditEventInput = {
    workspaceId: null,
    actorUserId,
    eventType,
    // Sign-in's target is the session it opens (the established shape); the
    // lifecycle and admin events target the account they change.
    targetType: row.target,
    metadata:
      row.signInMethod === undefined
        ? { statusCode: exchange.status }
        : { method: row.signInMethod, statusCode: exchange.status }
  }
  // Only the rows that name a target carry the column at all; the rest would
  // otherwise record a null target id they never looked for.
  if (row.targetFrom === undefined) {
    return input
  }
  return { ...input, targetId: exchange.targetUserId ?? null }
}

/**
 * Whether the exchange succeeded. Normally a 2xx; for a row that answers
 * success with a redirect (email verification), the `Location` header carries
 * the outcome instead — Better Auth appends an `error` param on failure.
 */
function isSuccess(row: ExchangeRow, status: number, location: string | null): boolean {
  if (status >= 200 && status < 300) {
    return true
  }
  return (
    row.successFromRedirect === true &&
    status >= 300 &&
    status < 400 &&
    !locationCarriesError(location)
  )
}

/** Whether a redirect Location is Better Auth's failure shape (`?error=`). */
function locationCarriesError(location: string | null): boolean {
  // An unparseable or absent Location is not a success this audit vouches for.
  if (location === null) {
    return true
  }
  return URL.parse(location)?.searchParams.has('error') ?? true
}

/**
 * Best-effort audit recording for the auth catchall: it never fails, so a D1
 * hiccup can't fail an auth exchange that Better Auth already answered. Under
 * the Seed layer (no DB binding) `record` is a no-op by design.
 *
 * Pass an `AuthAuditContext` for the exchanges whose responses never name
 * their actor: the Better Auth admin mutations (`POST /api/auth/admin/*`), the
 * session-ending rows (sign-out, the user session revocations) and the
 * two-factor enable/disable pair. Without one the admin rows record nothing —
 * a `system_admin.` event that cannot name its admin is worse than no event —
 * while the rest record unattributed.
 *
 * "Best effort" applies to the auth response, not to the failure itself — an
 * audit path must never drop a failure silently. Both failure modes are
 * captured as tagged errors and annotated onto the caller's wide event
 * (`authAuditError` / `authAuditBodyError`) before the outcome is returned, so
 * a dropped write is always queryable.
 */
export function recordAuthAudit(
  exchange: AuthExchange,
  response: Response,
  run: RunAuditCapabilities = runCapabilities,
  context?: AuthAuditContext
): Effect.Effect<AuthAuditOutcome, never, Scope.Scope> {
  return Effect.gen(function* () {
    const row = exchangeRow(exchange)
    if (row === null) {
      return 'skipped'
    }
    if (row.requiresActorContext === true && context === undefined) {
      return 'skipped'
    }

    // A body that does not parse still records an event — just an
    // unattributed or untargeted one — with the reason on the wide event.
    let actorUserId: string | null = null
    if (row.actor === 'session') {
      actorUserId = context?.actorUserId ?? null
    } else if (row.actor === 'response' && response.ok) {
      actorUserId = yield* readAndReportBody(readResponseUserId(response))
    }

    let targetUserId: string | null = null
    for (const source of row.targetFrom ?? []) {
      if (targetUserId !== null) {
        break
      }
      if (source === 'request' && context?.request !== undefined) {
        targetUserId = yield* readAndReportBody(readRequestUserId(context.request))
      } else if (source === 'response' && response.ok) {
        targetUserId = yield* readAndReportBody(readResponseUserId(response))
      }
    }

    const input = authAuditInput({
      ...exchange,
      status: response.status,
      actorUserId,
      targetUserId,
      locationHeader: response.headers.get('location')
    })
    if (!input) {
      return 'skipped'
    }

    return yield* writeAndReport(input, run)
  })
}
