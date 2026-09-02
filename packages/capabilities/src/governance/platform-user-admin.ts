import { user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { eq } from 'drizzle-orm'

import { type CapabilityUnavailable, UserAdminRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  findWorkspaceMember,
  requireMemberRowId,
  SystemRole,
  type Member,
  type WorkspaceRole
} from './workspace-identity.ts'
import { AuditEventLog } from './audit-event-log.ts'

/**
 * A user account at system level: what `/admin` lists and acts on. Deliberately
 * narrower than the `user` table — no ban reason or expiry rides the wire yet,
 * because the admin surface does not promise them (ADR 0024 defers the rich
 * ban flow along with impersonation).
 */
export const SystemUserAccount = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  systemRole: SystemRole,
  banned: Schema.Boolean
})
export type SystemUserAccount = typeof SystemUserAccount.Type

export type UserAdminRef = {
  readonly userId: string
}

export type BanInput = UserAdminRef & {
  /** The admin acting — resolved at the route boundary by `requireAdmin`. */
  readonly actorUserId: string | null
}

export type ChangeWorkspaceRoleInput = BanInput & {
  readonly workspaceId: string
  readonly role: WorkspaceRole
}

export type PlatformUserAdminInterface = {
  /** Every account, for `/admin`'s user list. Not paginated yet — neither is the plugin read it replaces. */
  readonly listUsers: Effect.Effect<
    ReadonlyArray<SystemUserAccount>,
    CapabilityUnavailable
  >
  readonly banUser: (
    input: BanInput
  ) => Effect.Effect<void, CapabilityUnavailable | UserAdminRejected>
  readonly unbanUser: (
    input: BanInput
  ) => Effect.Effect<void, CapabilityUnavailable | UserAdminRejected>
  /**
   * Cross-workspace role change, keyed by explicit `workspaceId` — the admin
   * surface has no ambient `WorkspaceContext`, so this is an identity-keyed
   * method in the same family as `listWorkspacesForUser`. Returns the updated
   * membership read back from the store.
   */
  readonly changeWorkspaceRole: (
    input: ChangeWorkspaceRoleInput
  ) => Effect.Effect<Member, CapabilityUnavailable | UserAdminRejected>
}

export class PlatformUserAdmin extends Context.Service<
  PlatformUserAdmin,
  PlatformUserAdminInterface
>()('@b2b-saas-starter/capabilities/PlatformUserAdmin') {}

/**
 * The system-level write half, as this package needs it — a structural port
 * over Better Auth's `admin` endpoints and one organization-plugin member
 * call. Every endpoint behind it is `requireHeaders: true` (the plugin enforces
 * the admin role from the request's own session), so only the app can supply
 * this adapter, per call, exactly like `WorkspaceMemberBinding`.
 *
 * Promise-returning on purpose; rejections are classified by
 * `makeBindingCaller`'s `callBinding`.
 */
export type PlatformUserAdminBinding = {
  readonly banUser: (input: { readonly userId: string }) => Promise<void>
  readonly unbanUser: (input: { readonly userId: string }) => Promise<void>
  readonly setMemberRole: (input: {
    readonly workspaceId: string
    readonly memberId: string
    readonly role: WorkspaceRole
  }) => Promise<void>
}

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
): Layer.Layer<PlatformUserAdmin, never, Database | AuditEventLog> {
  return Layer.effect(PlatformUserAdmin)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('platform-user-admin')

      /**
       * Live refuses an unknown account itself rather than letting the plugin's
       * UPDATE match zero rows silently — the audit row must not fire for a
       * change that changed nothing.
       */
      const requireAccount = Effect.fnUntraced(function* (userId: string) {
        const rows = yield* unavailable(
          db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)
        )
        if (!rows[0]) {
          return yield* Effect.fail(new UserAdminRejected({ reason: 'unknown_user' }))
        }
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
          })
      }
    })
  )
}

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
): Layer.Layer<PlatformUserAdmin> {
  return Layer.effect(
    PlatformUserAdmin,
    Effect.gen(function* () {
      const roster = yield* Ref.make<ReadonlyArray<SystemUserAccount>>(users)
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
          }),
        unbanUser: (input) =>
          Effect.gen(function* () {
            yield* requireAccount(input.userId)
            yield* setBanned(input.userId, false)
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
            return {
              id: account.id,
              name: account.name,
              email: account.email,
              role: input.role,
              systemRole: account.systemRole
            }
          })
      }
    })
  )
}
