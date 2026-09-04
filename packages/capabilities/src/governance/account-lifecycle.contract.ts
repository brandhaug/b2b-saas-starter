import { Effect } from 'effect'

import { AccountLifecycle } from './account-lifecycle.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { type ContractExpect } from './contract-expect.ts'
import {
  type AccountDeletionBlocked,
  type AccountDeletionRejected,
  type CapabilityUnavailable
} from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'

/**
 * The account-lifecycle contract, written once and run against both adapters
 * — capabilities invariant 4, the same shape as the membership and lifecycle
 * contracts.
 *
 * Every shared case runs against one fixture state both adapters can express:
 * a single workspace holding a sole owner, a plain admin, and a plain member.
 * That state is enough for the two plan shapes every caller depends on
 * (`blocked_sole_owner` and `leave`) and for both refusal paths. The mixed
 * happy path needs a second workspace, which the one-workspace seed fixture
 * cannot express — each adapter's test file covers it against its own
 * throwaway state, like the workspace-lifecycle deletion case.
 */
export type AccountLifecycleContractIds = {
  /** The workspace's only owner, among several members: blocked. */
  readonly stuckOwner: string
  /** A non-owner member of the same workspace: their plan is `leave`. */
  readonly planner: string
  /** The password the adapters accept in `deleteAccount` cases. */
  readonly password: string
  /** A credential the adapters refuse — the seed models the check with the empty string. */
  readonly wrongPassword: ''
}

export type AccountLifecycleContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | AccountDeletionBlocked | AccountDeletionRejected,
    AccountLifecycle | AuditEventLog
  >
}

export function accountLifecycleContractCases(
  ids: AccountLifecycleContractIds,
  expect: ContractExpect
): ReadonlyArray<AccountLifecycleContractCase> {
  return [
    {
      name: 'plans blocked_sole_owner for the only owner of a populated workspace',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        const plan = yield* lifecycle.planDeletion(ids.stuckOwner)
        expect(plan.canDelete).toBe(false)
        expect(plan.steps.length).toBe(1)
        expect(plan.steps[0]?.action).toBe('blocked_sole_owner')
      })
    },
    {
      name: 'plans leave for a non-owner member of a populated workspace',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        const plan = yield* lifecycle.planDeletion(ids.planner)
        expect(plan.canDelete).toBe(true)
        expect(plan.steps.length).toBe(1)
        expect(plan.steps[0]?.action).toBe('leave')
      })
    },
    {
      name: 'refuses the delete of a blocked account and names the workspace',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        const outcome = yield* Effect.exit(
          lifecycle.deleteAccount({ userId: ids.stuckOwner, password: ids.password })
        )
        expect(failureTag(outcome)).toBe('AccountDeletionBlocked')
      })
    },
    {
      name: 'a blocked refusal tears nothing down',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        yield* Effect.ignore(
          lifecycle.deleteAccount({ userId: ids.stuckOwner, password: ids.password })
        )
        const after = yield* lifecycle.planDeletion(ids.stuckOwner)
        // The membership survives, so the user can still go transfer ownership.
        expect(after.steps.length).toBe(1)
        expect(after.steps[0]?.action).toBe('blocked_sole_owner')
      })
    },
    {
      name: 'refuses a delete whose credential fails and tears nothing down',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        const outcome = yield* Effect.exit(
          lifecycle.deleteAccount({ userId: ids.planner, password: ids.wrongPassword })
        )
        expect(failureTag(outcome)).toBe('AccountDeletionRejected')
        // The membership survives: the store checked the password before any
        // teardown ran, which is the whole reason the delete rides the
        // store's own endpoint.
        const after = yield* lifecycle.planDeletion(ids.planner)
        expect(after.steps.length).toBe(1)
      })
    },
    {
      name: 'a refused delete records no account.deleted event',
      assert: Effect.gen(function* () {
        const lifecycle = yield* AccountLifecycle
        const audit = yield* AuditEventLog
        yield* Effect.ignore(
          lifecycle.deleteAccount({ userId: ids.planner, password: ids.wrongPassword })
        )
        const events = yield* audit.listGlobal
        expect(
          events.some(
            (event) =>
              event.eventType === 'account.deleted' && event.targetId === ids.planner
          )
        ).toBe(false)
      })
    }
  ]
}
