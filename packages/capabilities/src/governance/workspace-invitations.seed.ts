import { DateTime, Effect, Layer, Option, Ref } from 'effect'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import {
  publishSeatSyncWith,
  SeatSyncPublisher
} from '@b2b-saas-starter/billing/seat-sync'
import {
  AuditEventLog,
  recordCompletedAudit,
  recordCompletedMutationAudit
} from './audit-event-log.ts'
import { fabricateSeedMember, type Workspace } from './workspace-identity.ts'
import { type SeedRoster } from './workspace-membership.ts'
import { WorkspaceContext } from '../workspace-context.ts'
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
  type InvitationStatus
} from './workspace-invitations.ts'

/** How long a fixture invitation stays pending — the plugin's own 48 hours. */
const SEED_INVITATION_TTL_MS = 48 * 60 * 60 * 1000

/**
 * A stored fixture invitation. `createdAt` is storage, not wire: the
 * interface promises newest-first, and Live reads that order off the
 * `workspace_invitations.createdAt` column the wire shape does not carry.
 * A fixture row states its own so both adapters can be asked the same
 * ordering question.
 */
export type SeedInvitationRow = Invitation & {
  readonly createdAt: string
}

/** Newest first on `(createdAt, id)` — the order Live's `ORDER BY` produces. */
function newestFirst(left: SeedInvitationRow, right: SeedInvitationRow): number {
  if (left.createdAt !== right.createdAt) {
    if (left.createdAt < right.createdAt) {
      return 1
    }
    return -1
  }
  if (left.id === right.id) {
    return 0
  }
  if (left.id < right.id) {
    return 1
  }
  return -1
}

/** The wire projection: the storage-only `createdAt` never leaves the adapter. */
function toWire(row: SeedInvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt
  }
}

/** Moves a stored fixture invitation to a terminal status. */
function settle(
  store: Ref.Ref<ReadonlyArray<SeedInvitationRow>>,
  invitationId: string,
  status: InvitationStatus
): Effect.Effect<void> {
  return Ref.update(store, (rows) =>
    rows.map((row) => {
      if (row.id !== invitationId) {
        return row
      }
      return { ...row, status }
    })
  )
}

/**
 * The stored invitation, if it is one this workspace can still act on. The
 * "still pending" question is the contract's own `requirePending`, so Seed and
 * Live refuse a settled invitation for the same reason; only the lookup — a
 * `Ref` here, a row there — is the adapter's own.
 */
function findPending(
  store: Ref.Ref<ReadonlyArray<SeedInvitationRow>>,
  invitationId: string
): Effect.Effect<SeedInvitationRow, MembershipChangeRejected> {
  return Ref.get(store).pipe(
    Effect.flatMap((rows) => {
      const found = rows.find((row) => row.id === invitationId)
      if (!found) {
        return Effect.fail(
          new MembershipChangeRejected({ reason: 'invitation_not_pending' })
        )
      }
      return Effect.as(requirePending(found), found)
    })
  )
}

/**
 * In-memory invitations, never Better Auth. The store lives in a `Ref` built
 * per layer construction, so a mutation is observable within the request or
 * test that made it and no state leaks into the next one.
 *
 * Mutations record the same `workspace_invitation.*` audit events the Live
 * adapter records, read ambiently via `Effect.serviceOption`: the Seed
 * composition (`layers.ts`) shares one fixture log so records land where the
 * contract cases read them, while a harness that provides no log simply gets
 * no records.
 */
