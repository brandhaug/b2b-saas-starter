import { session, workspaceSsoRecoveryExceptions } from '@b2b-saas-starter/db/schema'
import { type EffectDatabase } from '@b2b-saas-starter/db/service'
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'
import { MembershipChangeRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { SSO_AUTH_RECENCY_MS } from './sso-policy.ts'

/** Session refresh changes updatedAt, never this authentication timestamp. */
export const requireRecentSsoConfigurationAuth = Effect.fn(
  'SsoConfiguration.requireRecentAuthentication'
)(function* (db: EffectDatabase, recencyMs = SSO_AUTH_RECENCY_MS) {
  const ctx = yield* WorkspaceContext
  if (ctx.actor === null || ctx.sessionId === null || ctx.sessionId === undefined) {
    return yield* new MembershipChangeRejected({
      reason: 'recent_authentication_required'
    })
  }
  const nowDateTime = yield* DateTime.now
  const now = DateTime.formatIso(nowDateTime)
  const nowMillis = DateTime.toEpochMillis(nowDateTime)
  const [current] = yield* orUnavailable('sso-policy')(
    db
      .select()
      .from(session)
      .where(
        and(
          eq(session.id, ctx.sessionId),
          eq(session.userId, ctx.actor.userId),
          gt(session.expiresAt, DateTime.toDate(nowDateTime)),
          isNull(session.impersonatedBy)
        )
      )
      .limit(1)
  )
  if (!current) {
    return yield* new MembershipChangeRejected({
      reason: 'recent_authentication_required'
    })
  }
  if (ctx.purpose === 'sso_repair') {
    const [recovery] = yield* orUnavailable('sso-policy')(
      db
        .select({ id: workspaceSsoRecoveryExceptions.id })
        .from(workspaceSsoRecoveryExceptions)
        .where(
          and(
            eq(workspaceSsoRecoveryExceptions.workspaceId, ctx.workspace.id),
            eq(workspaceSsoRecoveryExceptions.userId, ctx.actor.userId),
            eq(workspaceSsoRecoveryExceptions.sessionId, ctx.sessionId),
            isNotNull(workspaceSsoRecoveryExceptions.usedAt),
            isNull(workspaceSsoRecoveryExceptions.expiredAt),
            gt(workspaceSsoRecoveryExceptions.expiresAt, now)
          )
        )
        .limit(1)
    )
    if (recovery) {
      return
    }
    return yield* new MembershipChangeRejected({
      reason: 'active_recovery_exception_required'
    })
  }
  const authenticatedAt = current.createdAt.getTime()
  if (authenticatedAt > nowMillis || nowMillis - authenticatedAt > recencyMs) {
    return yield* new MembershipChangeRejected({
      reason: 'recent_authentication_required'
    })
  }
})
