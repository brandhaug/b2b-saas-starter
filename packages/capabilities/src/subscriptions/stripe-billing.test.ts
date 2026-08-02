import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { makeStripeBilling } from './stripe-billing.ts'

describe('StripeBilling', () => {
  it('creates a fixed-quantity Solo Checkout that collects billing identity and VAT ID', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ url: 'https://checkout.stripe.test/session' }, { status: 200 })
    )
    const billing = makeStripeBilling({
      secretKey: 'sk_test',
      monthlyPriceId: 'price_monthly',
      annualPriceId: 'price_annual',
      fetch
    })
    const result = await Effect.runPromise(
      billing.createCheckout({
        merchantId: 'mer_1',
        ownerEmail: 'owner@example.test',
        interval: 'annual',
        successUrl: 'https://merchant.test/success',
        cancelUrl: 'https://merchant.test/cancel',
        idempotencyKey: 'checkout_1',
        trialEndsAt: '2099-08-16T12:00:00.000Z'
      })
    )
    expect(result.url).toBe('https://checkout.stripe.test/session')
    const request = fetch.mock.calls[0]![1]!
    expect(request.body).toBeInstanceOf(URLSearchParams)
    const body = request.body as URLSearchParams
    expect(body.get('mode')).toBe('subscription')
    expect(body.get('line_items[0][price]')).toBe('price_annual')
    expect(body.get('line_items[0][quantity]')).toBe('1')
    expect(body.get('billing_address_collection')).toBe('required')
    expect(body.get('tax_id_collection[enabled]')).toBe('true')
    expect(body.has('line_items[0][adjustable_quantity][enabled]')).toBe(false)
    expect(JSON.stringify(request.headers)).not.toContain('team')
  })

  it('returns typed needs-configuration and provider-outage states', async () => {
    const disabled = makeStripeBilling({})
    expect(disabled.state).toBe('needs_configuration')
    await expect(
      Effect.runPromise(
        disabled.createPortal({
          customerRef: 'cus_1',
          returnUrl: 'https://merchant.test',
          idempotencyKey: 'portal_1'
        })
      )
    ).rejects.toMatchObject({ reason: 'billing_not_configured' })

    const outage = makeStripeBilling({
      secretKey: 'sk_test',
      monthlyPriceId: 'price_monthly',
      annualPriceId: 'price_annual',
      fetch: vi.fn(async () => {
        throw new Error('offline')
      })
    })
    await expect(
      Effect.runPromise(
        outage.setScheduledCancellation({
          subscriptionRef: 'sub_1',
          cancelAtPeriodEnd: true,
          idempotencyKey: 'cancel_1'
        })
      )
    ).rejects.toMatchObject({ reason: 'provider_unavailable' })
  })
})
