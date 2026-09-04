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
  WorkspaceMembership
} from './workspace-membership.ts'
import {
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
        changeRole: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
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
