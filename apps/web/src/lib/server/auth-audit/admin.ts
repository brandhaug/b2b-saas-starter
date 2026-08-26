import { type RecordAuditEventInput } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type AuditEventType } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'
import { Effect, Schema, type Scope } from 'effect'
import { causeMessage } from '@/lib/cause-message'
import {
  readActorUserId,
  readAndReportBody,
  writeAndReport,
  AuthAuditBodyUnreadable,
  type AuthAuditContext,
  type AuthAuditOutcome,
  type RunAuditCapabilities
} from './shared'

/**
 * The Better Auth admin endpoints the auth catchall audits, as a path→event
 * table: one row per mutation endpoint, naming its success/failure event pair
 * from the `system_admin.` taxonomy namespace. This is the shared mapper —
 * this table and the account-lifecycle one in `./lifecycle` are both plain
 * data, so adding a producer (the remaining auth surface) is a row here, not a
 * new predicate.
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

// Kept beside `readTargetUserId` so both body readers share the same reason.
const BODY_UNREADABLE_REASON = 'sign-in response body could not be read'

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

/**
 * The admin half of the catchall audit: same best-effort contract, same
 * tagged-error annotations, but the actor comes from the caller's session
 * read (admin responses never name their actor) and the target from the
 * request body — or, for create-user, from the response it answers with.
 */
export function recordAdminAudit(args: {
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
