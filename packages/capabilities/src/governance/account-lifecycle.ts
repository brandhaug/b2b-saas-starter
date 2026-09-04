import { Context, type Effect, Schema } from 'effect'

import {
  type AccountDeletionBlocked,
  type AccountDeletionRejected,
  type CapabilityUnavailable
} from '../errors.ts'
import { Workspace, WorkspaceRole } from './workspace-identity.ts'

/**
 * Account lifecycle: what happens to a user's workspaces when the user deletes
 * their own account. The contract half — schemas, the ownership rule both
 * adapters enforce, the service, and the binding port. `account-lifecycle.seed.ts`
 * and `account-lifecycle.live.ts` are the adapters.
 *
 * Identity-keyed throughout (no `WorkspaceContext`): the actor is asking about
 * every workspace they belong to at once, before any single one is selected —
 * the same family as `WorkspaceMembership.listWorkspacesForUser`.
 */

/** What deleting the account does to one workspace membership. */
export const AccountDeletionAction = Schema.Literals([
  /** The user is the only owner and other members remain: deletion is blocked until ownership is transferred. */
  'blocked_sole_owner',
  /** Other owners remain: the user's membership is removed, the workspace stays. */
  'leave',
  /** The user is the only member: the workspace goes with the account. */
  'delete_workspace'
])
export type AccountDeletionAction = typeof AccountDeletionAction.Type

export const AccountDeletionStep = Schema.Struct({
  workspace: Workspace,
  role: WorkspaceRole,
  action: AccountDeletionAction
})
export type AccountDeletionStep = typeof AccountDeletionStep.Type

export const AccountDeletionPlan = Schema.Struct({
  steps: Schema.Array(AccountDeletionStep),
  /** `false` while any step is `blocked_sole_owner`. */
  canDelete: Schema.Boolean
})
export type AccountDeletionPlan = typeof AccountDeletionPlan.Type

/**
 * One membership as the ownership rule needs it: the user's role plus the two
 * counts that decide the outcome. Both adapters resolve these from their own
 * store and hand them to `planAccountDeletion`, so the rule is written once.
 *
 * `memberId` is the membership row's own id — the plugin's `removeMember`
 * addresses a member by row id, so the leave binding needs it. It stays on
 * this adapter-internal shape on purpose: the wire plan carries no internal
 * row ids, so the adapters keep these memberships beside the plan.
 */
export type MembershipForDeletion = {
  readonly workspace: Workspace
  readonly memberId: string
  readonly role: WorkspaceRole
  readonly ownerCount: number
  readonly memberCount: number
}

/**
 * The ownership rule, pure. In order of precedence for one membership:
 *
 * 1. The user is the workspace's only member → `delete_workspace`. Whatever
 *    their role, nobody else is left to own it.
 * 2. The user is an owner and the only owner → `blocked_sole_owner`. Leaving
 *    would strand the other members without an owner; the organization plugin
 *    refuses that leave too, so the rule here is what the store enforces.
 * 3. Otherwise → `leave`. Other owners remain (or the user was never one).
 *
 * `canDelete` is the conjunction: one blocked workspace blocks the account.
 */
export function planAccountDeletion(
  memberships: ReadonlyArray<MembershipForDeletion>
): AccountDeletionPlan {
  const steps = memberships.map((membership): AccountDeletionStep => {
    let action: AccountDeletionAction = 'leave'
    if (membership.memberCount <= 1) {
      action = 'delete_workspace'
    } else if (membership.role === 'owner' && membership.ownerCount <= 1) {
      action = 'blocked_sole_owner'
    }
    return { workspace: membership.workspace, role: membership.role, action }
  })
  return {
    steps,
    canDelete: steps.every((step) => step.action !== 'blocked_sole_owner')
  }
}

/** The workspaces a plan is blocked on, for the error and the UI. */
export function blockingWorkspaces(
  plan: AccountDeletionPlan
): ReadonlyArray<Workspace> {
  const blocked: Array<Workspace> = []
  for (const step of plan.steps) {
    if (step.action === 'blocked_sole_owner') {
      blocked.push(step.workspace)
    }
  }
  return blocked
}

/** The counts the `account.deleted` event carries — never the workspace names. */
export type DeletionMetadata = {
  readonly workspacesLeft: number
  readonly workspacesDeleted: number
}

