import { DateTime, Effect } from 'effect'
import { apiTokens, webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { PlanLimitExceeded } from './errors.ts'

import { WorkspaceContext } from './ports.ts'
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

/** Current replacement leaves count for both admission and execution. */
export function eligibleTokenWhere(workspaceId: string, now: string) {
  return and(
    eq(apiTokens.workspaceId, workspaceId),
    isNull(apiTokens.revokedAt),
    isNull(apiTokens.replacedByTokenId),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now))
  )
}

/** Prepare the named policy for use inside the resource's insert statement. */
export const prepareResourceAdmission = Effect.fn('ResourceAdmission.prepare')(
  function* (resource: EntitlementResource) {
    const ctx = yield* WorkspaceContext
    const billing = yield* Billing
    const plan = yield* billing.currentPlan
    const limit = limitFor(plan, resource)
    const now = DateTime.formatIso(yield* DateTime.now)
    let used = sql`(select count(*) from ${webhookEndpoints} where ${webhookEndpoints.workspaceId} = ${ctx.workspace.id})`
    if (resource === 'api_token') {
      used = sql`(select count(*) from ${apiTokens} where ${eligibleTokenWhere(ctx.workspace.id, now)})`
    }
    let condition = sql`true`
    if (limit !== null) {
      condition = sql`${used} < ${limit}`
    }
    return {
      condition,
      rejected: new PlanLimitExceeded({ planId: plan.id, resource, limit: limit ?? 0 })
    }
  }
)
