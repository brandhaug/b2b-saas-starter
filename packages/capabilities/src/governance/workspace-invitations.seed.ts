import { DateTime, Effect, Layer, Option, Ref } from 'effect'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { fabricateSeedMember, type Workspace } from './workspace-identity.ts'
import { type SeedRoster } from './workspace-membership.ts'
import {
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type Invitation,
  type InvitationStatus
} from './workspace-invitations.ts'

/** How long a fixture invitation stays pending — the plugin's own 48 hours. */
const SEED_INVITATION_TTL_MS = 48 * 60 * 60 * 1000

/** Moves a stored fixture invitation to a terminal status. */
function settle(
  store: Ref.Ref<ReadonlyArray<Invitation>>,
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
  store: Ref.Ref<ReadonlyArray<Invitation>>,
  invitationId: string
): Effect.Effect<Invitation, MembershipChangeRejected> {
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
 */
export function SeedWorkspaceInvitations(options: {
  /**
   * The same roster `SeedWorkspaceMembership` serves. Accepting an invitation
   * adds a member, and the two seed adapters must agree about who is one.
   */
  readonly roster: SeedRoster
  /** The fixture workspace every seed invitation belongs to. */
  readonly workspace: Workspace
  readonly seed?: ReadonlyArray<Invitation>
}): Layer.Layer<WorkspaceInvitations> {
  return Layer.effect(WorkspaceInvitations)(
    Effect.gen(function* () {
      const store = yield* Ref.make<ReadonlyArray<Invitation>>(options.seed ?? [])

      return {
        list: Ref.get(store),
        find: (invitationId) =>
          Ref.get(store).pipe(
            Effect.map((rows) => {
              const found = rows.find((row) => row.id === invitationId)
              if (!found) {
                return Option.none()
              }
              return Option.some({
                ...found,
                workspaceSlug: options.workspace.slug,
                workspaceName: options.workspace.name
              })
            })
          ),
        create: (input) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(store)
            const alreadyInvited = current.some(
              (each) => each.email === input.email && each.status === 'pending'
            )
            if (alreadyInvited) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'already_invited' })
              )
            }
            const id = yield* newCapabilityId('inv')
            const now = yield* DateTime.now
            const created: Invitation = {
              id,
              email: input.email,
              role: input.role,
              status: 'pending',
              expiresAt: DateTime.formatIso(
                DateTime.addDuration(now, SEED_INVITATION_TTL_MS)
              )
            }
            yield* Ref.update(store, (rows) => [created, ...rows])
            return created
          }),
        cancel: (input) =>
          Effect.gen(function* () {
            yield* findPending(store, input.invitationId)
            yield* settle(store, input.invitationId, 'canceled')
          }),
        accept: (input) =>
          Effect.gen(function* () {
            const pending = yield* findPending(store, input.invitationId)
            yield* requireRecipient(pending, input.email)
            yield* requireUnexpired(pending)

            yield* settle(store, input.invitationId, 'accepted')
            // No `user` table to join, so the fixture fabricates the identity
            // fields the way `SeedWorkspaceMembership.addMember` does — but the
            // invitation's real address is known, so it rides along.
            const joined = fabricateSeedMember(input.userId, pending.role, input.email)
            yield* Ref.update(options.roster, (current) => [...current, joined])
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
