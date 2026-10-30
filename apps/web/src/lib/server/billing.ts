import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall, readCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/billing'
import { billingIntervals } from '@b2b-saas-starter/db/enums'
import {
  type BillingLifecycle,
  type BillingSynchronizationStatus,
  type ReconcileResult,
  type DisplayedPlan
} from '@b2b-saas-starter/billing/billing'
import {
  type ResourceSelection,
  type ResourceEntitlement,
  type SeatUsage
} from '@b2b-saas-starter/billing/plan-catalog'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

export type WorkspaceBillingPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly workspaceName: string
  readonly unreadCount: number
  readonly plans: ReadonlyArray<DisplayedPlan>

  readonly pricingUnavailable: boolean
  readonly currentPlanId: string

  readonly seatUsage: SeatUsage

  readonly stripeConfigured: boolean
  readonly synchronization: BillingSynchronizationStatus
  readonly lifecycle: BillingLifecycle
  readonly resourceSelection: ResourceSelection | null
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlement
    readonly webhookEndpoints: ResourceEntitlement
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
  interval: Schema.optionalKey(Schema.Literals(billingIntervals)),
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
export type ReconcileCheckout = (input: {
  readonly data: WorkspaceBillingInput
}) => Promise<ReconcileResult>

export const Api = HttpApi.make('web-billing').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceBillingServerFn',
      '/api/web/loadWorkspaceBillingServerFn',
      {
        payload: WorkspaceBillingInput,
        success: Responses.loadWorkspaceBillingServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadPublicPricingServerFn',
      '/api/web/loadPublicPricingServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadPublicPricingServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('startCheckoutServerFn', '/api/web/startCheckoutServerFn', {
      payload: StartCheckoutInput,
      success: Responses.startCheckoutServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'startPortalSessionServerFn',
      '/api/web/startPortalSessionServerFn',
      {
        payload: PortalInput,
        success: Responses.startPortalSessionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'reconcileCheckoutReturnServerFn',
      '/api/web/reconcileCheckoutReturnServerFn',
      {
        payload: WorkspaceBillingInput,
        success: Responses.reconcileCheckoutReturnServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'selectBillingResourcesServerFn',
      '/api/web/selectBillingResourcesServerFn',
      {
        payload: SelectResourcesInput,
        success: Responses.selectBillingResourcesServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceBillingServerFn = dataCall(
  browser,
  WorkspaceBillingInput,
  (client, payload) => client.calls.loadWorkspaceBillingServerFn({ payload })
)

export const loadPublicPricingServerFn = readCall(browser, (client) =>
  client.calls.loadPublicPricingServerFn({ payload: {} })
)

export const startCheckoutServerFn = dataCall(
  browser,
  StartCheckoutInput,
  (client, payload) => client.calls.startCheckoutServerFn({ payload })
)

export const startPortalSessionServerFn = dataCall(
  browser,
  PortalInput,
  (client, payload) => client.calls.startPortalSessionServerFn({ payload })
)

export const reconcileCheckoutReturnServerFn = dataCall(
  browser,
  WorkspaceBillingInput,
  (client, payload) => client.calls.reconcileCheckoutReturnServerFn({ payload })
)

export const selectBillingResourcesServerFn = dataCall(
  browser,
  SelectResourcesInput,
  (client, payload) => client.calls.selectBillingResourcesServerFn({ payload })
)
