import { Effect } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable, type MembershipChangeRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { walkKeysetPages } from '../internal/keyset-cursor.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceMembership } from './workspace-membership.ts'

/**
 * The membership contract, written once and run against both adapters.
 *
 * Capabilities invariant 4 says Seed and Live must satisfy the same interface.
 * A prose invariant drifts; these cases do not. `index.test.ts` runs them
 * against `SeedWorkspaceMembership` with no D1, and `workspace-membership.live.test.ts` runs
 * the same list against `LiveWorkspaceMembership` on a real one.
 *
 * The cases assert only what both adapters can honestly promise. Identity
 * fields are deliberately absent: Live joins them from the `user` table, and
 * the fixture has no such table to join.
 */

export type MembershipContractIds = {
  /** A user who already holds a membership when the case starts. */
  readonly member: string
  /** A user who exists but holds no membership. Each case adds them fresh. */
  readonly newcomer: string
  /** A user with no membership that no case ever creates. */
  readonly stranger: string
}

export type MembershipContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceMembership | WorkspaceContext | AuditEventLog
  >
}

/**
/**
 * The slice of vitest's `expect` these cases use. Narrow on purpose: the cases
 * run under two different test harnesses, and a case that reaches for more of
 * the matcher surface is usually asserting something only one adapter can
 * promise.
 */
export type MembershipContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toEqual'>

export function workspaceMembershipContractCases(
  ids: MembershipContractIds,
  expect: MembershipContractExpect
): ReadonlyArray<MembershipContractCase> {
  return [
    {
      name: 'adds a member who then appears in listMembers',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const added = yield* membership.addMember({
          userId: ids.newcomer,
          role: 'member'
        })
        expect(added.id).toBe(ids.newcomer)
        expect(added.role).toBe('member')

        const members = yield* membership.listMembers
        expect(members.some((each) => each.id === ids.newcomer)).toBe(true)

        yield* membership.removeMember({ userId: ids.newcomer })
      })
    },
    {
      name: 'removes a member who then disappears from listMembers',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        yield* membership.addMember({ userId: ids.newcomer, role: 'member' })
        yield* membership.removeMember({ userId: ids.newcomer })

        const members = yield* membership.listMembers
        expect(members.some((each) => each.id === ids.newcomer)).toBe(false)
      })
    },
    {
      name: 'changes a role and reports the new one from listMembers',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        yield* membership.addMember({ userId: ids.newcomer, role: 'member' })

        const changed = yield* membership.changeRole({
          userId: ids.newcomer,
          role: 'admin'
        })
        expect(changed.role).toBe('admin')

        const members = yield* membership.listMembers
        expect(members.find((each) => each.id === ids.newcomer)?.role).toBe('admin')

        yield* membership.removeMember({ userId: ids.newcomer })
      })
    },
    {
      name: 'rejects a role change for a user who is not a member',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const outcome = yield* Effect.exit(
          membership.changeRole({ userId: ids.stranger, role: 'admin' })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')
      })
    },
    {
      name: 'rejects removing a user who is not a member',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const outcome = yield* Effect.exit(
          membership.removeMember({ userId: ids.stranger })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')
      })
    },
    {
      name: 'leaves an existing member untouched by a rejected change',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const before = yield* membership.listMembers
        yield* Effect.ignore(membership.removeMember({ userId: ids.stranger }))
        const after = yield* membership.listMembers

        expect(after.length).toBe(before.length)
        expect(after.some((each) => each.id === ids.member)).toBe(true)
      })
    },
    {
      // One audit case for the whole mutation family, mirroring the
      // `api_token.revoked` case in the developer-platform contract: the
      // deltas are counted around this case's own mutations, so sharing a
      // layer with the cases above cannot flake.
      name: 'membership changes record workspace_member audit events',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const log = yield* AuditEventLog
        function countOf(eventType: string) {
          return Effect.map(log.list({ eventType }), (page) => page.events.length)
        }
        const addedBefore = yield* countOf('workspace_member.added')
        const removedBefore = yield* countOf('workspace_member.removed')
        const roleBefore = yield* countOf('workspace_member.role_changed')

        yield* membership.addMember({ userId: ids.newcomer, role: 'member' })
        yield* membership.changeRole({ userId: ids.newcomer, role: 'admin' })
        yield* membership.removeMember({ userId: ids.newcomer })

        expect(yield* countOf('workspace_member.added')).toBe(addedBefore + 1)
        expect(yield* countOf('workspace_member.removed')).toBe(removedBefore + 1)
        expect(yield* countOf('workspace_member.role_changed')).toBe(roleBefore + 1)
        // Each event names the member it is about, with the target type both
        // adapters write.
        expect(
          (yield* log.list({ eventType: 'workspace_member.added' })).events.some(
            (event) =>
              event.targetId === ids.newcomer && event.targetType === 'workspace_member'
          )
        ).toBe(true)
      })
    },
    {
      // Read-only over the roster, so it stays order-independent however the
      // harness reuses the fixture across cases.
      name: 'member pages walk the roster forward on id with no duplicates',
      assert: Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const whole = (yield* membership.listMembers).map((member) => member.id)
        const walk = yield* walkKeysetPages(
          (input) => membership.listMembersPage(input),
          { limit: 1 }
        )
        // Forward on `id ASC` — no timestamp on the wire shape — and every
        // member of the roster exactly once, matching the whole-collection
        // read the settings page renders.
        const walked = walk.items.map((member) => member.id)
        expect(walk.exhausted).toBe(true)
        expect(walked).toEqual(walked.toSorted())
        expect(walked.toSorted()).toEqual(whole.toSorted())
      })
    }
  ]
}
