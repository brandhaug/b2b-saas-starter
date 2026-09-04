import { user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'

import { UserAdminRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
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
  binding?: PlatformUserAdminBinding
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
      const requireAccount = Effect.fnUntraced(function* (userId: string) {
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
      function resolveMemberId(workspaceId: string, userId: string) {
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
        banUser: (input) =>
          Effect.gen(function* () {
            yield* requireAccount(input.userId)
            yield* callBinding(binding, (bound) =>
              bound.banUser({ userId: input.userId })
            )
            yield* audit.record({
              actorUserId: input.actorUserId,
              eventType: 'system_admin.user_banned',
              targetType: 'user',
              targetId: input.userId
            })
          }),
        unbanUser: (input) =>
          Effect.gen(function* () {
            yield* requireAccount(input.userId)
            yield* callBinding(binding, (bound) =>
              bound.unbanUser({ userId: input.userId })
            )
            yield* audit.record({
              actorUserId: input.actorUserId,
              eventType: 'system_admin.user_unbanned',
              targetType: 'user',
              targetId: input.userId
            })
          }),
        changeWorkspaceRole: (input) =>
          Effect.gen(function* () {
            const memberId = yield* resolveMemberId(input.workspaceId, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.setMemberRole({
                workspaceId: input.workspaceId,
                memberId,
                role: input.role
              })
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
            yield* audit.record({
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              eventType: 'system_admin.user_role_changed',
              targetType: 'workspace_member',
              targetId: input.userId,
              metadata: { role: input.role }
            })
            return member
          }),
        startImpersonation: (input) =>
          Effect.gen(function* () {
            const target = yield* requireAccount(input.userId)
            yield* refuseImpersonationTarget(target, input.actorUserId)
            const admin = yield* requireAccount(input.actorUserId)
            yield* callBinding(binding, (bound) =>
              bound.impersonateUser({ userId: input.userId })
            )
            yield* audit.record({
              actorUserId: input.actorUserId,
              eventType: 'system_admin.impersonation_started',
              targetType: 'user',
              targetId: input.userId,
              metadata: { expiresInSeconds: IMPERSONATION_SESSION_SECONDS }
            })
            yield* notifications.notifyUser({
              userId: input.userId,
              ...impersonationNotice(admin.name)
            })
            return {
              userId: input.userId,
              expiresInSeconds: IMPERSONATION_SESSION_SECONDS
            }
          }),
        stopImpersonation: (input) =>
          Effect.gen(function* () {
            yield* callBinding(binding, (bound) => bound.stopImpersonating())
            yield* audit.record({
              actorUserId: input.actorUserId,
              eventType: 'system_admin.impersonation_stopped',
              targetType: 'user',
              targetId: input.userId
            })
          })
      }
    })
  )
}
