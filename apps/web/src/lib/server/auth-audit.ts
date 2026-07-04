import { Effect } from 'effect'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities'
import { runCapabilities } from '@/lib/capabilities'

/**
 * Whether an auth catchall exchange is audit-worthy at all. Only credential
 * sign-in attempts are recorded today. Cheap by design: `recordAuthAudit`
 * runs it before touching the response body.
 */
export const isAuditedAuthExchange = (exchange: {
  readonly method: string
  readonly pathname: string
}): boolean =>
  exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/email')

/**
 * Pure mapping from an auth catchall exchange to the audit event it should
 * record, or `null` when the exchange is not audit-worthy: success attributes
 * the actor, failure records the attempt as a system event (workspaceId null
 * on both — sessions are not workspace-scoped).
 */
export const signInAuditInput = (exchange: {
  readonly method: string
  readonly pathname: string
  readonly status: number
  readonly userId: string | null
}): RecordAuditEventInput | null => {
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

/**
 * Best-effort audit recording for the auth catchall: never throws, so a D1
 * hiccup can't fail a sign-in that Better Auth already accepted. Under the
 * Seed layer (no DB binding) `record` is a no-op by design. Returns the
 * outcome so the caller's wide event can surface a dropped audit write.
 */
export const recordAuthAudit = async (
  request: Request,
  response: Response
): Promise<AuthAuditOutcome> => {
  const method = request.method
  const pathname = new URL(request.url).pathname
  if (!isAuditedAuthExchange({ method, pathname })) return 'skipped'
  let userId: string | null = null
  if (response.ok) {
    try {
      const body = (await response.clone().json()) as { user?: { id?: string } }
      userId = body.user?.id ?? null
    } catch {
      // Non-JSON success body — record the event without an actor.
    }
  }
  const input = signInAuditInput({ method, pathname, status: response.status, userId })
  if (!input) return 'skipped'
  try {
    await runCapabilities(
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        yield* audit.record(input)
      })
    )
    return 'recorded'
  } catch {
    // Best-effort: the caller annotates the wide event with the drop.
    return 'dropped'
  }
}
