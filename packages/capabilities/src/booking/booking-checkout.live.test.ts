import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bookingSessions,
  Database,
  layerFromD1,
  merchants,
  providers,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingCheckout, LiveBookingCheckout } from './booking-checkout.ts'
import type { BookingSession } from './booking-sessions.ts'

let test: TestD1
const now = '2026-07-10T09:30:00.000Z'
const session = (id: string): BookingSession => ({
  id,
  merchantSlug: 'checkout-live',
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
  assignedProvider: { id: 'prv_snapshot', displayName: 'Ava' },
  services: [
    {
      id: 'svc_snapshot',
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

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_checkout_live',
          publicName: 'Checkout Live',
          slug: 'checkout-live',
          timezone: 'UTC',
          currency: 'USD',
          plan: 'solo',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values({
          id: 'prv_snapshot',
          merchantId: 'mer_checkout_live',
          displayName: 'Ava',
          status: 'active',
          isDefault: true,
          createdAt: now,
          updatedAt: now
        })
        for (const id of ['bsn_live_one', 'bsn_live_two']) {
          yield* db.insert(bookingSessions).values({
            id,
            merchantId: 'mer_checkout_live',
            capabilityHash: id.padEnd(64, '0'),
            checkoutPath: 'pay_in_person',
            lifecycle: 'active',
            createdAt: now,
            lastActivityAt: now,
            idleExpiresAt: '2026-07-10T10:00:00.000Z',
            absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
          })
          yield* db.insert(timeSlotHolds).values({
            id: `hld_${id}`,
            merchantId: 'mer_checkout_live',
            bookingSessionId: id,
            providerId: 'prv_snapshot',
            startsAt: quote.startsAt,
            endsAt: quote.endsAt,
            createdAt: now,
            expiresAt: '2026-07-10T09:40:00.000Z',
            quote
          })
        }
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Checkout', () => {
  it('persists contacts per session and reads immutable hold quote facts', async () => {
    const layer = LiveBookingCheckout.pipe(Layer.provide(layerFromD1(test.d1)))
    const save = (id: string, name: string) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingCheckout, (checkout) =>
            checkout.saveCustomerDetails(
              session(id),
              { name, email: 'same@example.com', phone: '+15550100100' },
              { now }
            )
          ),
          layer
        )
      )
    const [first, second] = await Promise.all([
      save('bsn_live_one', 'Mia'),
      save('bsn_live_two', 'Noah')
    ])
    expect(first.customerDetails.name).toBe('Mia')
    expect(second.customerDetails.name).toBe('Noah')
    expect(first).toMatchObject({
      checkoutPath: 'pay_in_person',
      quote: { totalMinor: 5000, assignedProvider: { id: 'prv_snapshot' } }
    })
  })
})
