import { Effect } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable, type UserAdminRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { PlatformUserAdmin } from './platform-user-admin.ts'

/**
 * The platform-user-admin contract, written once and run against both adapters
 * (capabilities invariant 4): `index.test.ts` against the Seed layer with no
 * D1, `platform-user-admin.live.test.ts` against Live on a real one.
 *
 * The cases assert only what both adapters can honestly promise: ban/unban
 * round-trips through `listUsers`, and a role change reports the new role from
 * its own read-back.
 */

export type UserAdminContractIds = {
  /** A user who exists when each case starts. */
  readonly existing: string
  /** A user who exists as an account but holds no membership in `workspaceId`. */
  readonly outsider: string
  /** A user id that exists nowhere — not as an account, not as a member. */
  readonly unknown: string
  /** The workspace `existing` holds a membership in when each case starts. */
  readonly workspaceId: string
}

export type UserAdminContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | UserAdminRejected,
    PlatformUserAdmin
  >
}

/** The slice of vitest's `expect` these cases use — see `workspace-membership.contract.ts`. */
export type UserAdminContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe'>

export function platformUserAdminContractCases(
  ids: UserAdminContractIds,
  expect: UserAdminContractExpect
): ReadonlyArray<UserAdminContractCase> {
  return [
    {
      name: 'lists every account with its system role',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        const users = yield* admin.listUsers
        const existing = users.find((each) => each.id === ids.existing)
        expect(existing === undefined).toBe(false)
        expect(users.some((each) => each.id === ids.unknown)).toBe(false)
      })
    },
    {
      name: 'bans a user who then reads back banned',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        yield* admin.banUser({ userId: ids.existing, actorUserId: null })

        const users = yield* admin.listUsers
        expect(users.find((each) => each.id === ids.existing)?.banned).toBe(true)

        yield* admin.unbanUser({ userId: ids.existing, actorUserId: null })
      })
    },
    {
      name: 'unban lifts a ban',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        yield* admin.banUser({ userId: ids.existing, actorUserId: null })
        yield* admin.unbanUser({ userId: ids.existing, actorUserId: null })

        const users = yield* admin.listUsers
        expect(users.find((each) => each.id === ids.existing)?.banned).toBe(false)
      })
    },
    {
      name: 'rejects banning an unknown user',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        const outcome = yield* Effect.exit(
          admin.banUser({ userId: ids.unknown, actorUserId: null })
        )
        expect(failureTag(outcome)).toBe('UserAdminRejected')
      })
    },
    {
      name: 'changes a workspace role and reports it from the read-back',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        // The membership this case needs is part of the fixture on both sides:
        // seed memberships and live rows are arranged by the harnesses.
        const changed = yield* admin.changeWorkspaceRole({
          userId: ids.existing,
          workspaceId: ids.workspaceId,
          role: 'admin',
          actorUserId: null
        })
        expect(changed.role).toBe('admin')
      })
    },
    {
      name: 'rejects a role change for a user who is not a member',
      assert: Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        const outcome = yield* Effect.exit(
          admin.changeWorkspaceRole({
            userId: ids.outsider,
            workspaceId: ids.workspaceId,
            role: 'admin',
            actorUserId: null
          })
        )
        expect(failureTag(outcome)).toBe('UserAdminRejected')
      })
    }
  ]
}
