import { describe, expect, it } from '@effect/vitest'

import {
  decideCheckoutClaim,
  type CheckoutClaim,
  type CheckoutClaimInput
} from './checkout-claims.ts'

const input: CheckoutClaimInput = {
  workspaceId: 'wrk_1',
  planId: 'team',
  priceId: 'price_team',
  quantity: 3,
  successUrl: 'https://example.test/success',
  cancelUrl: 'https://example.test/cancel'
}

function claim(overrides: Partial<CheckoutClaim> = {}): CheckoutClaim {
  return {
    id: 'claim_1',
    workspaceId: input.workspaceId,
    planId: input.planId,
    idempotencyKey: 'checkout-wrk_1-team-v1',
    priceId: input.priceId,
    quantity: input.quantity,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    status: 'pending',
    stripeSessionId: null,
    checkoutUrl: null,
    attemptCount: 1,
    failureReason: null,
    expiresAt: '2026-09-08T00:00:00.000Z',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  }
}

describe('checkout claim decisions', () => {
  it('retries an interrupted pending claim using stored immutable values', () => {
    const result = decideCheckoutClaim(
      { ...input, quantity: 99, successUrl: 'https://attacker.test' },
      claim(),
      '2026-09-07T12:00:00.000Z'
    )
    expect(result.outcome).toBe('retry')
    if (result.outcome === 'retry') {
      expect(result.claim.quantity).toBe(3)
      expect(result.claim.successUrl).toBe('https://example.test/success')
    }
  })

  it('reuses only a created session and blocks a competing plan', () => {
    const created = decideCheckoutClaim(
      input,
      claim({
        status: 'created',
        stripeSessionId: 'cs_1',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/1'
      }),
      '2026-09-07T12:00:00.000Z'
    )
    expect(created).toMatchObject({
      outcome: 'reuse',
      url: 'https://checkout.stripe.com/c/pay/1'
    })

    expect(
      decideCheckoutClaim(
        { ...input, planId: 'enterprise' },
        claim(),
        '2026-09-07T12:00:00.000Z'
      )
    ).toEqual({ outcome: 'conflict', reason: 'checkout_in_progress' })
  })
})
