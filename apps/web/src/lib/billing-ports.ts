import {
  type BillingInterval,
  type ResourceSelection
} from '@b2b-saas-starter/billing/plan-catalog'

export type StartCheckout = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly planId: string
    readonly interval?: BillingInterval
  }
}) => Promise<{ url: string }>
export type StartPortalSession = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<{ url: string }>
export type SelectBillingResources = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  }
}) => Promise<ResourceSelection>

/** All mutating billing ports must be replaced together for an action-refusing preview. */
export type BillingPorts = {
  readonly startCheckout: StartCheckout
  readonly startPortalSession: StartPortalSession
  readonly selectBillingResources: SelectBillingResources
}
