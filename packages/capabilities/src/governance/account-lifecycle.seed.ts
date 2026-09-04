import { Effect, Layer, Ref } from 'effect'

import { AccountDeletionBlocked, AccountDeletionRejected } from '../errors.ts'
import {
  AccountLifecycle,
  blockingWorkspaces,
  deletionMetadata,
  planAccountDeletion,
  type AccountDeletionPlan,
  type MembershipForDeletion
} from './account-lifecycle.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { type Workspace } from './workspace-identity.ts'
import { type SeedRoster } from './workspace-membership.ts'

/**
 * In-memory account lifecycle, never Better Auth. The fixture has one
 * workspace and one roster, so a user's memberships are either that one
 * membership or none; the plan is derived from the shared roster the
 * membership and invitation seeds write to, so all three adapters agree about
 * who is in the workspace and who owns it.
 *
 * Password re-authentication is the store's job in Live (Better Auth verifies
 * it before the teardown hook runs). The fixture has no credentials, so Seed
 * accepts any non-empty password and the empty string is the one rejection it
 * models — enough for the contract to say "the password is checked before
 * anything is torn down" on both sides.
 */
export function SeedAccountLifecycle(options: {
  readonly roster: SeedRoster
  readonly workspace: Workspace
}): Layer.Layer<AccountLifecycle, never, AuditEventLog> {
  return Layer.effect(AccountLifecycle)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      // Workspaces the seed deleted with an account. The roster empties with
      // them, so `planDeletion` for a later user answers from what is left.
      const deletedWorkspaces = yield* Ref.make<ReadonlyArray<string>>([])

      const membershipsOf = Effect.fnUntraced(function* (userId: string) {
        const roster = yield* Ref.get(options.roster)
        const gone = yield* Ref.get(deletedWorkspaces)
        const member = roster.find((candidate) => candidate.id === userId)
        if (!member || gone.includes(options.workspace.id)) {
          return [] satisfies ReadonlyArray<MembershipForDeletion>
        }
        return [
          {
            workspace: options.workspace,
            memberId: member.id,
            role: member.role,
            ownerCount: roster.filter((candidate) => candidate.role === 'owner').length,
            memberCount: roster.length
          }
        ] satisfies ReadonlyArray<MembershipForDeletion>
      })

      function planDeletion(userId: string) {
        return Effect.map(membershipsOf(userId), planAccountDeletion)
      }

      const prepareDeletion = Effect.fnUntraced(function* (userId: string) {
        const plan = yield* planDeletion(userId)
        if (!plan.canDelete) {
          return yield* Effect.fail(
            new AccountDeletionBlocked({ workspaces: blockingWorkspaces(plan) })
          )
        }
        for (const step of plan.steps) {
          if (step.action === 'delete_workspace') {
            yield* Ref.update(deletedWorkspaces, (ids) => [...ids, step.workspace.id])
            yield* Ref.set(options.roster, [])
            yield* audit.record({
              workspaceId: null,
              actorUserId: userId,
              eventType: 'workspace.deleted',
              targetType: 'workspace',
              targetId: step.workspace.id,
              metadata: { name: step.workspace.name, slug: step.workspace.slug }
            })
          } else {
            yield* Ref.update(options.roster, (members) =>
              members.filter((candidate) => candidate.id !== userId)
            )
            yield* audit.record({
              workspaceId: step.workspace.id,
              actorUserId: userId,
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: userId,
              metadata: { reason: 'account_deleted' }
            })
          }
        }
        return plan
      })

      function recordDeleted(input: {
        readonly userId: string
        readonly plan: AccountDeletionPlan
      }) {
        return audit.record({
          workspaceId: null,
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
            const plan = yield* planDeletion(input.userId)
            if (!plan.canDelete) {
              return yield* Effect.fail(
                new AccountDeletionBlocked({ workspaces: blockingWorkspaces(plan) })
              )
            }
            yield* requireSeedPassword(input.password)
            const executed = yield* prepareDeletion(input.userId)
            yield* recordDeleted({ userId: input.userId, plan: executed })
            return executed
          })
      }
    })
  )
}

function requireSeedPassword(password: string) {
  if (password.length === 0) {
    return Effect.fail(new AccountDeletionRejected({ reason: 'invalid_password' }))
  }
  return Effect.void
}
