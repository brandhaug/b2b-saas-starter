import { type EffectDatabase } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { count, type SQL } from 'drizzle-orm'
import { type SQLiteTable } from 'drizzle-orm/sqlite-core'

import { PlanLimitExceeded, type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/**
 * The plan catalog and the entitlement gate over it. Deliberately free of any
 * provider import: the mutating capabilities in `developer-platform/` need the
 * gate, and pulling the Stripe client into their dependency graph to reach it
 * would be a lie about what they talk to. `billing.ts` and `stripe.ts` import
 * this module; it imports neither.
 */

/**
 * How a plan bills its workspace. `flat` is one fixed subscription regardless
 * of headcount, capped by its included seats; `per_seat` bills one seat price
 * per Member, so the provider subscription item's quantity mirrors the
 * workspace's member count (see `billing.ts`'s seat sync).
 */
export type PlanPricing = 'flat' | 'per_seat'

/**
 * A plan in the catalog. A constant, not a service method: plans are part of
 * the starter's vocabulary (the public pricing page and the workspace billing
 * page render the same list), and no database table owns them. `planId` on a
 * workspace row is the entitlement state; this catalog gives that id a shape.
 */
export type Plan = {
  readonly id: string
  readonly name: string
  readonly price: string
  readonly description: string
  /** How the plan bills: one flat subscription, or one seat price per Member. */
  readonly pricing: PlanPricing
  /**
   * Per-resource entitlement ceilings. `null` means unlimited. The starter
   * plan carries real numbers so entitlement gating is demonstrable without a
   * provider; paid plans do not constrain.
   */
  readonly limits: {
    readonly apiTokens: number | null
    readonly webhookEndpoints: number | null
    /**
     * Members included before a `flat` plan asks for an upgrade. `null` means
     * unlimited. A `per_seat` plan carries `null` too — it bills every Member
     * as one seat instead of capping them.
     */
    readonly seats: number | null
  }
  /**
   * The Stripe price env var the deploy must configure for this plan, or
   * `null` when the plan has no self-serve checkout — Starter needs none and
   * Enterprise is sold. It lives on the plan record rather than in a second
   * table keyed by plan id so a new plan cannot be half-declared.
   */
  readonly stripePriceEnv: string | null
  /**
   * How a workspace moves onto this plan: `self_serve` is the in-product
   * checkout, `downgrade` goes through the provider's subscription flow, and
   * `sales` is sold outside the product. On the record so the billing UI asks
   * the plan instead of branching on its id.
   */
  readonly purchase: 'self_serve' | 'downgrade' | 'sales'
}

/** The free tier every workspace starts on and every downgrade lands on. */
export const STARTER_PLAN: Plan = {
  id: 'starter',
  name: 'Starter',
  price: '$0',
  description: 'Local development and reference implementation review.',
  pricing: 'flat',
  limits: { apiTokens: 2, webhookEndpoints: 1, seats: 3 },
  stripePriceEnv: null,
  purchase: 'downgrade'
}

export const PLANS: ReadonlyArray<Plan> = [
  STARTER_PLAN,
  {
    id: 'team',
    name: 'Team',
    price: '$12/seat/mo',
    description: 'The shape most B2B SaaS products adapt first.',
    pricing: 'per_seat',
    limits: { apiTokens: null, webhookEndpoints: null, seats: null },
    stripePriceEnv: 'STRIPE_PRICE_ID_TEAM',
    purchase: 'self_serve'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    description: 'SAML, procurement, custom compliance, and support patterns.',
    pricing: 'flat',
    limits: { apiTokens: null, webhookEndpoints: null, seats: null },
    stripePriceEnv: null,
    purchase: 'sales'
  }
]

/** Resolves a plan from the catalog; unknown ids fall back to Starter. */
export function planById(planId: string): Plan {
  return PLANS.find((plan) => plan.id === planId) ?? STARTER_PLAN
}

/** How one workspace's member count sits against its plan's seat terms. */
export type SeatUsage = {
  /** The plan's billing shape, so the UI words its line accordingly. */
  readonly pricing: PlanPricing
  /** Included seats on a flat plan; `null` when unlimited or billed per seat. */
  readonly included: number | null
  /** The workspace's current member count. */
  readonly used: number
  /**
   * True only on a flat plan with a finite seat ceiling the workspace has
   * passed. Per-seat plans never flag — they bill the extra Member instead.
   */
  readonly overLimit: boolean
}

/**
 * The seat half of the entitlement gate, as a read: the members page renders
 * an upgrade prompt when `overLimit` is true. Deliberately not a hard refusal
 * — a workspace may always add Members; a flat plan past its included seats
 * is asked to upgrade, not blocked (unlike `assertWithinPlanLimit`, which
 * refuses creates at the ceiling).
 */
export function seatUsage(plan: Plan, memberCount: number): SeatUsage {
  const included = plan.limits.seats
  return {
    pricing: plan.pricing,
    included,
    used: memberCount,
    overLimit: plan.pricing === 'flat' && included !== null && memberCount > included
  }
}

/** Entitlement resources a plan can cap. */
export type EntitlementResource = 'api_token' | 'webhook_endpoint'

function limitFor(plan: Plan, resource: EntitlementResource): number | null {
  if (resource === 'api_token') {
    return plan.limits.apiTokens
  }
  return plan.limits.webhookEndpoints
}

/**
 * Entitlement gate over the workspace in context. Pure composition — it reads
 * the resolved workspace's `planId` and compares `used` against the plan's
 * ceiling. The mutating capabilities compose this themselves (counting their
 * own rows), so callers cannot forget the gate and no route handler or server
 * function re-derives the idiom.
 */
export const assertWithinPlanLimit = Effect.fnUntraced(function* (input: {
  readonly resource: EntitlementResource
  readonly used: number
}) {
  const ctx = yield* WorkspaceContext
  const plan = planById(ctx.workspace.planId)
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
}): Effect.Effect<void, CapabilityUnavailable | PlanLimitExceeded, WorkspaceContext> {
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
