import { Database, type EffectDatabase } from '@b2b-saas-starter/db/service'
import { workspaceInvitations, workspaces } from '@b2b-saas-starter/db/schema'
import { Effect, Layer, Option } from 'effect'
import { and, eq } from 'drizzle-orm'

import { MembershipChangeRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type Invitation,
  type WorkspaceInvitationBinding
} from './workspace-invitations.ts'

const { callBinding } = makeBindingCaller<
  WorkspaceInvitationBinding,
  MembershipChangeRejected
>({
  capability: 'workspace-invitations',
  noBindingReason: 'no_invitation_binding',
  Rejected: MembershipChangeRejected
})

/** Maps a stored row onto the wire DTO. The row's dates are epoch integers. */
function toInvitation(row: typeof workspaceInvitations.$inferSelect): Invitation {
  return {
    id: row.id,
    email: row.email,
    // The column is nullable — the plugin lets an invitation fall back to its
    // default role on accept. The starter always sends one, so a null here is
    // an invitation the plugin created outside this capability.
    role: row.role ?? 'member',
    status: row.status,
    expiresAt: row.expiresAt.toISOString()
  }
}

export function LiveWorkspaceInvitations(
  binding?: WorkspaceInvitationBinding
): Layer.Layer<WorkspaceInvitations, never, Database | AuditEventLog> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('workspace-invitations')

      /**
       * Reads the invitation back through the same table `list` reads, rather
       * than trusting the binding's return value: the plugin's response shape
       * is exactly what this package refuses to name.
       */
      const readPending = Effect.fnUntraced(function* (
        workspaceId: string,
        email: string
      ) {
        const rows = yield* unavailable(pendingByEmail(db, workspaceId, email).limit(1))
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'invitation_not_created' })
          )
        }
        return toInvitation(row)
      })

      /**
       * One invitation with its workspace, keyed by id alone. Both the accept
       * path and the accept page's read go through here: neither has a slug to
       * resolve a `WorkspaceContext` from.
       */
      const findJoined = Effect.fnUntraced(function* (invitationId: string) {
        const rows = yield* unavailable(
          db
            .select({ invitation: workspaceInvitations, workspace: workspaces })
            .from(workspaceInvitations)
            .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
            .where(eq(workspaceInvitations.id, invitationId))
            .limit(1)
        )
        return Option.fromUndefinedOr(rows[0])
      })

      /**
       * Scopes the invitation to the calling workspace before the plugin is
       * touched. The plugin would answer for any invitation the session may
       * cancel; this capability answers only for the workspace in context.
       */
      const requirePendingInWorkspace = Effect.fnUntraced(function* (
        workspaceId: string,
        invitationId: string
      ) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceInvitations)
            .where(
              and(
                eq(workspaceInvitations.id, invitationId),
                eq(workspaceInvitations.workspaceId, workspaceId),
                eq(workspaceInvitations.status, 'pending')
              )
            )
            .limit(1)
        )
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'invitation_not_pending' })
          )
        }
        return toInvitation(row)
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceInvitations)
              .where(eq(workspaceInvitations.workspaceId, ctx.workspace.id))
          )
          return rows.map(toInvitation)
        }),
        find: (invitationId) =>
          findJoined(invitationId).pipe(
            Effect.map(
              Option.map((row) => ({
                ...toInvitation(row.invitation),
                workspaceSlug: row.workspace.slug,
                workspaceName: row.workspace.name
              }))
            )
          ),
        create: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding(binding, (bound) =>
              bound.create({
                workspaceId: ctx.workspace.id,
                email: input.email,
                role: input.role
              })
            )
            const created = yield* readPending(ctx.workspace.id, input.email)
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_invitation.sent',
              targetType: 'workspace_invitation',
              targetId: created.id,
              metadata: { email: input.email, role: input.role }
            })
            return created
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const pending = yield* requirePendingInWorkspace(
              ctx.workspace.id,
              input.invitationId
            )
            yield* callBinding(binding, (bound) =>
              bound.cancel({ invitationId: input.invitationId })
            )
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_invitation.canceled',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email }
            })
          }),
        accept: (input) =>
          Effect.gen(function* () {
            // No `WorkspaceContext` to read: the invitation names its own
            // workspace, which is the only way an accept can work for someone
            // the workspace does not yet contain.
            const joined = yield* findJoined(input.invitationId)
            if (Option.isNone(joined)) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'invitation_not_pending' })
              )
            }
            const row = joined.value
            const pending = toInvitation(row.invitation)
            yield* requirePending(pending)
            yield* requireRecipient(pending, input.email)
            yield* requireUnexpired(pending)

            // The plugin settles the invitation and creates the member row in
            // one call; this capability never writes either itself.
            yield* callBinding(binding, (bound) =>
              bound.accept({ invitationId: input.invitationId })
            )
            yield* audit.record({
              workspaceId: row.workspace.id,
              actorUserId: input.userId,
              eventType: 'workspace_invitation.accepted',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email, role: pending.role }
            })
            return {
              workspaceSlug: row.workspace.slug,
              workspaceName: row.workspace.name,
              role: pending.role
            }
          })
      }
    })
  )
}

/** The pending invitation for one address in one workspace, if there is one. */
function pendingByEmail(db: EffectDatabase, workspaceId: string, email: string) {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, 'pending')
      )
    )
}
