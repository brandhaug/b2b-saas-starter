import { Database } from '@b2b-saas-starter/db/service'
import { user, workspaceMembers, workspaces } from '@b2b-saas-starter/db/schema'
import { Effect, Layer } from 'effect'
import { and, asc, eq, type SQL } from 'drizzle-orm'

import { MembershipChangeRejected } from '../errors.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { publishSeatSyncWith, SeatSyncPublisher } from '../billing/seat-sync.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  type WorkspaceMemberBinding,
  WorkspaceMembership,
  MEMBERSHIP_REFUSAL_REASONS,
  refuseMembershipChange
} from './workspace-membership.ts'
import {
  countWorkspaceOwners,
  findWorkspaceMember,
  requireMemberRowId,
  toMember,
  toWorkspace
} from './workspace-identity.ts'

const { callBinding } = makeBindingCaller<
  WorkspaceMemberBinding,
  MembershipChangeRejected
>({
  capability: 'workspace-membership',
  noBindingReason: 'no_member_binding',
  Rejected: MembershipChangeRejected
})

export function LiveWorkspaceMembership(
  binding?: WorkspaceMemberBinding
): Layer.Layer<
  WorkspaceMembership,
  never,
  Database | AuditEventLog | SeatSyncPublisher
> {
  return Layer.effect(WorkspaceMembership)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const seatSync = yield* SeatSyncPublisher

      const unavailable = orUnavailable('workspace-membership')

      /**
       * The plugin addresses a member by its surrogate row id, while every
       * capability caller speaks in user ids. Resolving here also supplies the
       * `not_a_member` rejection without a second round trip.
       */
      function resolveMemberId(workspaceId: string, userId: string) {
        return requireMemberRowId(
          db,
          { workspaceId, userId },
          () => new MembershipChangeRejected({ reason: 'not_a_member' })
        )
      }

      /** Reads the member back through the same join `listMembers` uses. */
      const readMember = Effect.fnUntraced(function* (
        workspaceId: string,
        userId: string
      ) {
        const member = yield* findWorkspaceMember(db, { workspaceId, userId })
        if (!member) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'not_a_member' })
          )
        }
        return member
      })

      /**
       * The ownership rule's inputs, as D1 sees them: the target's current
       * role and the owner count the plugin would count itself. Refusing here
       * means the caller gets the machine reason, and the plugin is never
       * asked for a change it would refuse with message text.
       */
      const rosterFacts = Effect.fnUntraced(function* (
        workspaceId: string,
        userId: string
      ) {
        const target = yield* findWorkspaceMember(db, { workspaceId, userId })
        const ownerCount = yield* countWorkspaceOwners(db, workspaceId)
        return { targetRole: target?.role ?? null, ownerCount }
      })

      return {
        listMembers: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ member: workspaceMembers, user })
              .from(workspaceMembers)
              .innerJoin(user, eq(user.id, workspaceMembers.userId))
              .where(eq(workspaceMembers.workspaceId, ctx.workspace.id))
          )
          return rows.map(toMember)
        }),
        listMembersPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const conditions: Array<SQL> = [
              eq(workspaceMembers.workspaceId, ctx.workspace.id)
            ]
            // Forward on user `id ASC` — no timestamp on the wire shape, so a
            // cursor is every member with a strictly greater id. The SQL
            // resume comes from `keyset-query.ts`, like every paged read.
            const resume = keysetResume(
              'asc',
              { key: workspaceMembers.userId, id: workspaceMembers.userId },
              input?.cursor
            )
            if (resume.kind === 'empty') {
              return { items: [], nextCursor: null }
            }
            if (resume.kind === 'resume') {
              conditions.push(resume.condition)
            }
            const rows = yield* unavailable(
              db
                .select({ member: workspaceMembers, user })
                .from(workspaceMembers)
                .innerJoin(user, eq(user.id, workspaceMembers.userId))
                .where(and(...conditions))
                .orderBy(asc(workspaceMembers.userId))
                .limit(clampPageLimit(input?.limit) + 1)
            )
            return cutKeysetPage(
              rows.map(toMember),
              clampPageLimit(input?.limit),
              (member) => ({ key: member.id, id: member.id })
            )
          }),
        listWorkspacesForUser: (userId) =>
          unavailable(
            db
              .select({ workspace: workspaces, member: workspaceMembers, user })
              .from(workspaceMembers)
              .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
              .innerJoin(user, eq(user.id, workspaceMembers.userId))
              .where(eq(workspaceMembers.userId, userId))
          ).pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                workspace: toWorkspace(row.workspace),
                member: toMember(row)
              }))
            )
          ),
        addMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding(binding, (bound) =>
              bound.addMember({
                workspaceId: ctx.workspace.id,
                userId: input.userId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.added',
              targetType: 'workspace_member',
              targetId: input.userId,
              metadata: { role: input.role }
            })
            // Seat sync rides a queue the background worker consumes, so this
            // mutation never awaits Stripe — best-effort, after the audit.
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: ctx.workspace.id,
              reason: 'member_added'
            })
            return member
          }),
        removeMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const facts = yield* rosterFacts(ctx.workspace.id, input.userId)
            const refusal = refuseMembershipChange('remove', {
              actorRole: ctx.actor?.role ?? null,
              targetRole: facts.targetRole,
              ownerCount: facts.ownerCount
            })
            if (refusal !== null) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: refusal })
              )
            }
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.removeMember({ workspaceId: ctx.workspace.id, memberId })
            )
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: input.userId
            })
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: ctx.workspace.id,
              reason: 'member_removed'
            })
          }),
        leave: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const actor = ctx.actor
          if (actor === null) {
            // An actorless context has no membership to end — the same
            // fail-closed read the rule itself states.
            return yield* Effect.fail(
              new MembershipChangeRejected({
                reason: MEMBERSHIP_REFUSAL_REASONS.notAMember
              })
            )
          }
          // The actor's own row is both sides of the rule: an actor the
          // context resolved but the roster no longer carries (a concurrent
          // removal) fails closed as `not_a_member`.
          const facts = yield* rosterFacts(ctx.workspace.id, actor.userId)
          const refusal = refuseMembershipChange('leave', {
            actorRole: facts.targetRole,
            targetRole: facts.targetRole,
            ownerCount: facts.ownerCount
          })
          if (refusal !== null) {
            return yield* Effect.fail(new MembershipChangeRejected({ reason: refusal }))
          }
          // The plugin's leave endpoint resolves the member from the session,
          // so no row id is resolved here — the session IS the address.
          yield* callBinding(binding, (bound) =>
            bound.leave({ workspaceId: ctx.workspace.id })
          )
          yield* recordInWorkspace(audit, {
            eventType: 'workspace_member.removed',
            targetType: 'workspace_member',
            targetId: actor.userId,
            metadata: { reason: 'left' }
          })
          yield* publishSeatSyncWith(seatSync, {
            workspaceId: ctx.workspace.id,
            reason: 'member_removed'
          })
        }),
        changeRole: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const facts = yield* rosterFacts(ctx.workspace.id, input.userId)
            const refusal = refuseMembershipChange('change_role', {
              actorRole: ctx.actor?.role ?? null,
              targetRole: facts.targetRole,
              ownerCount: facts.ownerCount,
              nextRole: input.role
            })
            if (refusal !== null) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: refusal })
              )
            }
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.changeRole({
                workspaceId: ctx.workspace.id,
                memberId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.role_changed',
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
