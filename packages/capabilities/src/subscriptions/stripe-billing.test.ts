import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { makeStripeBilling, reconciliationEvidence } from './stripe-billing.ts'

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

  it('does not manufacture payment failure from an open invoice', () => {
    expect(
      reconciliationEvidence({
        now: '2026-08-02T12:00:00.000Z',
        subscription: {
          merchantId: 'mer_1',
          ownerUserId: 'usr_1',
          plan: 'solo',
          interval: 'monthly',
          access: 'active',
          price: { amountMinor: 1900, currency: 'EUR', excludesVat: true },
          trialEndsAt: '2026-08-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          providerCustomerRef: 'cus_1',
          providerSubscriptionRef: 'sub_1',
          revision: 2
        },
        snapshot: {
          customerRef: 'cus_1',
          latestInvoice: {
            id: 'in_1',
            status: 'open',
            occurredAt: '2026-08-01T12:00:00.000Z'
          }
        }
      })
    ).toBeUndefined()
  })

  it('voids the failed invoice and immediately cancels during Grace', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        ...(init ? { init } : {})
      })
      return Response.json({ id: 'ok' })
    })
    const billing = makeStripeBilling({
      secretKey: 'sk_test',
      monthlyPriceId: 'price_monthly',
      annualPriceId: 'price_annual',
      fetch
    })
    await Effect.runPromise(
      billing.endGraceSubscription({
        subscriptionRef: 'sub_1',
        invoiceRef: 'in_1',
        idempotencyKey: 'cancel_1'
      })
    )
    expect(requests[0]?.url).toContain('/invoices/in_1/void')
    expect(requests[1]?.init?.method).toBe('DELETE')
  })

  it('schedules an interval change at renewal with fixed Solo quantity', async () => {
    const bodies: URLSearchParams[] = []
    let call = 0
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body instanceof URLSearchParams) bodies.push(init.body)
      call += 1
      if (call === 1)
        return Response.json({
          current_period_start: 1_786_032_000,
          current_period_end: 1_788_710_400,
          items: { data: [{ id: 'si_1', price: { id: 'price_monthly' } }] }
        })
      if (call === 2) return Response.json({ id: 'sub_sched_1' })
      return Response.json({ id: 'sub_sched_1' })
    })
    const billing = makeStripeBilling({
      secretKey: 'sk_test',
      monthlyPriceId: 'price_monthly',
      annualPriceId: 'price_annual',
      fetch
    })
    const evidence = await Effect.runPromise(
      billing.scheduleIntervalChange({
        merchantId: 'mer_1',
        subscription: {
          merchantId: 'mer_1',
          ownerUserId: 'usr_1',
          plan: 'solo',
          interval: 'monthly',
          access: 'active',
          price: { amountMinor: 1900, currency: 'EUR', excludesVat: true },
          trialEndsAt: '2026-08-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          providerCustomerRef: 'cus_1',
          providerSubscriptionRef: 'sub_1',
          revision: 2
        },
        interval: 'annual',
        idempotencyKey: 'interval_1',
        now: '2026-08-02T00:00:00.000Z'
      })
    )
    expect(evidence.kind).toBe('interval-change-scheduled')
    expect(bodies[1]?.get('phases[1][items][0][price]')).toBe('price_annual')
    expect(bodies[1]?.get('phases[1][items][0][quantity]')).toBe('1')
  })
})
