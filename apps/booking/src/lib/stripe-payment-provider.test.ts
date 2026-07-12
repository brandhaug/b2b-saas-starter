import { describe, expect, it, vi } from 'vitest'
import { makeStripePaymentProvider } from './stripe-payment-provider.ts'

const sign = async (body: string, timestamp: number, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${body}`)
    )
  )
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Stripe payment provider adapter', () => {
  it('uses provider idempotency and returns capture facts without domain leakage', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        id: 'pi_stripe',
        url: 'https://checkout.stripe.com/c/pay/cs_test'
      })
    )
    const adapter = makeStripePaymentProvider({ secretKey: 'sk_test', fetch })
    const response = await adapter.fetch(
      new Request('https://payment-provider.invalid/settle', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: 'pay_one',
          attemptId: 'pat_one',
          amountMinor: 5000,
          currency: 'USD',
          paymentMethodReference: 'hosted_checkout',
          method: 'card',
          returnUrl:
            'https://example.test/mara/booking/session/bsn_one?payment_return=1',
          idempotencyKey: 'submit_one'
        })
      })
    )
    expect(await response.json()).toMatchObject({
      outcome: 'processing',
      nextActionUrl: 'https://checkout.stripe.com/c/pay/cs_test'
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/checkout/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ 'idempotency-key': 'submit_one' })
      })
    )
  })

  it('verifies callback signatures before normalizing reconciliation facts', async () => {
    const timestamp = 1_783_859_200
    const secret = 'whsec_test'
    const body = JSON.stringify({
      id: 'evt_one',
      type: 'payment_intent.succeeded',
      created: timestamp,
      data: {
        object: {
          id: 'pi_one',
          amount_received: 5000,
          currency: 'usd',
          metadata: { payment_id: 'pay_one' }
        }
      }
    })
    const signature = await sign(body, timestamp, secret)
    const adapter = makeStripePaymentProvider({
      secretKey: 'sk_test',
      webhookSecret: secret,
      now: () => timestamp * 1000
    })
    const response = await adapter.fetch(
      new Request('https://payment-provider.invalid/verify-callback', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
        body
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      paymentId: 'pay_one',
      providerEventId: 'evt_one',
      facts: [{ kind: 'capture', amountMinor: 5000 }]
    })
  })
})