export function SeedWorkspaceInvitations(options: {
  /**
   * The same roster `SeedWorkspaceMembership` serves. Accepting an invitation
   * adds a member, and the two seed adapters must agree about who is one.
   */
  readonly roster: SeedRoster
  /** The fixture workspace every seed invitation belongs to. */
  readonly workspace: Workspace
  readonly seed?: ReadonlyArray<SeedInvitationRow>
}): Layer.Layer<WorkspaceInvitations, never, SeatSyncPublisher> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const store = yield* Ref.make<ReadonlyArray<SeedInvitationRow>>(
        options.seed ?? []
      )
      const seatSync = yield* SeatSyncPublisher

      return {
        // Scoped and ordered exactly as Live: the fixture holds one
        // workspace's invitations, so the context read is the assertion that
        // it is *this* workspace's — and the sort is the `ORDER BY` the
        // interface promises.
        list: Effect.fn('WorkspaceInvitations.list')(function* () {
          const ctx = yield* WorkspaceContext
          if (ctx.workspace.id !== options.workspace.id) {
            return []
          }
          const rows = yield* Ref.get(store)
          return rows.toSorted(newestFirst).map(toWire)
        })(),
        find: Effect.fn('WorkspaceInvitations.find')((invitationId: string) =>
          Ref.get(store).pipe(
            Effect.map((rows) => {
              const found = rows.find((row) => row.id === invitationId)
              if (!found) {
                return Option.none()
              }
              return Option.some({
                ...toWire(found),
                workspaceId: options.workspace.id,
                workspaceSlug: options.workspace.slug,
                workspaceName: options.workspace.name
              })
            })
          )
        ),
        create: Effect.fn('WorkspaceInvitations.create')(function* (
          input: CreateInvitationInput
        ) {
          const current = yield* Ref.get(store)
          // Case-insensitively, the way `requireRecipient` compares: an
          // address invited as `Ada@x.test` is the same pending invitation as
          // `ada@x.test`, and both the plugin and the Live lookup agree.
          const email = normalizeInvitationEmail(input.email)
          const alreadyInvited = current.some(
            (each) =>
              normalizeInvitationEmail(each.email) === email &&
              each.status === 'pending'
          )
          if (alreadyInvited) {
            return yield* Effect.fail(
              new MembershipChangeRejected({ reason: 'already_invited' })
            )
          }
          const id = yield* newCapabilityId('inv')
          const now = yield* DateTime.now
          const created: SeedInvitationRow = {
            id,
            // Canonical on the way in, matching Live.
            email,
            role: input.role,
            status: 'pending',
            expiresAt: DateTime.formatIso(
              DateTime.addDuration(now, SEED_INVITATION_TTL_MS)
            ),
            createdAt: DateTime.formatIso(now)
          }
          yield* Ref.update(store, (rows) => [created, ...rows])
          // Same event, target, and metadata as the Live adapter.
          const audit = yield* Effect.serviceOption(AuditEventLog)
          if (Option.isSome(audit)) {
            yield* recordCompletedMutationAudit(
              audit.value,
              {
                eventType: 'workspace_invitation.sent',
                targetType: 'workspace_invitation',
                targetId: created.id,
                metadata: { email, role: input.role }
              },
              'workspace_invitations.create'
            )
          }
          return toWire(created)
        }),
        cancel: Effect.fn('WorkspaceInvitations.cancel')(function* (
          input: InvitationRef
        ) {
          const pending = yield* findPending(store, input.invitationId)
          yield* settle(store, input.invitationId, 'canceled')
          const audit = yield* Effect.serviceOption(AuditEventLog)
          if (Option.isSome(audit)) {
            yield* recordCompletedMutationAudit(
              audit.value,
              {
                eventType: 'workspace_invitation.canceled',
                targetType: 'workspace_invitation',
                targetId: input.invitationId,
                metadata: { email: pending.email }
              },
              'workspace_invitations.cancel'
            )
          }
        }),
        accept: Effect.fn('WorkspaceInvitations.accept')(function* (
          input: AcceptInvitationInput
        ) {
          const pending = yield* findPending(store, input.invitationId)
          yield* requireRecipient(pending, input.email)
          yield* requireUnexpired(pending)

          yield* settle(store, input.invitationId, 'accepted')
          // No `user` table to join, so the fixture fabricates the identity
          // fields the way `SeedApiTokenRegistry.create` fabricates a token —
          // but the invitation's real address is known, so it rides along.
          const joined = fabricateSeedMember(input.userId, pending.role, input.email)
          yield* Ref.update(options.roster, (current) => [...current, joined])
          // No `WorkspaceContext` to read, matching Live: the event names the
          // invitation's own workspace and the accepting user directly.
          const audit = yield* Effect.serviceOption(AuditEventLog)
          if (Option.isSome(audit)) {
            yield* recordCompletedAudit(
              audit.value,
              {
                workspaceId: options.workspace.id,
                actorUserId: input.userId,
                actorType: 'user',
                eventType: 'workspace_invitation.accepted',
                targetType: 'workspace_invitation',
                targetId: input.invitationId,
                metadata: { email: pending.email, role: pending.role }
              },
              'workspace_invitations.accept'
            )
          }
          // Acceptance adds a member, so it triggers the same seat sync the
          // membership seed triggers — keyed off the fixture workspace.
          yield* publishSeatSyncWith(seatSync, {
            workspaceId: options.workspace.id,
            reason: 'invitation_accepted'
          })
          return {
            workspaceSlug: options.workspace.slug,
            workspaceName: options.workspace.name,
            role: pending.role
          }
        })
      }
    })
  )
}
