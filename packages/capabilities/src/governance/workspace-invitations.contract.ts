import { Effect, Option } from 'effect'
import { type ContractExpect } from './contract-expect.ts'
import { type MembershipChangeRejected } from '../errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { failureTag } from '../internal/failure-tag.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceInvitations } from './workspace-invitations.ts'
import { WorkspaceMembership } from './workspace-membership.ts'

/**
 * The invitation contract, written once and run against both adapters.
 *
 * Same reasoning as `workspace-membership.contract.ts`: capabilities invariant
 * 4 says Seed and Live must satisfy the same interface, and matching TypeScript
 * types do not prove it. `index.test.ts` runs these against
 * `SeedWorkspaceInvitations` with no D1; `workspace-invitations.live.test.ts` runs the same
 * list against `LiveWorkspaceInvitations` on a real one.
 *
 * The cases assert only what both adapters can honestly promise. Timestamps and
 * generated ids are deliberately absent: the adapters mint them differently.
 */

/**
 * The expiry a planted invitation must carry to count as expired.
 *
 * `@effect/vitest`'s `it.effect` supplies a `TestClock` starting at epoch 0, so
 * "now" inside every case below is 1970-01-01. A realistic-looking past date
 * such as 2020 is fifty years in that clock's *future*, and an expiry case
 * built on one passes for the wrong reason — or, as it did here first, fails.
 * Both harnesses plant this value so the reason is written down once.
 */
export const CONTRACT_EXPIRED_AT = '1969-12-31T00:00:00.000Z'

/**
 * The counterpart: an expiry comfortably ahead of the same `TestClock`. A
 * harness planting an invitation the cases are meant to accept uses this rather
 * than reading a clock, so what "not expired" means stays a literal.
 */
export const CONTRACT_UNEXPIRED_AT = '2099-01-01T00:00:00.000Z'

/**
 * The three creation stamps the ordering case's planted invitations carry,
 * oldest first. Fixed literals rather than clock reads, so "newest" means the
 * same thing in a `TestClock` case and against a real D1.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const CONTRACT_ORDER_CREATED_AT = [
  '2026-06-01T00:00:00.000Z',
  '2026-06-02T00:00:00.000Z',
  '2026-06-03T00:00:00.000Z'
] as const

export type InvitationContractIds = {
  /**
   * A fresh invitee address per case. Both adapters refuse a second pending
   * invitation to an address that already has one, so cases must not share.
   */
  readonly emailFor: (slot: string) => string
  /**
   * A user who exists but holds no membership. The accept cases invite this
   * address and then accept as this user id, which is the whole point of the
   * accept path: the person accepting is not a member until they do.
   */
  readonly accepter: { readonly userId: string; readonly email: string }
  /**
   * An invitation the harness planted already past its expiry, pending in every
   * other respect. No case can age one from inside the interface, so both
   * harnesses plant it out of band.
   *
   * It carries its own address rather than the accepter's: both adapters refuse
   * a second pending invitation to an address that already has one, so sharing
   * would block every other case — and the expiry case would then be refused
   * for the wrong reason.
   */
  readonly expired: {
    readonly invitationId: string
    readonly email: string
  }
  /**
   * Three invitations the harness planted with distinct, ascending
   * `createdAt` stamps, named here newest-first. No case may create or settle
   * them: they exist so the ordering case has rows whose relative age both
   * adapters agree on. `create` cannot supply them, because neither adapter
   * lets a caller state a creation time and both clocks tick too coarsely
   * for three calls in a row to differ.
   */
  readonly orderedNewestFirst: ReadonlyArray<string>
}

export type InvitationContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceInvitations | WorkspaceMembership | WorkspaceContext | AuditEventLog
  >
}

