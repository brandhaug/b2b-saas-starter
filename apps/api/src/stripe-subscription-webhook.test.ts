import { describe, expect, it } from 'vitest'
import { verifyStripeSignature } from './stripe-subscription-webhook.ts'

const sign = async (body: string, timestamp: number, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const value = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`)
  )
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('Stripe subscription webhook signature', () => {
  it('accepts the exact signed body inside the replay window', async () => {
    const body = JSON.stringify({ id: 'evt_1' })
    const signature = await sign(body, 1000, 'whsec_test')
    expect(
      await verifyStripeSignature(body, `t=1000,v1=${signature}`, 'whsec_test', 1001)
    ).toBe(true)
    expect(
      await verifyStripeSignature(
        `${body} `,
        `t=1000,v1=${signature}`,
        'whsec_test',
        1001
      )
    ).toBe(false)
  })

  it('rejects valid old signatures outside five minutes', async () => {
    const signature = await sign('{}', 1000, 'whsec_test')
    expect(
      await verifyStripeSignature('{}', `t=1000,v1=${signature}`, 'whsec_test', 1301)
    ).toBe(false)
  })
})
