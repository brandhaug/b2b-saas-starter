import { Context, Effect, Schema } from 'effect'

import {
  type CapabilityUnavailable,
  ImpersonationForbidden,
  UserAdminRejected
} from '../errors.ts'
import { literalTuple } from '../internal/literal-tuple.ts'
import { type NotificationKind } from '../notifications/notification-kinds.ts'
import { SystemRole, type Member, type WorkspaceRole } from './workspace-identity.ts'

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
  'change_passkey',
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

/**
 * The notification the impersonated user receives, worded once for both
 * adapters. It fires when the session starts — the one moment guaranteed to
 * happen, since a session the admin never stops simply expires.
 */
export function impersonationNotice(adminName: string) {
  const minutes = IMPERSONATION_SESSION_SECONDS / 60
  return {
    kind: 'account.impersonated',
    title: 'A System Admin accessed your account',
    message: `${adminName} started an impersonation session on your account. It ends when they stop it or after ${minutes} minutes, and it cannot change your password, two-factor settings, or email.`
  } satisfies { kind: NotificationKind; title: string; message: string }
}

/**
 * The two refusals both adapters make before any session is minted: a System
 * Admin is never impersonated (their session would carry `/admin`, which is
 * exactly the escalation the plugin's `allowImpersonatingAdmins: false`
 * default also refuses), and an admin does not impersonate themself — the
 * result would be a shorter-lived copy of the session they already hold.
 */
export function refuseImpersonationTarget(
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
