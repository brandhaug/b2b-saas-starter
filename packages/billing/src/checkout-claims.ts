import { type billingCheckoutClaims } from '@b2b-saas-starter/db/schema'
/**
 * One `billing_checkout_claims` row: the fields that must stay immutable for
 * a single logical checkout attempt, read straight off the stored shape.
 */
export type CheckoutClaim = typeof billingCheckoutClaims.$inferSelect

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
      readonly outcome: 'reuse'
      readonly claim: CheckoutClaim
      readonly url: string | null
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
    return { outcome: 'reuse', claim: existing, url: existing.checkoutUrl }
  }
  if (existing.status === 'pending') {
    if (Date.parse(now) - Date.parse(existing.createdAt) > 23 * 60 * 60 * 1000) {
      return { outcome: 'conflict', reason: 'checkout_recovery_required' }
    }
    return { outcome: 'retry', claim: existing }
  }
  return { outcome: 'conflict', reason: 'checkout_in_progress' }
}
