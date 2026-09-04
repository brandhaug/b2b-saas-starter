import { Database } from '@b2b-saas-starter/db/service'
import {
  apiTokens,
  auditEvents,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Effect, Layer } from 'effect'
import { asc, eq, inArray } from 'drizzle-orm'

import { AccountDeletionBlocked, AccountDeletionRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  AccountLifecycle,
  blockingWorkspaces,
  deletionMetadata,
  planAccountDeletion,
  type AccountDeletionPlan,
  type AccountLifecycleBinding,
  type MembershipForDeletion
} from './account-lifecycle.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import { toWorkspace } from './workspace-identity.ts'

const { callBinding } = makeBindingCaller<
  AccountLifecycleBinding,
  AccountDeletionRejected
>({
  capability: 'account-lifecycle',
  noBindingReason: 'no_account_lifecycle_binding',
  Rejected: AccountDeletionRejected
})

/**
 * D1-backed account lifecycle, driven from the auth surface's delete endpoint.
 *
 * The sequencing lives in the store, not here: the endpoint verifies the
 * password FIRST (a wrong password is a 4xx the binding classifier turns into
 * `AccountDeletionRejected`), then runs the app's `beforeDelete` hook — which
 * is where `prepareDeletion` executes — then removes the user row, then runs
 * `afterDelete` (`recordDeleted`). So this adapter's `deleteAccount` is the
 * password-verified hand-off and `prepareDeletion` the teardown, and a wrong
 * password never reaches a workspace.
 */
export function LiveAccountLifecycle(
  binding?: AccountLifecycleBinding
): Layer.Layer<AccountLifecycle, never, Database | AuditEventLog> {
  return Layer.effect(AccountLifecycle)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('account-lifecycle')

      /**
       * Every membership the user holds, with the two counts the ownership
       * rule reads. One query for the memberships, one for the crowd counts of
       * exactly those workspaces — fixture-sized result sets, so the counts
       * are computed here rather than in SQL dialect.
       */
      const membershipsOf = Effect.fnUntraced(function* (userId: string) {
        const rows = yield* unavailable(
          db
            .select({
              memberId: workspaceMembers.id,
              role: workspaceMembers.role,
              id: workspaces.id,
              slug: workspaces.slug,
              name: workspaces.name,
              planId: workspaces.planId
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(eq(workspaceMembers.userId, userId))
            .orderBy(asc(workspaces.name))
        )
        if (rows.length === 0) {
          return [] satisfies ReadonlyArray<MembershipForDeletion>
        }
        const crowds = yield* unavailable(
          db
            .select({
              workspaceId: workspaceMembers.workspaceId,
              role: workspaceMembers.role
            })
            .from(workspaceMembers)
            .where(
              inArray(
                workspaceMembers.workspaceId,
                rows.map((row) => row.id)
              )
            )
        )
        return rows.map((row): MembershipForDeletion => ({
          workspace: toWorkspace(row),
          memberId: row.memberId,
          role: row.role,
          ownerCount: crowds.filter(
            (crowd) => crowd.workspaceId === row.id && crowd.role === 'owner'
          ).length,
          memberCount: crowds.filter((crowd) => crowd.workspaceId === row.id).length
        }))
      })

      function planDeletion(userId: string) {
        return Effect.map(membershipsOf(userId), planAccountDeletion)
      }

      const prepareDeletion = Effect.fnUntraced(function* (userId: string) {
        // The memberships are kept beside the plan: the steps are the wire
        // shape (no internal row ids), and the leave binding needs the
        // membership row id the plugin addresses members by.
        const memberships = yield* membershipsOf(userId)
        const plan = planAccountDeletion(memberships)
        if (!plan.canDelete) {
          return yield* Effect.fail(
            new AccountDeletionBlocked({ workspaces: blockingWorkspaces(plan) })
          )
        }
        // Wire steps carry no internal row ids, so the leave binding reads the
        // membership row id from the kept memberships, keyed by workspace.
        const stepByWorkspace = new Map(
          plan.steps.map((step) => [step.workspace.id, step])
        )
        for (const membership of memberships) {
          const { workspace } = membership
          const workspaceId = workspace.id
          const step = stepByWorkspace.get(workspaceId)
          if (step === undefined) {
            continue
          }
          if (step.action === 'delete_workspace') {
            yield* callBinding(binding, (bound) =>
              bound.deleteWorkspace({ workspaceId })
            )
            // A system event: `audit_events.workspace_id` cascades from the
            // row the binding just removed, so attributing the event to the
            // deleted workspace would delete it alongside its subject.
            yield* audit.record({
              workspaceId: null,
              actorUserId: userId,
              eventType: 'workspace.deleted',
              targetType: 'workspace',
              targetId: workspaceId,
              metadata: {
                name: workspace.name,
                slug: workspace.slug
              }
            })
          } else {
            yield* callBinding(binding, (bound) =>
              bound.leaveWorkspace({
                workspaceId,
                memberId: membership.memberId
              })
            )
            yield* audit.record({
              workspaceId,
              actorUserId: userId,
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: userId,
              metadata: { reason: 'account_deleted' }
            })
          }
        }
        // Detach the references that would outlive the account but block its
        // row's deletion: both columns carry a restricting foreign key to
        // `user.id` (no cascade, on purpose — history and attribution survive
        // as system rows). The audit rows keep describing what happened; the
        // tokens stay live or revoked as their workspace decides. Runs after
        // the loop so a blocked plan detaches nothing.
        yield* unavailable(
          db
            .update(auditEvents)
            .set({ actorUserId: null })
            .where(eq(auditEvents.actorUserId, userId))
        )
        yield* unavailable(
          db
            .update(apiTokens)
            .set({ createdByUserId: null })
            .where(eq(apiTokens.createdByUserId, userId))
        )
        return plan
      })

      function recordDeleted(input: {
        readonly userId: string
        readonly plan: AccountDeletionPlan
      }) {
        return audit.record({
          workspaceId: null,
          // Actorless on purpose: `audit_events.actor_user_id` restricts on
          // `user.id`, and the actor row is gone by the time this runs — the
          // event names the account in `targetId` instead.
          actorUserId: null,
          eventType: 'account.deleted',
          targetType: 'user',
          targetId: input.userId,
          metadata: deletionMetadata(input.plan)
        })
      }

      return {
        planDeletion,
        prepareDeletion,
        recordDeleted,
        deleteAccount: (input) =>
          Effect.gen(function* () {
            // The plan gate runs here, before the password is asked for, so a
            // blocked user learns the blocking workspaces without a doomed
            // round trip. The store re-checks in its own hook: the check is
            // cheap and fail-closed wins over a stale plan.
            const plan = yield* planDeletion(input.userId)
            if (!plan.canDelete) {
              return yield* Effect.fail(
                new AccountDeletionBlocked({ workspaces: blockingWorkspaces(plan) })
              )
            }
            yield* callBinding(binding, (bound) =>
              bound.deleteUser({ password: input.password })
            )
            return plan
          })
      }
    })
  )
}
