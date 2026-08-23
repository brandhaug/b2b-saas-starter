import { Effect } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable, type MembershipChangeRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { WorkspaceMembership } from './workspace-membership.ts'

/**
 * The membership contract, written once and run against both adapters.
 *
 * Capabilities invariant 4 says Seed and Live must satisfy the same interface.
 * A prose invariant drifts; these cases do not. `index.test.ts` runs them
 * against `SeedWorkspaceMembership` with no D1, and `live-layers.test.ts` runs
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
    WorkspaceMembership | WorkspaceContext
  >
}

/**
/**
 * The slice of vitest's `expect` these cases use. Narrow on purpose: the cases
 * run under two different test harnesses, and a case that reaches for more of
 * the matcher surface is usually asserting something only one adapter can
 * promise.
 */
export type ContractExpect = <A>(actual: A) => Pick<ContractExpectMatchers<A>, 'toBe'>

export function workspaceMembershipContractCases(
  ids: MembershipContractIds,
  expect: ContractExpect
): readonly MembershipContractCase[] {
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
    }
  ]
}
