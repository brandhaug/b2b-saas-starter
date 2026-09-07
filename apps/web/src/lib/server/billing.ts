import {
  type BillingLifecycle,
  type BillingSynchronizationStatus,
  type DisplayedPlan
} from '@b2b-saas-starter/capabilities/billing/billing'
import { type ResourceSelectionInput } from '@b2b-saas-starter/capabilities/billing/resource-entitlements'
import { type ResourceEntitlementSummary } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The billing server functions and the billing loader, in a **client-safe**
 * module — the client-safe half of the `billing.effects.ts` split; see
 * apps/web/AGENTS.md for the rule and `scripts/assert-client-boundary.mjs`
 * for the enforcement. Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived types below type
 * both the client stub and the effects handlers.
 */

/**
 * The billing page payload: the workspace's current plan, the catalog, and
 * whether checkout is actually wired. `stripeConfigured` comes from the
 * Billing capability itself — the one definition of "Stripe is configured",
 * the same predicate `startCheckout` enforces — so the page can say "billing
 * is not configured" honestly instead of rendering a button that can only
 * fail.
 */
export type WorkspaceBillingPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly workspaceName: string
  readonly unreadCount: number
  readonly plans: ReadonlyArray<DisplayedPlan>
  /** True when configured provider pricing could not be read or validated. */
  readonly pricingUnavailable: boolean
  readonly currentPlanId: string
  /** True when the Billing capability has its provider wired. */
  readonly stripeConfigured: boolean
  readonly synchronization: BillingSynchronizationStatus
  readonly lifecycle: BillingLifecycle
  readonly resourceSelection: ResourceSelectionInput | null
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlementSummary
    readonly webhookEndpoints: ResourceEntitlementSummary
  }
  readonly apiTokens: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
}

export type PublicPricingPayload = {
  readonly plans: ReadonlyArray<DisplayedPlan>
  readonly pricingUnavailable: boolean
  readonly stripeConfigured: boolean
}

const WorkspaceBillingInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const StartCheckoutInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  planId: Schema.NonEmptyString
})

const PortalInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})
const SelectResourcesInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  apiTokenIds: Schema.Array(Schema.NonEmptyString),
  webhookEndpointIds: Schema.Array(Schema.NonEmptyString)
})

export type WorkspaceBillingInput = typeof WorkspaceBillingInput.Type
export type StartCheckoutInput = typeof StartCheckoutInput.Type
export type PortalInput = typeof PortalInput.Type
export type SelectResourcesInput = typeof SelectResourcesInput.Type

/** The billing route's loader. */
export const loadWorkspaceBillingServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(WorkspaceBillingInput))
  .handler(async ({ data }): Promise<WorkspaceBillingPayload> => {
    const { loadWorkspaceBillingHandler } = await import('./billing.effects')
    return loadWorkspaceBillingHandler(data)
  })

export const loadPublicPricingServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicPricingPayload> => {
    const { loadPublicPricingHandler } = await import('./billing.effects')
    return loadPublicPricingHandler()
  }
)

export const startCheckoutServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(StartCheckoutInput))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startCheckoutHandler } = await import('./billing.effects')
    return startCheckoutHandler(data)
  })

export const startPortalSessionServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(PortalInput))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startPortalSessionHandler } = await import('./billing.effects')
    return startPortalSessionHandler(data)
  })

export const selectBillingResourcesServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SelectResourcesInput))
  .handler(async ({ data }): Promise<ResourceSelectionInput> => {
    const { selectBillingResourcesHandler } = await import('./billing.effects')
    return selectBillingResourcesHandler(data)
  })
