import { Schema } from 'effect'
import { PricingPlan } from './billing-records'

export const PlanSchema = Schema.Union([Schema.Null, PricingPlan])

export const LoadPurchaseSchema = Schema.Struct({
  plan: PlanSchema,
  stripeConfigured: Schema.Boolean,
  emailVerificationRequired: Schema.Boolean,
  workspaces: Schema.Array(Schema.Struct({ slug: Schema.String, name: Schema.String }))
})
