import { Database, type EffectDatabase } from '@b2b-saas-starter/db/service'
import { workspaceInvitations, workspaces } from '@b2b-saas-starter/db/schema'
import { Effect, Layer, Option } from 'effect'
import { and, desc, eq, sql } from 'drizzle-orm'

import { MembershipChangeRejected } from '../errors.ts'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  publishSeatSyncWith,
  SeatSyncPublisher
} from '@b2b-saas-starter/billing/seat-sync'
import {
  AuditEventLog,
  recordCompletedMutationAudit,
  recordCompletedAudit
} from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  normalizeInvitationEmail,
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type Invitation,
  type InvitationRef,
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
): Layer.Layer<
  WorkspaceInvitations,
  never,
  Database | AuditEventLog | SeatSyncPublisher
> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const seatSync = yield* SeatSyncPublisher

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
        list: Effect.fn('WorkspaceInvitations.list')(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceInvitations)
              .where(eq(workspaceInvitations.workspaceId, ctx.workspace.id))
              // Newest first, as the interface promises. `id` breaks
              // `createdAt` ties (the plugin stamps whole seconds, so a burst
              // of invitations shares one) — without it SQLite's row order is
              // whatever the scan produced and the Seed adapter cannot match.
              .orderBy(
                desc(workspaceInvitations.createdAt),
                desc(workspaceInvitations.id)
              )
          )
          return rows.map(toInvitation)
        })(),
        find: Effect.fn('WorkspaceInvitations.find')((invitationId: string) =>
          findJoined(invitationId).pipe(
            Effect.map(
              Option.map((row) => ({
                ...toInvitation(row.invitation),
                workspaceId: row.workspace.id,
                workspaceSlug: row.workspace.slug,
                workspaceName: row.workspace.name
              }))
            )
          )
        ),
        create: Effect.fn('WorkspaceInvitations.create')(function* (
          input: CreateInvitationInput
        ) {
          const ctx = yield* WorkspaceContext
          // Canonical on the way in, so the row the plugin writes is the one
          // `pendingByEmail` and `requireRecipient` will both recognise.
          const email = normalizeInvitationEmail(input.email)
          // One pending invitation per address, refused here with the machine
          // reason both adapters share. The plugin refuses it too, but only
          // with message text a caller would have to match on — and the
          // fixture adapter has no plugin to ask at all.
          const existing = yield* unavailable(
            pendingByEmail(db, ctx.workspace.id, email).limit(1)
          )
          if (existing[0]) {
            return yield* Effect.fail(
              new MembershipChangeRejected({ reason: 'already_invited' })
            )
          }
          yield* callBinding(binding, (bound) =>
            bound.create({
              workspaceId: ctx.workspace.id,
              email,
              role: input.role
            })
          )
          const created = yield* readPending(ctx.workspace.id, email)
          yield* recordCompletedMutationAudit(
            audit,
            {
              eventType: 'workspace_invitation.sent',
              targetType: 'workspace_invitation',
              targetId: created.id,
              metadata: { email, role: input.role }
            },
            'workspace_invitations.create'
          )
          return created
        }),
        cancel: Effect.fn('WorkspaceInvitations.cancel')(function* (
          input: InvitationRef
        ) {
          const ctx = yield* WorkspaceContext
          const pending = yield* requirePendingInWorkspace(
            ctx.workspace.id,
            input.invitationId
          )
          yield* callBinding(binding, (bound) =>
            bound.cancel({ invitationId: input.invitationId })
          )
          yield* recordCompletedMutationAudit(
            audit,
            {
              eventType: 'workspace_invitation.canceled',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email }
            },
            'workspace_invitations.cancel'
          )
        }),
        accept: Effect.fn('WorkspaceInvitations.accept')(function* (
          input: AcceptInvitationInput
        ) {
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
          yield* recordCompletedAudit(
            audit,
            {
              workspaceId: row.workspace.id,
              actorUserId: input.userId,
              actorType: 'user',
              eventType: 'workspace_invitation.accepted',
              targetType: 'workspace_invitation',
              targetId: input.invitationId,
              metadata: { email: pending.email, role: pending.role }
            },
            'workspace_invitations.accept'
          )
          // Acceptance adds a member, so it triggers the same seat sync a
          // direct add does — keyed off the invitation's own workspace,
          // because the accepter still has no `WorkspaceContext` to read.
          yield* publishSeatSyncWith(seatSync, {
            workspaceId: row.workspace.id,
            reason: 'invitation_accepted'
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

/**
 * The pending invitation for one address in one workspace, if there is one.
 *
 * Compared in the canonical form, not with a bare `eq`: D1's default TEXT
 * collation is BINARY, so `Ada@example.test` and `ada@example.test` are two
 * different rows to SQLite and one and the same recipient to
 * `requireRecipient`. `lower()` on the column is what makes the lookup agree
 * with the acceptance rule (and with the Seed adapter).
 */
function pendingByEmail(db: EffectDatabase, workspaceId: string, email: string) {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        sql`lower(${workspaceInvitations.email}) = ${normalizeInvitationEmail(email)}`,
        eq(workspaceInvitations.status, 'pending')
      )
    )
}
