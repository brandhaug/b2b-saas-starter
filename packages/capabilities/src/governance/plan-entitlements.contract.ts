import { Effect, Result } from 'effect'
import { type CapabilityUnavailable, EntitlementExceeded } from '../errors.ts'
import {
  ENTITLEMENT_RESOURCES,
  limitFor,
  PLANS,
  type EntitlementResource,
  PlanEntitlements
} from './plan-entitlements.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * The plan-entitlement contract, written once and run against both adapters.
 *
 * Same reasoning as the other contracts: capabilities invariant 4 says Seed and
 * Live must satisfy the same interface, and matching TypeScript types do not
 * prove it. `index.test.ts` runs these against `SeedPlanEntitlements` with no
 * D1; `live-layers.test.ts` runs them against `LivePlanEntitlements` on a real
 * one.
 *
 * The harnesses plant one workspace on the `starter` plan whose usage is
 * DECLARED_USED below — under the limit for every resource except
 * AT_LIMIT_RESOURCE, which sits exactly at its limit so the denial half of the
 * matrix is reachable through the same interface on both sides.
 */
export const AT_LIMIT_RESOURCE: EntitlementResource = 'webhook_endpoints'
export const STARTER_WEBHOOK_ENDPOINT_LIMIT = PLANS.starter[AT_LIMIT_RESOURCE]

/** Usage every harness plants, keyed by resource. Written down once. */
export const DECLARED_USED = {
  api_tokens: 2,
  webhook_endpoints: STARTER_WEBHOOK_ENDPOINT_LIMIT,
  members: 4
} satisfies Record<EntitlementResource, number>

export type PlanEntitlementContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | EntitlementExceeded,
    PlanEntitlements | WorkspaceContext
  >
}

/** The slice of vitest's `expect` these cases use — narrow on purpose. */
export type ContractExpect = <A>(actual: A) => {
  readonly toBe: (expected: A) => void
  readonly toEqual: (expected: A) => void
}

export function planEntitlementContractCases(
  expect: ContractExpect
): readonly PlanEntitlementContractCase[] {
  return [
    {
      name: 'reports declared usage under the limit',
      assert: Effect.gen(function* () {
        const entitlements = yield* PlanEntitlements
        const snapshot = yield* entitlements.checkLimit('api_tokens')
        expect(snapshot.planId).toBe('starter')
        expect(snapshot.resource).toBe('api_tokens')
        expect(snapshot.used).toBe(DECLARED_USED.api_tokens)
        expect(snapshot.limit).toBe(limitFor('starter', 'api_tokens'))
      }).pipe(Effect.asVoid)
    },
    {
      name: 'fails EntitlementExceeded when the resource sits at its limit',
      assert: Effect.gen(function* () {
        const entitlements = yield* PlanEntitlements
        // `Effect.flip` would put the success type in the error channel; a
        // refusal is asserted through `Effect.result` instead.
        const result = yield* Effect.result(entitlements.checkLimit(AT_LIMIT_RESOURCE))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isSuccess(result)) return
        const error = result.failure
        expect(error._tag).toBe('EntitlementExceeded')
        expect(error instanceof EntitlementExceeded && error.resource).toBe(
          AT_LIMIT_RESOURCE
        )
        expect(error instanceof EntitlementExceeded && error.limit).toBe(
          STARTER_WEBHOOK_ENDPOINT_LIMIT
        )
      }).pipe(Effect.asVoid)
    },
    {
      name: 'lists a usage snapshot for every entitled resource',
      assert: Effect.gen(function* () {
        const entitlements = yield* PlanEntitlements
        const snapshots = yield* entitlements.usage
        expect(snapshots.map((snapshot) => snapshot.resource)).toEqual([
          ...ENTITLEMENT_RESOURCES
        ])
        for (const snapshot of snapshots) {
          expect(snapshot.used).toBe(DECLARED_USED[snapshot.resource])
          expect(snapshot.limit).toBe(limitFor('starter', snapshot.resource))
        }
      }).pipe(Effect.asVoid)
    }
  ]
}