/**
 * Both adapters end at this one mapper, so the event's shape cannot drift
 * between the fixture and D1.
 */
export function deletionMetadata(plan: AccountDeletionPlan): DeletionMetadata {
  let workspacesLeft = 0
  let workspacesDeleted = 0
  for (const step of plan.steps) {
    if (step.action === 'leave') {
      workspacesLeft += 1
    } else if (step.action === 'delete_workspace') {
      workspacesDeleted += 1
    }
  }
  return { workspacesLeft, workspacesDeleted }
}

export type DeleteAccountInput = {
  readonly userId: string
  /**
   * The user's current password. Re-authentication is the store's job — the
   * Live binding hands it to Better Auth's `deleteUser`, which verifies it
   * before any teardown runs. A wrong password is `AccountDeletionRejected`.
   */
  readonly password: string
}

export type AccountLifecycleInterface = {
  /**
   * What deleting the account would do, per workspace. Never mutates. The
   * account page renders it so a blocked user learns which workspaces need a
   * new owner before they try.
   */
  readonly planDeletion: (
    userId: string
  ) => Effect.Effect<AccountDeletionPlan, CapabilityUnavailable>

  /**
   * Runs the plan's teardown for a user whose deletion is already underway:
   * leaves every workspace with other owners, deletes every workspace the
   * user was alone in, and detaches the user from the rows that reference
   * them without a cascade (audit actors, token creators) so the account row
   * can go. Fails `AccountDeletionBlocked` without touching anything when any
   * step is blocked.
   *
   * Live runs this from the store's own before-delete hook — after the
   * password has been verified and before the user row is removed — so a
   * wrong password never tears down a workspace. The app supplies that hook
   * (see `AccountLifecycleBinding`). Seed runs it inline from `deleteAccount`.
   */
  readonly prepareDeletion: (
    userId: string
  ) => Effect.Effect<
    AccountDeletionPlan,
    CapabilityUnavailable | AccountDeletionBlocked | AccountDeletionRejected
  >

  /**
   * Records `account.deleted` once the account row is gone. A system event
   * (`workspaceId: null`, `actorUserId: null`): the actor no longer exists to
   * be referenced, so the target names them instead.
   */
  readonly recordDeleted: (input: {
    readonly userId: string
    readonly plan: AccountDeletionPlan
  }) => Effect.Effect<void, CapabilityUnavailable>

  /**
   * Self-service account deletion with password re-authentication. Plans
   * first and fails `AccountDeletionBlocked` before asking for anything;
   * then hands the delete to the store, whose hooks run `prepareDeletion`
   * and `recordDeleted`. Seed executes the plan it returns. Live returns the
   * plan it checked: the store's before-hook re-plans and runs its own copy
   * (the one `recordDeleted` records), and that copy cannot cross the
   * binding's `Promise<void>` — by the time this resolves the session is
   * destroyed and the account is gone, so no caller can act on a stale one.
   */
  readonly deleteAccount: (
    input: DeleteAccountInput
  ) => Effect.Effect<
    AccountDeletionPlan,
    CapabilityUnavailable | AccountDeletionBlocked | AccountDeletionRejected
  >
}

export class AccountLifecycle extends Context.Service<
  AccountLifecycle,
  AccountLifecycleInterface
>()('@b2b-saas-starter/capabilities/AccountLifecycle') {}

/**
 * The write half, as this package needs it — a structural port over the
 * organization plugin's leave/delete endpoints and the core `deleteUser`
 * endpoint, never the plugin's wire shape (ADR 0051). Every one of the three
 * is session-bound, so only the app can supply the adapter.
 *
 * `deleteUser` is the whole delete: the store verifies the password, runs the
 * app's before-delete hook (which is where `prepareDeletion` runs), removes
 * the user row, and runs the after-delete hook (`recordDeleted`). The Live
 * adapter therefore never sees the password succeed or fail on its own — a
 * 4xx rejection from this call is `AccountDeletionRejected`.
 */
export type AccountLifecycleBinding = {
  readonly leaveWorkspace: (input: {
    readonly workspaceId: string
    /** The membership row's own id — the plugin's `removeMember` addresses members by row id. */
    readonly memberId: string
  }) => Promise<void>
  readonly deleteWorkspace: (input: { readonly workspaceId: string }) => Promise<void>
  readonly deleteUser: (input: { readonly password: string }) => Promise<void>
}
