import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/purchase'
import { Schema } from 'effect'
import { type DisplayedPlan } from '@b2b-saas-starter/billing/billing'

const PurchaseInput = Schema.Struct({ planId: Schema.Literal('team') })
const PurchaseCheckoutInput = Schema.Struct({
  ...PurchaseInput.fields,
  workspaceSlug: Schema.NonEmptyString
})
export type PurchaseInput = typeof PurchaseInput.Type
export type PurchasePayload = {
  readonly plan: DisplayedPlan | null
  readonly stripeConfigured: boolean
  readonly emailVerificationRequired: boolean
  readonly workspaces: ReadonlyArray<{ readonly slug: string; readonly name: string }>
}

export const Api = HttpApi.make('web-purchase').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post('loadPurchaseServerFn', '/api/web/loadPurchaseServerFn', {
      payload: PurchaseInput,
      success: Responses.loadPurchaseServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'continuePurchaseServerFn',
      '/api/web/continuePurchaseServerFn',
      {
        payload: PurchaseCheckoutInput,
        success: Responses.continuePurchaseServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const continuePurchaseServerFn = dataCall(
  browser,
  PurchaseCheckoutInput,
  (client, payload) => client.calls.continuePurchaseServerFn({ payload })
)
