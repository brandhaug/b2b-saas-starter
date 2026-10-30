import { Schema } from 'effect'
import {
  LoadWorkspaceBillingSchema,
  LoadPublicPricingSchema,
  ReconcileCheckoutReturnSchema
} from './billing-records'

export const loadWorkspaceBillingServerFnResponse = LoadWorkspaceBillingSchema
export const loadPublicPricingServerFnResponse = LoadPublicPricingSchema
export const startCheckoutServerFnResponse = Schema.Struct({ url: Schema.String })
export const startPortalSessionServerFnResponse = Schema.Struct({ url: Schema.String })
export const reconcileCheckoutReturnServerFnResponse = ReconcileCheckoutReturnSchema
export const selectBillingResourcesServerFnResponse = Schema.Struct({
  apiTokenIds: Schema.Array(Schema.String),
  webhookEndpointIds: Schema.Array(Schema.String)
})
