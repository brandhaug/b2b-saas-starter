import { Schema } from 'effect'

/** The durable checkout states owned by `billing_checkout_claims`. */
const CheckoutClaimStatus = Schema.Union([
  Schema.Literal('pending'),
  Schema.Literal('created'),
  Schema.Literal('completed'),
  Schema.Literal('expired')
])
export type CheckoutClaimStatus = typeof CheckoutClaimStatus.Type

/** The fields that must stay immutable for one logical checkout attempt. */
export const CheckoutClaim = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  planId: Schema.String,
  idempotencyKey: Schema.String,
  priceId: Schema.String,
  quantity: Schema.Number,
  successUrl: Schema.String,
  cancelUrl: Schema.String,
  status: CheckoutClaimStatus,
  stripeSessionId: Schema.NullOr(Schema.String),
  checkoutUrl: Schema.NullOr(Schema.String),
  attemptCount: Schema.Number,
  failureReason: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type CheckoutClaim = typeof CheckoutClaim.Type

export type CheckoutClaimInput = {
  readonly workspaceId: string
  readonly planId: string
  readonly priceId: string
  readonly quantity: number
  readonly successUrl: string
  readonly cancelUrl: string
}

export type CheckoutClaimDecision =
  | { readonly outcome: 'claim' }
  | {
      readonly outcome: 'retry'
      readonly claim: CheckoutClaim
    }
  | {
      /**
       * The claim already holds a provider session. The caller re-derives the
       * hosted URL from the session it just retrieved: a stored URL can be
       * stale, and only the provider read proves the session is still open.
       */
      readonly outcome: 'reuse'
      readonly claim: CheckoutClaim
    }
  | {
      readonly outcome: 'conflict'
      readonly reason: 'checkout_in_progress' | 'checkout_recovery_required'
    }

/**
 * Decides a workspace checkout without contacting Stripe. Stored claim values
 * are authoritative on retries; request URLs, quantity, and price changes are
 * ignored for the same plan. A pending claim with no session is retryable
 * because Stripe's idempotency layer makes the provider write safe.
 */
export function decideCheckoutClaim(
  input: CheckoutClaimInput,
  existing: CheckoutClaim | undefined,
  now: string
): CheckoutClaimDecision {
  // Claim expiry is only a provider-side hint. An open row may represent a
  // successful Stripe request whose response was lost, so the caller must
  // retrieve its known session before considering a new claim.
  if (existing === undefined) {
    return { outcome: 'claim' }
  }
  if (existing.planId !== input.planId) {
    return { outcome: 'conflict', reason: 'checkout_in_progress' }
  }
  if (existing.status === 'created' && existing.stripeSessionId !== null) {
    return { outcome: 'reuse', claim: existing }
  }
  if (existing.status === 'pending') {
    if (Date.parse(now) - Date.parse(existing.createdAt) > 23 * 60 * 60 * 1000) {
      return { outcome: 'conflict', reason: 'checkout_recovery_required' }
    }
    return { outcome: 'retry', claim: existing }
  }
  return { outcome: 'conflict', reason: 'checkout_in_progress' }
}