export function workspaceInvitationsContractCases(
  ids: InvitationContractIds,
  expect: ContractExpect
): ReadonlyArray<InvitationContractCase> {
  return [
    {
      name: 'creates a pending invitation that then appears in list',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const email = ids.emailFor('create')

        const created = yield* invitations.create({ email, role: 'member' })
        expect(created.email).toBe(email)
        expect(created.role).toBe('member')
        expect(created.status).toBe('pending')

        const listed = yield* invitations.list
        expect(listed.some((each) => each.id === created.id)).toBe(true)
      })
    },
    {
      // An address is the invitation's identity, and `requireRecipient`
      // reads it case insensitively — so whatever decides "already invited"
      // has to as well, or one person holds two pending invitations and
      // either one lets them in. D1's default TEXT collation is BINARY, so
      // this is a real divergence, not a theoretical one.
      name: 'refuses a second pending invitation to the same address in another case',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const address = ids.emailFor('casing')
        const created = yield* invitations.create({
          email: address.toUpperCase(),
          role: 'member'
        })

        const outcome = yield* Effect.exit(
          invitations.create({ email: address, role: 'member' })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')

        // And exactly one pending invitation exists for it, whichever case
        // the caller asks in.
        const pending: Array<string> = []
        for (const invitation of yield* invitations.list) {
          if (
            invitation.status === 'pending' &&
            invitation.email.toLowerCase() === address.toLowerCase()
          ) {
            pending.push(invitation.id)
          }
        }
        expect(pending).toEqual([created.id])

        yield* invitations.cancel({ invitationId: created.id })
      })
    },
    {
      name: 'cancels a pending invitation, which then lists as canceled',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const created = yield* invitations.create({
          email: ids.emailFor('cancel'),
          role: 'member'
        })

        yield* invitations.cancel({ invitationId: created.id })

        const listed = yield* invitations.list
        expect(listed.find((each) => each.id === created.id)?.status).toBe('canceled')
      })
    },
    {
      name: 'refuses to cancel an invitation this workspace does not have',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const outcome = yield* Effect.exit(
          invitations.cancel({ invitationId: 'inv_does_not_exist' })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')
      })
    },
    {
      name: 'accepting adds the invitee as a member with the invited role',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const membership = yield* WorkspaceMembership
        const created = yield* invitations.create({
          email: ids.accepter.email,
          role: 'admin'
        })

        const accepted = yield* invitations.accept({
          invitationId: created.id,
          userId: ids.accepter.userId,
          email: ids.accepter.email
        })
        expect(accepted.role).toBe('admin')

        // The membership is the point of accepting; the invitation record
        // moving to `accepted` is the bookkeeping around it.
        const members = yield* membership.listMembers
        expect(members.find((each) => each.id === ids.accepter.userId)?.role).toBe(
          'admin'
        )

        const listed = yield* invitations.list
        expect(listed.find((each) => each.id === created.id)?.status).toBe('accepted')

        yield* membership.removeMember({ userId: ids.accepter.userId })
      })
    },
    {
      name: 'refuses an invitation addressed to a different person',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const created = yield* invitations.create({
          email: ids.emailFor('wrong-recipient'),
          role: 'member'
        })

        const outcome = yield* Effect.exit(
          invitations.accept({
            invitationId: created.id,
            userId: ids.accepter.userId,
            email: ids.accepter.email
          })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')
      })
    },
    {
      name: 'refuses a second acceptance of the same invitation',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const membership = yield* WorkspaceMembership
        const created = yield* invitations.create({
          email: ids.accepter.email,
          role: 'member'
        })
        yield* invitations.accept({
          invitationId: created.id,
          userId: ids.accepter.userId,
          email: ids.accepter.email
        })

        const outcome = yield* Effect.exit(
          invitations.accept({
            invitationId: created.id,
            userId: ids.accepter.userId,
            email: ids.accepter.email
          })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')

        yield* membership.removeMember({ userId: ids.accepter.userId })
      })
    },
    {
      name: 'finds an invitation by id, with the workspace it belongs to',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const email = ids.emailFor('find')
        const created = yield* invitations.create({ email, role: 'member' })

        const found = yield* invitations.find(created.id)
        if (Option.isNone(found)) {
          expect('none').toBe('some')
          return
        }
        expect(found.value.email).toBe(email)
        expect(found.value.role).toBe('member')
        expect(found.value.status).toBe('pending')
        // The workspace rides along because the accept page has only the id: it
        // cannot name a workspace it is not yet allowed to look up by slug.
        expect(found.value.workspaceSlug.length > 0).toBe(true)
        expect(found.value.workspaceName.length > 0).toBe(true)
      })
    },
    {
      name: 'finds nothing for an invitation id that does not exist',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const found = yield* invitations.find('inv_never_existed')
        expect(Option.isNone(found)).toBe(true)
      })
    },
    {
      name: 'refuses an invitation that has expired',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const membership = yield* WorkspaceMembership

        // Accepted as the right recipient, so expiry is the only thing left to
        // refuse it for.
        const outcome = yield* Effect.exit(
          invitations.accept({
            invitationId: ids.expired.invitationId,
            userId: ids.accepter.userId,
            email: ids.expired.email
          })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')

        // A refused acceptance must leave no membership behind.
        const members = yield* membership.listMembers
        expect(members.some((each) => each.id === ids.accepter.userId)).toBe(false)
      })
    },
    {
      name: 'refuses an invitation that was cancelled before it was accepted',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const membership = yield* WorkspaceMembership
        const created = yield* invitations.create({
          email: ids.accepter.email,
          role: 'member'
        })
        yield* invitations.cancel({ invitationId: created.id })

        const outcome = yield* Effect.exit(
          invitations.accept({
            invitationId: created.id,
            userId: ids.accepter.userId,
            email: ids.accepter.email
          })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')

        const members = yield* membership.listMembers
        expect(members.some((each) => each.id === ids.accepter.userId)).toBe(false)
      })
    },
    {
      // `list` promises newest-first. Membership in the list is not the
      // promise — a Seed adapter returning insertion order and a Live one
      // with no `ORDER BY` both satisfy a `some()` assertion while handing
      // the settings page a different roster of invitations.
      name: 'lists invitations newest first',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const listed = yield* invitations.list
        const planted = new Set(ids.orderedNewestFirst)
        const seen: Array<string> = []
        for (const invitation of listed) {
          if (planted.has(invitation.id)) {
            seen.push(invitation.id)
          }
        }
        expect(seen).toEqual([...ids.orderedNewestFirst])
      })
    },
    {
      // One audit case for the whole mutation family, mirroring the
      // `api_token.revoked` case in the developer-platform contract: each
      // delta is counted around this case's own mutations and scoped by the
      // invitation id they produced.
      name: 'invitation mutations record workspace_invitation audit events',
      assert: Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const membership = yield* WorkspaceMembership
        const log = yield* AuditEventLog
        function countOf(eventType: string) {
          return Effect.map(log.list({ eventType }), (page) => page.items.length)
        }

        const sentBefore = yield* countOf('workspace_invitation.sent')
        const created = yield* invitations.create({
          email: ids.emailFor('audit'),
          role: 'member'
        })
        const sentPage = yield* log.list({ eventType: 'workspace_invitation.sent' })
        expect(sentPage.items.length).toBe(sentBefore + 1)
        expect(
          sentPage.items.some(
            (event) =>
              event.targetId === created.id &&
              event.targetType === 'workspace_invitation'
          )
        ).toBe(true)

        const canceledBefore = yield* countOf('workspace_invitation.canceled')
        yield* invitations.cancel({ invitationId: created.id })
        expect(yield* countOf('workspace_invitation.canceled')).toBe(canceledBefore + 1)

        // Acceptance is audited too — against the invitation it settled.
        const acceptedBefore = yield* countOf('workspace_invitation.accepted')
        const accepted = yield* invitations.create({
          email: ids.accepter.email,
          role: 'member'
        })
        yield* invitations.accept({
          invitationId: accepted.id,
          userId: ids.accepter.userId,
          email: ids.accepter.email
        })
        expect(yield* countOf('workspace_invitation.accepted')).toBe(acceptedBefore + 1)

        yield* membership.removeMember({ userId: ids.accepter.userId })
      })
    }
  ]
}
