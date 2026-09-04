import { Effect, Layer, Ref } from 'effect'

import { UserAdminRejected } from '../errors.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  IMPERSONATION_SESSION_SECONDS,
  impersonationNotice,
  PlatformUserAdmin,
  refuseImpersonationTarget,
  type SystemUserAccount
} from './platform-user-admin.ts'
import { type WorkspaceRole } from './workspace-identity.ts'

/**
 * In-memory accounts, never Better Auth. Built from the fixture members so the
 * seed path exercises the same identities the rest of the fixtures use.
 *
 * `memberships` seeds which (workspace, user) pairs exist, so
 * `changeWorkspaceRole` can refuse a non-member exactly like Live does — the
 * fixture has no `workspaceMembers` table to join.
 */
export type SeedMembership = {
  readonly workspaceId: string
  readonly userId: string
  readonly role: WorkspaceRole
}

export function SeedPlatformUserAdmin(
  users: ReadonlyArray<SystemUserAccount>,
  memberships: ReadonlyArray<SeedMembership> = []
): Layer.Layer<PlatformUserAdmin, never, AuditEventLog | NotificationFeed> {
  return Layer.effect(
    PlatformUserAdmin,
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const notifications = yield* NotificationFeed
      const roster = yield* Ref.make<ReadonlyArray<SystemUserAccount>>(users)
      // The one impersonation the fixture can hold at a time, keyed by the
      // impersonated user: Better Auth holds one admin cookie per browser.
      const impersonating = yield* Ref.make<string | null>(null)
      // Roles keyed `${workspaceId}:${userId}`, seeded from `memberships`.
      const overrides = yield* Ref.make<ReadonlyMap<string, WorkspaceRole>>(
        new Map(memberships.map((m) => [`${m.workspaceId}:${m.userId}`, m.role]))
      )

      function requireAccount(userId: string) {
        return Ref.get(roster).pipe(
          Effect.flatMap((current) => {
            const account = current.find((candidate) => candidate.id === userId)
            if (!account) {
              return Effect.fail(new UserAdminRejected({ reason: 'unknown_user' }))
            }
            return Effect.succeed(account)
          })
        )
      }

      function setBanned(userId: string, banned: boolean) {
        return Ref.update(roster, (current) =>
          current.map((account) => {
            if (account.id === userId) {
              return { ...account, banned }
            }
            return account
          })
        )
      }

      return {
        listUsers: Ref.get(roster),
        banUser: (input) =>
          Effect.gen(function* () {
            yield* requireAccount(input.userId)
            yield* setBanned(input.userId, true)
            // Same events as Live, recorded after the in-memory write.
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
            yield* setBanned(input.userId, false)
            yield* audit.record({
              actorUserId: input.actorUserId,
              eventType: 'system_admin.user_unbanned',
              targetType: 'user',
              targetId: input.userId
            })
          }),
        changeWorkspaceRole: (input) =>
          Effect.gen(function* () {
            const account = yield* requireAccount(input.userId)
            const key = `${input.workspaceId}:${input.userId}`
            const current = yield* Ref.get(overrides)
            if (!current.has(key)) {
              return yield* Effect.fail(
                new UserAdminRejected({ reason: 'not_a_member' })
              )
            }
            yield* Ref.update(overrides, (map) => new Map(map).set(key, input.role))
            const member = {
              id: account.id,
              name: account.name,
              email: account.email,
              role: input.role,
              systemRole: account.systemRole
            }
            // Recorded after the write and its read-back, like Live.
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
            yield* Ref.set(impersonating, input.userId)
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
            const current = yield* Ref.get(impersonating)
            if (current !== input.userId) {
              // Mirrors the plugin's 400 "not impersonating anyone".
              return yield* Effect.fail(
                new UserAdminRejected({ reason: 'not_impersonating' })
              )
            }
            yield* Ref.set(impersonating, null)
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
