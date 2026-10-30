import { Option, Schema, SchemaTransformation } from 'effect'
import { SeatUsageSchema } from './membership-records'

export const ReconcileCheckoutReturnSchema = Schema.Struct({
  workspaceId: Schema.String,
  outcome: Schema.Union([
    Schema.Literal('conflict'),
    Schema.Literal('delayed'),
    Schema.Literal('current'),
    Schema.Literal('repaired')
  ]),
  drift: Schema.Array(Schema.String)
})

export const AnnualPriceSchema = Schema.optionalKey(
  Schema.Union([
    Schema.Undefined,
    Schema.Struct({
      amount: Schema.Number,
      currency: Schema.String,
      interval: Schema.Union([Schema.Literal('year'), Schema.Literal('month')])
    })
  ])
)

export const LimitsSchema = Schema.Struct({
  apiTokens: Schema.Union([Schema.Null, Schema.Number]),
  webhookEndpoints: Schema.Union([Schema.Null, Schema.Number]),
  seats: Schema.Union([Schema.Null, Schema.Number])
})

export const AnnualProviderPriceSchema = Schema.Union([
  Schema.Null,
  Schema.Struct({
    amount: Schema.Number,
    currency: Schema.String,
    interval: Schema.Union([Schema.Literal('year'), Schema.Literal('month')])
  })
])

// Omission means no annual quote was read; null means the provider returned no
// quote. The default undefined→null JSON codec would collapse those states.
export const OptionalAnnualProviderPrice = Schema.optionalKey(
  AnnualProviderPriceSchema
).pipe(
  Schema.decodeTo(
    Schema.optional(AnnualProviderPriceSchema),
    SchemaTransformation.transformOptional<
      typeof AnnualProviderPriceSchema.Type | undefined,
      typeof AnnualProviderPriceSchema.Type
    >({
      decode: (value: Option.Option<typeof AnnualProviderPriceSchema.Type>) => value,
      encode: (
        value: Option.Option<typeof AnnualProviderPriceSchema.Type | undefined>
      ) => Option.filter(value, (price) => price !== undefined)
    })
  )
)

export const PricingPlan = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Union([
    Schema.Null,
    Schema.Struct({
      amount: Schema.Number,
      currency: Schema.String,
      interval: Schema.Union([Schema.Literal('year'), Schema.Literal('month')])
    })
  ]),
  annualPrice: AnnualPriceSchema,
  descriptionKey: Schema.Union([
    Schema.Literal('shell_plan_starter_description'),
    Schema.Literal('shell_plan_team_description'),
    Schema.Literal('shell_plan_enterprise_description')
  ]),
  pricing: Schema.Union([Schema.Literal('flat'), Schema.Literal('per_seat')]),
  limits: LimitsSchema,
  stripePriceEnv: Schema.Union([Schema.Null, Schema.String]),
  purchase: Schema.Union([
    Schema.Literal('self_serve'),
    Schema.Literal('downgrade'),
    Schema.Literal('sales')
  ]),
  providerPrice: Schema.Union([
    Schema.Null,
    Schema.Struct({
      amount: Schema.Number,
      currency: Schema.String,
      interval: Schema.Union([Schema.Literal('year'), Schema.Literal('month')])
    })
  ]),
  annualProviderPrice: OptionalAnnualProviderPrice
})

export const PricingPlans = Schema.Array(PricingPlan)

export const LoadPublicPricingSchema = Schema.Struct({
  plans: PricingPlans,
  pricingUnavailable: Schema.Boolean,
  stripeConfigured: Schema.Boolean
})

export const SynchronizationSchema = Schema.Struct({
  status: Schema.Union([
    Schema.Literal('conflict'),
    Schema.Literal('pending'),
    Schema.Literal('delayed'),
    Schema.Literal('current')
  ]),
  lastSyncedAt: Schema.Union([Schema.Null, Schema.String])
})

export const BillingAccessReason = Schema.Union([
  Schema.Literal('active'),
  Schema.Literal('canceled'),
  Schema.Literal('trialing'),
  Schema.Literal('incomplete'),
  Schema.Literal('incomplete_expired'),
  Schema.Literal('past_due'),
  Schema.Literal('unpaid'),
  Schema.Literal('paused'),
  Schema.Literal('grace'),
  Schema.Literal('trial_expired')
])

export const AccessSchema = Schema.Struct({
  planId: Schema.String,
  paid: Schema.Boolean,
  reason: BillingAccessReason,
  endsAt: Schema.Union([Schema.Null, Schema.String])
})

export const BillingLifecycleStatus = Schema.Union([
  Schema.Literal('active'),
  Schema.Literal('canceled'),
  Schema.Literal('trialing'),
  Schema.Literal('incomplete'),
  Schema.Literal('incomplete_expired'),
  Schema.Literal('past_due'),
  Schema.Literal('unpaid'),
  Schema.Literal('paused')
])

export const LifecycleSchema = Schema.Struct({
  access: AccessSchema,
  interval: Schema.Union([
    Schema.Null,
    Schema.Literal('year'),
    Schema.Literal('month')
  ]),
  status: BillingLifecycleStatus,
  planId: Schema.String,
  currentPeriodEnd: Schema.Union([Schema.Null, Schema.String]),
  cancelAtPeriodEnd: Schema.Boolean,
  trialEnd: Schema.Union([Schema.Null, Schema.String]),
  graceEndsAt: Schema.Union([Schema.Null, Schema.String])
})

export const ResourceUsage = Schema.Struct({
  resource: Schema.Union([
    Schema.Literal('api_token'),
    Schema.Literal('webhook_endpoint')
  ]),
  limit: Schema.Union([Schema.Null, Schema.Number]),
  used: Schema.Number,
  eligibleIds: Schema.Array(Schema.String),
  selectedIds: Schema.Array(Schema.String),
  activeIds: Schema.Array(Schema.String),
  paused: Schema.Boolean
})

export const ResourceEntitlementsSchema = Schema.Struct({
  apiTokens: ResourceUsage,
  webhookEndpoints: ResourceUsage
})

export const LoadWorkspaceBillingSchema = Schema.Struct({
  viewer: Schema.Union([
    Schema.Null,
    Schema.Struct({
      role: Schema.Union([
        Schema.Literal('owner'),
        Schema.Literal('admin'),
        Schema.Literal('member')
      ])
    })
  ]),
  workspaceName: Schema.String,
  unreadCount: Schema.Number,
  plans: PricingPlans,
  pricingUnavailable: Schema.Boolean,
  currentPlanId: Schema.String,
  seatUsage: SeatUsageSchema,
  stripeConfigured: Schema.Boolean,
  synchronization: SynchronizationSchema,
  lifecycle: LifecycleSchema,
  resourceSelection: Schema.Union([
    Schema.Null,
    Schema.Struct({
      apiTokenIds: Schema.Array(Schema.String),
      webhookEndpointIds: Schema.Array(Schema.String)
    })
  ]),
  resourceEntitlements: ResourceEntitlementsSchema,
  apiTokens: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  webhookEndpoints: Schema.Array(
    Schema.Struct({ id: Schema.String, url: Schema.String })
  )
})
