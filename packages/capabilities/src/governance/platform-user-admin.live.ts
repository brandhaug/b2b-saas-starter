import { type UserId, type WorkspaceId } from '@b2b-saas-starter/db/ids'
import { user } from '@b2b-saas-starter/db/schema/auth'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'

import { UserAdminRejected } from '../errors.ts'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog, recordCompletedAudit } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  IMPERSONATION_SESSION_SECONDS,
  impersonationNotice,
  PlatformUserAdmin,
  refuseImpersonationTarget,
  type PlatformUserAdminBinding,
  type SystemUserAccount
} from './platform-user-admin.ts'
import { findWorkspaceMember, requireMemberRowId } from './workspace-identity.ts'
import {
  recordSecurityEvidence,
  type SecurityEvidenceSink
} from './security-recovery-evidence.ts'

const { callBinding } = makeBindingCaller<PlatformUserAdminBinding, UserAdminRejected>({
  capability: 'platform-user-admin',
  noBindingReason: 'no_user_admin_binding',
  Rejected: UserAdminRejected
})

function toAccount(row: typeof user.$inferSelect): SystemUserAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    // `user.role` is the typed system-role column; null means the plugin never
    // wrote one, which is a plain user.
    systemRole: row.role ?? 'user',
    banned: row.banned ?? false
  }
}

export function LivePlatformUserAdmin(
  binding?: PlatformUserAdminBinding,
  evidenceSink?: SecurityEvidenceSink
): Layer.Layer<PlatformUserAdmin, never, Database | AuditEventLog | NotificationFeed> {
  return Layer.effect(PlatformUserAdmin)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const notifications = yield* NotificationFeed

      const unavailable = orUnavailable('platform-user-admin')

      /**
       * Live refuses an unknown account itself rather than letting the plugin's
       * UPDATE match zero rows silently — the audit row must not fire for a
       * change that changed nothing.
       */
      const requireAccount = Effect.fn('PlatformUserAdmin.requireAccount')(function* (
        userId: UserId
      ) {
        const rows = yield* unavailable(
          db.select().from(user).where(eq(user.id, userId)).limit(1)
        )
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(new UserAdminRejected({ reason: 'unknown_user' }))
        }
        return toAccount(row)
      })

      /**
       * The plugin addresses a member by its surrogate row id; the capability
       * speaks in user ids, like `WorkspaceMembership` does.
       */
      function resolveMemberId(workspaceId: WorkspaceId, userId: UserId) {
        return requireMemberRowId(
          db,
          { workspaceId, userId },
          () => new UserAdminRejected({ reason: 'not_a_member' })
        )
      }

      return {
        listUsers: unavailable(db.select().from(user)).pipe(
          Effect.map((rows) => rows.map(toAccount))
        ),
        banUser: Effect.fn('PlatformUserAdmin.banUser')(function* (input) {
          yield* requireAccount(input.userId)
          yield* callBinding(binding, (bound) =>
            bound.banUser({ userId: input.userId })
          )
          yield* recordSecurityEvidence(
            { kind: 'account_banned', subjectId: input.userId },
            evidenceSink
          )
          yield* recordCompletedAudit(
            audit,
            {
              actorUserId: input.actorUserId,
              actorType: 'user',
              eventType: 'system_admin.user_banned',
              targetType: 'user',
              targetId: input.userId
            },
            'platform_user_admin.ban'
          )
        }),
        unbanUser: Effect.fn('PlatformUserAdmin.unbanUser')(function* (input) {
          yield* requireAccount(input.userId)
          yield* callBinding(binding, (bound) =>
            bound.unbanUser({ userId: input.userId })
          )
          yield* recordCompletedAudit(
            audit,
            {
              actorUserId: input.actorUserId,
              actorType: 'user',
              eventType: 'system_admin.user_unbanned',
              targetType: 'user',
              targetId: input.userId
            },
            'platform_user_admin.unban'
          )
        }),
        changeWorkspaceRole: Effect.fn('PlatformUserAdmin.changeWorkspaceRole')(
          function* (input) {
            const memberId = yield* resolveMemberId(input.workspaceId, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.setMemberRole({
                workspaceId: input.workspaceId,
                memberId,
                role: input.role
              })
            )
            // The binding completed. Preserve the restriction even if readback
            // or the subsequent audit fails.
            yield* recordSecurityEvidence(
              {
                kind: 'workspace_access_removed',
                subjectId: input.userId,
                workspaceId: input.workspaceId
              },
              evidenceSink
            )
            const member = yield* findWorkspaceMember(db, {
              workspaceId: input.workspaceId,
              userId: input.userId
            })
            if (!member) {
              // The write succeeded but the read-back found nothing — treat it
              // the way a rejected change reads, without claiming success.
              return yield* Effect.fail(
                new UserAdminRejected({ reason: 'not_a_member_after_write' })
              )
            }
            yield* recordCompletedAudit(
              audit,
              {
                workspaceId: input.workspaceId,
                actorUserId: input.actorUserId,
                actorType: 'user',
                eventType: 'system_admin.user_role_changed',
                targetType: 'workspace_member',
                targetId: input.userId,
                metadata: { role: input.role }
              },
              'platform_user_admin.change_workspace_role'
            )
            return member
          }
        ),
        startImpersonation: Effect.fn('PlatformUserAdmin.startImpersonation')(
          function* (input) {
            const target = yield* requireAccount(input.userId)
            yield* refuseImpersonationTarget(target, input.actorUserId)
            const admin = yield* requireAccount(input.actorUserId)
            yield* callBinding(binding, (bound) =>
              bound.impersonateUser({ userId: input.userId })
            )
            yield* recordCompletedAudit(
              audit,
              {
                actorUserId: input.actorUserId,
                actorType: 'user',
                eventType: 'system_admin.impersonation_started',
                targetType: 'user',
                targetId: input.userId,
                metadata: { expiresInSeconds: IMPERSONATION_SESSION_SECONDS }
              },
              'platform_user_admin.start_impersonation'
            )
            yield* notifications.notifyUser({
              userId: input.userId,
              ...impersonationNotice(admin.name)
            })
            return {
              userId: input.userId,
              expiresInSeconds: IMPERSONATION_SESSION_SECONDS
            }
          }
        ),
        stopImpersonation: Effect.fn('PlatformUserAdmin.stopImpersonation')(
          function* (input) {
            yield* callBinding(binding, (bound) => bound.stopImpersonating())
            yield* recordCompletedAudit(
              audit,
              {
                actorUserId: input.actorUserId,
                actorType: 'user',
                eventType: 'system_admin.impersonation_stopped',
                targetType: 'user',
                targetId: input.userId
              },
              'platform_user_admin.stop_impersonation'
            )
          }
        )
      }
    })
  )
}
