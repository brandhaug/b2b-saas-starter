import { user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { eq } from 'drizzle-orm'

import {
  type CapabilityUnavailable,
  ImpersonationForbidden,
  UserAdminRejected
} from '../errors.ts'
import { literalTuple } from '../internal/literal-tuple.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
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
 * ban flow).
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

/**
 * How long an impersonation session lives, in seconds. Stated here so the
 * capability's audit metadata, the notification copy, and the plugin option in
 * `packages/auth` (`impersonationSessionDuration`) quote one number. The auth
 * package cannot import this one (siblings, ADR 0051), so its option restates
 * the value — change both together.
 */
export const IMPERSONATION_SESSION_SECONDS = 60 * 60

/**
 * The account actions an impersonation session may never perform (ADR 0054).
 * The vocabulary is the capability's; the app maps Better Auth's endpoints onto
 * it at the catchall (`apps/web/src/lib/server/impersonation-guard.ts`) and the
 * UI hides the matching controls.
 */
export const IMPERSONATION_FORBIDDEN_ACTIONS = literalTuple(
  'change_password',
  'change_two_factor',
  'change_email',
  'delete_account'
)

export type ImpersonationForbiddenAction =
  (typeof IMPERSONATION_FORBIDDEN_ACTIONS)[number]

/** The one field of a session the guard reads. */
export type ImpersonationAwareSession = {
  readonly impersonatedBy?: string | null | undefined
}

/**
 * Refuses a forbidden account action for an impersonation session, and lets
 * every other session through. Pure: no store, no binding — both adapters and
 * the app's request boundary call this one function so the rule cannot drift
 * between them.
 */
export function refuseWhileImpersonating(
  session: ImpersonationAwareSession,
  action: ImpersonationForbiddenAction
): Effect.Effect<void, ImpersonationForbidden> {
  if (session.impersonatedBy === undefined || session.impersonatedBy === null) {
    return Effect.void
  }
  return Effect.fail(new ImpersonationForbidden({ action }))
}

export type StartImpersonationInput = UserAdminRef & {
  /** The System Admin starting the session — never null: an unattributed impersonation is refused. */
  readonly actorUserId: string
}

export type StopImpersonationInput = UserAdminRef & {
  /** The System Admin whose session is restored, read from `session.impersonatedBy`. */
  readonly actorUserId: string
}

/** What a started impersonation session promises the caller. */
export type ImpersonationStarted = {
  readonly userId: string
  readonly expiresInSeconds: number
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
  /**
   * Opens an impersonation session on `userId` for the admin `actorUserId`
   * (ADR 0054). Refuses an unknown account, a System Admin target, and the
   * admin's own account before touching the binding; records
   * `system_admin.impersonation_started` and notifies the impersonated user.
   * The session itself (cookies, expiry) is Better Auth's — the binding owns it.
   */
  readonly startImpersonation: (
    input: StartImpersonationInput
  ) => Effect.Effect<ImpersonationStarted, CapabilityUnavailable | UserAdminRejected>
  /**
   * Ends the impersonation session on `userId` and restores the admin's own.
   * Records `system_admin.impersonation_stopped` against the same pair.
   */
  readonly stopImpersonation: (
    input: StopImpersonationInput
  ) => Effect.Effect<void, CapabilityUnavailable | UserAdminRejected>
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
  /** `admin.impersonateUser` — swaps the request's session cookie for the target's. */
  readonly impersonateUser: (input: { readonly userId: string }) => Promise<void>
  /** `admin.stopImpersonating` — restores the admin's own session cookie. */
  readonly stopImpersonating: () => Promise<void>
}

const { callBinding } = makeBindingCaller<PlatformUserAdminBinding, UserAdminRejected>({
  capability: 'platform-user-admin',
  noBindingReason: 'no_user_admin_binding',
  Rejected: UserAdminRejected
})

/**
 * The notification the impersonated user receives, worded once for both
 * adapters. It fires when the session starts — the one moment guaranteed to
 * happen, since a session the admin never stops simply expires.
 */
function impersonationNotice(adminName: string) {
  const minutes = IMPERSONATION_SESSION_SECONDS / 60
  return {
    title: 'A System Admin accessed your account',
    message: `${adminName} started an impersonation session on your account. It ends when they stop it or after ${minutes} minutes, and it cannot change your password, two-factor settings, or email.`
  }
}

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

/**
 * The two refusals both adapters make before any session is minted: a System
 * Admin is never impersonated (their session would carry `/admin`, which is
 * exactly the escalation the plugin's `allowImpersonatingAdmins: false`
 * default also refuses), and an admin does not impersonate themself — the
 * result would be a shorter-lived copy of the session they already hold.
 */
function refuseImpersonationTarget(
  target: SystemUserAccount,
  actorUserId: string
): Effect.Effect<void, UserAdminRejected> {
  if (target.id === actorUserId) {
    return Effect.fail(new UserAdminRejected({ reason: 'cannot_impersonate_self' }))
  }
  if (target.systemRole === 'admin') {
    return Effect.fail(new UserAdminRejected({ reason: 'cannot_impersonate_admin' }))
  }
  return Effect.void
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
