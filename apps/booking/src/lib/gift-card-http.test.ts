import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  handleGiftCardRequest,
  type GiftCardHttpDependencies
} from './gift-card-http.ts'

const receipt = {
  sale: {
    id: 'gcs_one',
    status: 'issued',
    shopId: 'shp_one',
    giftCardProductId: 'gcp_one',
    amountMinor: 5000,
    currency: 'USD',
    purchaser: { name: 'Alex', email: 'alex@example.com' },
    recipient: { name: 'Sam', email: 'sam@example.com' },
    paymentId: 'pay_one'
  },
  card: {
    id: 'gcd_one',
    status: 'active',
    currency: 'USD',
    scope: 'shop',
    scopeId: 'shp_one',
    initialValueMinor: 5000,
    balanceMinor: 5000
  }
} as const
const dependencies = (): GiftCardHttpDependencies => ({
  resolveSelection: vi.fn(() =>
    Effect.succeed({
      merchantId: 'mer_one',
      brandId: 'brd_one',
      shopId: 'shp_one'
    })
  ),
  listProducts: vi.fn(() => Effect.succeed([])),
  purchase: vi.fn(() =>
    Effect.succeed({
      state: 'issued',
      receipt,
      access: {
        routeId: 'gcr_one',
        token: 'secret',
        expiresAt: '2026-08-12T00:00:00.000Z'
      }
    } as const)
  ),
  receiptState: vi.fn(() => Effect.succeed({ state: 'issued', receipt } as const)),
  exchangeReceiptAccess: vi.fn(() => Effect.void),
  hashToken: vi.fn((token) => Effect.succeed(`hash:${token}`)),
  now: () => '2026-07-12T00:00:00.000Z'
})

describe('Gift Card HTTP boundary', () => {
  it('leaves unrelated routes to the rest of the Booking router', async () => {
    await expect(
      handleGiftCardRequest(
        new Request('https://booking.test/mara/booking/services'),
        dependencies()
      )
    ).resolves.toBeNull()
  })

  it('purchases through the canonical route and returns a protected receipt URL', async () => {
    const deps = dependencies()
    const response = await handleGiftCardRequest(
      new Request('https://booking.test/mara/booking/downtown/any/gift-cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          giftCardProductId: 'gcp_one',
          amountMinor: 5000,
          currency: 'USD',
          purchaser: { name: 'Alex', email: 'alex@example.com' },
          recipient: { name: 'Sam', email: 'sam@example.com' },
          method: 'card',
          paymentMethodReference: 'pm_one',
          idempotencyKey: 'submit-one'
        })
      }),
      deps
    )
    expect(response?.status).toBe(201)
    await expect(response?.json()).resolves.toMatchObject({
      receiptUrl: '/mara/booking/gift-card-sales/gcr_one?token=secret'
    })
  })

  it('exchanges the token for a purpose-limited HttpOnly cookie and removes it from the URL', async () => {
    const deps = dependencies()
    const response = await handleGiftCardRequest(
      new Request(
        'https://booking.test/mara/booking/gift-card-sales/gcr_one?token=secret'
      ),
      deps
    )
    expect(response?.status).toBe(303)
    expect(response?.headers.get('location')).toBe(
      '/mara/booking/gift-card-sales/gcr_one'
    )
    expect(response?.headers.get('set-cookie')).toMatch(
      /HttpOnly; Secure; SameSite=Lax/
    )
    expect(deps.exchangeReceiptAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: 'gcr_one',
        presentedTokenHash: 'hash:secret'
      })
    )
    expect(response?.headers.get('set-cookie')).not.toContain('secret')
  })

  it('returns a neutral response when receipt capability is absent', async () => {
    const response = await handleGiftCardRequest(
      new Request('https://booking.test/mara/booking/gift-card-sales/gcr_one'),
      dependencies()
    )
    expect(response?.status).toBe(404)
    expect(await response?.text()).not.toContain('gcs_one')
  })

  it('preserves needs-configuration instead of reporting invalid input', async () => {
    const deps = {
      ...dependencies(),
      purchase: vi.fn(() =>
        Effect.fail({
          _tag: 'GiftCardSaleConflict',
          code: 'payment_method_unavailable'
        })
      )
    }
    const response = await handleGiftCardRequest(
      new Request('https://booking.test/mara/booking/downtown/any/gift-cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          giftCardProductId: 'gcp_one',
          amountMinor: 5000,
          currency: 'USD',
          purchaser: { name: 'Alex', email: 'alex@example.com' },
          recipient: { name: 'Sam', email: 'sam@example.com' },
          method: 'card',
          paymentMethodReference: 'pm_one',
          idempotencyKey: 'submit-one'
        })
      }),
      deps
    )
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({
      error: 'gift_card_payment_needs_configuration'
    })
  })
})
