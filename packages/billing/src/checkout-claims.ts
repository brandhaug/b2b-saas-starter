import { type billingCheckoutClaims } from '@b2b-saas-starter/db/schema/billing'
import { type BillingCheckoutStatus } from '@b2b-saas-starter/db/enums'

/**
 * The owner of the `billing_checkout_claims.status` machine (ADR 0077).
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `billing_checkout_claims_workspace_open_idx` is the partial unique index
 *   holding one open claim per workspace over exactly
 *   `openCheckoutClaimStatuses` (migration `20260907080000_billing_reliability`).
 * - the `workspace_deletion_fences` triggers refuse deletion while a claim is
 *   `pending` or `created` (migration `20261024202744_strong_captain_america`),
 *   and `workspaceDeletionAllowed` re-checks the same set.
 */

/** Claim statuses that still hold the workspace's single checkout slot. */
export const openCheckoutClaimStatuses: ReadonlyArray<BillingCheckoutStatus> = [
  'pending',
  'created'
]

/** The status a new claim is born with before any provider session exists. */
export const initialCheckoutClaimStatus: BillingCheckoutStatus = 'pending'

export function isOpenCheckoutClaim(status: BillingCheckoutStatus): boolean {
  return openCheckoutClaimStatuses.includes(status)
}

/** Provider evidence that moves a claim; the column is written only through these. */
export type CheckoutClaimEvent =
  | { readonly kind: 'provider_session_created' }
  | { readonly kind: 'provider_session_completed' }
  | { readonly kind: 'provider_session_expired' }
  | { readonly kind: 'provider_absence_verified' }

/**
 * The declared transition map: the status each piece of provider evidence
 * produces from each stored status. `null` refuses the evidence — terminal
 * statuses never move. Open statuses accept any provider evidence: a session
 * that expired before its claim was recorded still expires the claim, and
 * verified provider absence (`failureReason: verified_no_customer` /
 * `verified_no_session`) expires a claim the provider never accepted.
 */
const checkoutClaimTransitions = {
  pending: {
    provider_session_created: 'created',
    provider_session_completed: 'completed',
    provider_session_expired: 'expired',
    provider_absence_verified: 'expired'
  },
  created: {
    provider_session_created: 'created',
    provider_session_completed: 'completed',
    provider_session_expired: 'expired',
    provider_absence_verified: 'expired'
  },
  completed: {
    provider_session_created: null,
    provider_session_completed: null,
    provider_session_expired: null,
    provider_absence_verified: null
  },
  expired: {
    provider_session_created: null,
    provider_session_completed: null,
    provider_session_expired: null,
    provider_absence_verified: null
  }
} as const satisfies Record<
  BillingCheckoutStatus,
  Record<CheckoutClaimEvent['kind'], BillingCheckoutStatus | null>
>

/** Applies one piece of provider evidence; `null` refuses it. */
export function nextCheckoutClaimStatus(
  status: BillingCheckoutStatus,
  event: CheckoutClaimEvent
): BillingCheckoutStatus | null {
  return checkoutClaimTransitions[status][event.kind]
}

/**
 * Maps a provider session state to its claim event. Provider responses carry
 * plain strings, so any state outside the recoverable vocabulary (`open`,
 * `complete`, `expired` — the three states `retrieveStripeCheckoutSession`
 * distinguishes) refuses: recovery cannot classify it.
 */
export function checkoutClaimEventFromSessionStatus(
  status: string
): CheckoutClaimEvent | null {
  if (status === 'open') {
    return { kind: 'provider_session_created' }
  }
  if (status === 'complete') {
    return { kind: 'provider_session_completed' }
  }
  if (status === 'expired') {
    return { kind: 'provider_session_expired' }
  }
  return null
}

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
 * are authoritative on retries; request URLs, and quantity changes are
 * ignored for the same plan and price. A pending claim with no session is retryable
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
  if (existing.planId !== input.planId || existing.priceId !== input.priceId) {
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
