import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingCheckout,
  CustomerDetails,
  emptySeedBookingCheckoutStore,
  SeedBookingCheckout
} from './booking-checkout.ts'
import type { SeedBookingSchedulingStore } from './booking-scheduling.ts'
import type { BookingSession } from './booking-sessions.ts'

const now = '2026-07-10T09:30:00.000Z'
const session = (id: string): BookingSession => ({
  id,
  merchantSlug: 'mara',
  checkoutPath: 'pay_in_person',
  lifecycle: 'active',
  createdAt: now,
  lastActivityAt: now,
  idleExpiresAt: '2026-07-10T10:00:00.000Z',
  absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
})
const quote = {
  startsAt: '2026-07-13T09:00:00.000Z',
  endsAt: '2026-07-13T10:00:00.000Z',
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
  services: [
    {
      id: 'svc_cut',
      role: 'primary' as const,
      name: 'Cut',
      durationMinutes: 60,
      priceMinor: 5000,
      currency: 'USD'
    }
  ],
  durationMinutes: 60,
  currency: 'USD',
  totalMinor: 5000
}

const scheduling = {
  holds: new Map([
    [
      'hld_one',
      {
        id: 'hld_one',
        merchantId: 'mer_mara',
        bookingSessionId: 'bsn_one',
        providerId: 'prv_ava',
        startsAt: quote.startsAt,
        endsAt: quote.endsAt,
        createdAt: now,
        expiresAt: '2026-07-10T09:40:00.000Z',
        quote
      }
    ]
  ])
} as unknown as SeedBookingSchedulingStore

describe('Booking Checkout', () => {
  it('validates required unverified details and preserves server-owned review facts', async () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomerDetails)({
        name: '',
        email: 'not-email',
        phone: null
      })
    ).toThrow()
    const store = emptySeedBookingCheckoutStore(scheduling)
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingCheckout, (checkout) =>
          checkout.saveCustomerDetails(
            session('bsn_one'),
            { name: 'Mia', email: 'mia@example.com', phone: null },
            { now }
          )
        ),
        SeedBookingCheckout(store)
      )
    )
    expect(result).toEqual({
      customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
      checkoutPath: 'pay_in_person',
      holdExpiresAt: '2026-07-10T09:40:00.000Z',
      quote
    })
  })

  it('does not link repeated contacts across sessions and rejects an expired hold', async () => {
    const store = emptySeedBookingCheckoutStore(scheduling)
    store.details.set('bsn_other', {
      name: 'Other Person',
      email: 'mia@example.com',
      phone: '+1 555 0100'
    })
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingCheckout, (checkout) =>
            checkout.saveCustomerDetails(
              session('bsn_one'),
              { name: 'Mia', email: 'mia@example.com', phone: '+1 555 0100' },
              { now: '2026-07-10T09:40:00.000Z' }
            )
          )
        ),
        SeedBookingCheckout(store)
      )
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'CheckoutUnavailable', reason: 'hold_expired' }
    })
    expect(store.details.get('bsn_other')?.name).toBe('Other Person')
    expect(store.details.has('bsn_one')).toBe(false)
  })
})
