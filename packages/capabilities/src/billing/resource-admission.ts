import { type EffectDatabase } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { count, type SQL } from 'drizzle-orm'
import { type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { PlanLimitExceeded, type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
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

/**
 * The entitlement gate with its counting query beside it: counts the rows of
 * `table` matching `where` in the caller's store and asserts the workspace in
 * context is within the plan ceiling. Both mutating capabilities compose this,
 * so the "count active rows → compare against the plan" idiom exists once.
 */
export function assertWithinPlanLimitFor(input: {
  readonly resource: EntitlementResource
  readonly db: EffectDatabase
  /** Which capability name surfaces on a `CapabilityUnavailable` count failure. */
  readonly capability: string
  readonly table: SQLiteTable
  readonly where?: SQL | undefined
}): Effect.Effect<
  void,
  CapabilityUnavailable | PlanLimitExceeded,
  WorkspaceContext | Billing
> {
  return Effect.gen(function* () {
    const rows = yield* orUnavailable(input.capability)(
      input.db.select({ value: count() }).from(input.table).where(input.where)
    )
    yield* assertWithinPlanLimit({
      resource: input.resource,
      used: rows[0]?.value ?? 0
    })
  })
}
