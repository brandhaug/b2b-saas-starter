import { Effect } from 'effect'
import { PlanLimitExceeded } from '../errors.ts'
import { Billing } from './billing.ts'
import { limitFor, type EntitlementResource } from './plan-catalog.ts'

export const assertWithinPlanLimit = Effect.fn(
  'ResourceAdmission.assertWithinPlanLimit'
)(function* (input: { readonly resource: EntitlementResource; readonly used: number }) {
  const billing = yield* Billing
  const plan = yield* billing.currentPlan
  const limit = limitFor(plan, input.resource)
  if (limit !== null && input.used >= limit) {
    return yield* Effect.fail(
      new PlanLimitExceeded({
        planId: plan.id,
        resource: input.resource,
        limit
      })
    )
  }
})
