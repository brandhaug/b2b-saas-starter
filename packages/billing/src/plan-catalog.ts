import { Schema } from 'effect'

/**
 * How a plan bills its workspace. `flat` is one fixed subscription regardless
 * of headcount, capped by its included seats; `per_seat` bills one seat price
 * per Member, so the provider subscription item's quantity mirrors the
 * workspace's member count (see `billing.ts`'s seat sync).
 */
type PlanPricing = 'flat' | 'per_seat'

/**
 * A plan in the catalog. A constant, not a service method: plans are part of
 * the starter's vocabulary (the public pricing page and the workspace billing
 * page render the same list), and no database table owns them. Billing supplies
 * the deadline-aware current plan; this catalog describes its limits.
 */
export type Plan = {
  readonly id: string
  readonly name: string
  readonly price: { readonly amount: number; readonly currency: string } | null
  readonly descriptionKey:
    | 'shell_plan_starter_description'
    | 'shell_plan_team_description'
    | 'shell_plan_enterprise_description'
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
  price: { amount: 0, currency: 'USD' },
  descriptionKey: 'shell_plan_starter_description',
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
    price: { amount: 12, currency: 'USD' },
    descriptionKey: 'shell_plan_team_description',
    pricing: 'per_seat',
    limits: { apiTokens: null, webhookEndpoints: null, seats: null },
    stripePriceEnv: 'STRIPE_PRICE_ID_TEAM',
    purchase: 'self_serve'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    descriptionKey: 'shell_plan_enterprise_description',
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

/**
 * The durable, user-selected exception to a Starter downgrade.  Selection is
 * deliberately expressed in ids rather than positional indexes: resources
 * stay stored and can be re-selected after an upgrade or another downgrade.
 * The persistence capability owns where this record is stored.
 */
export const ResourceSelection = Schema.Struct({
  apiTokenIds: Schema.Array(Schema.String),
  webhookEndpointIds: Schema.Array(Schema.String)
})
export type ResourceSelection = typeof ResourceSelection.Type

export const EMPTY_RESOURCE_SELECTION: ResourceSelection = {
  apiTokenIds: [],
  webhookEndpointIds: []
}

export type ResourceEntitlement = {
  readonly resource: EntitlementResource
  readonly limit: number | null
  /**
   * How many stored resources the plan ceiling is measured against — the
   * same count creation admission makes, so a workspace refused a create is
   * always a workspace the billing page shows over its limit.
   */
  readonly used: number
  /** The resources that may execute today, before the selection narrows them. */
  readonly eligibleIds: ReadonlyArray<string>
  readonly selectedIds: ReadonlyArray<string>
  readonly activeIds: ReadonlyArray<string>
  /** True when the entire category is paused until a selection is saved. */
  readonly paused: boolean
}

/**
 * Computes effective resource access after a plan change.  This is the one
 * policy used by request and queue boundaries: it never deletes excess rows,
 * allows all resources while within the limit, and pauses the category when
 * an over-limit workspace has not selected its surviving resources.
 */
export function resourceEntitlement(
  plan: Plan,
  resource: EntitlementResource,
  ids: ReadonlyArray<string>,
  selection: ResourceSelection = EMPTY_RESOURCE_SELECTION,
  /**
   * Every stored resource of the category, when admission counts more of
   * them than execution does: webhook admission counts disabled endpoints,
   * dispatch eligibility does not. Defaults to `ids`, which is the api-token
   * case — a revoked or expired token is neither counted nor eligible.
   */
  storedIds: ReadonlyArray<string> = ids
): ResourceEntitlement {
  const limit = limitFor(plan, resource)
  let selectedIds: ReadonlyArray<string>
  if (resource === 'api_token') {
    selectedIds = selection.apiTokenIds
  } else {
    selectedIds = selection.webhookEndpointIds
  }
  const overLimit = limit !== null && storedIds.length > limit
  const availableIds = new Set(ids)
  const validSelection = [...new Set(selectedIds)].filter((id) => availableIds.has(id))
  let activeIds: ReadonlyArray<string>
  if (overLimit) {
    activeIds = validSelection.slice(0, limit)
  } else {
    activeIds = [...ids]
  }
  return {
    resource,
    limit,
    used: storedIds.length,
    eligibleIds: [...ids],
    selectedIds: validSelection,
    activeIds,
    paused: overLimit && activeIds.length === 0
  }
}

/** The UI/API contract for a downgrade that needs an explicit selection. */
export type ResourceEntitlementSummary = ResourceEntitlement & {
  readonly requiresSelection: boolean
}

export function resourceEntitlementSummary(
  plan: Plan,
  resource: EntitlementResource,
  ids: ReadonlyArray<string>,
  selection?: ResourceSelection,
  storedIds?: ReadonlyArray<string>
): ResourceEntitlementSummary {
  const entitlement = resourceEntitlement(plan, resource, ids, selection, storedIds)
  return { ...entitlement, requiresSelection: entitlement.paused }
}

/**
 * The subscription-item quantity one member count bills. Stripe rejects a
 * zero quantity on a licensed per-unit price, and a workspace always has at
 * least the member who owns it, so an empty roster reads as one seat rather
 * than as a checkout or seat sync the provider refuses.
 */
export function billableSeatQuantity(memberCount: number): number {
  return Math.max(1, memberCount)
}

export function limitFor(plan: Plan, resource: EntitlementResource): number | null {
  if (resource === 'api_token') {
    return plan.limits.apiTokens
  }
  return plan.limits.webhookEndpoints
}
