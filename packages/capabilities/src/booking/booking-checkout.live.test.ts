import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  brands,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessions,
  checkoutPolicies,
  Database,
  layerFromD1,
  merchants,
  providers,
  services,
  shops,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingCheckout, LiveBookingCheckout } from './booking-checkout.ts'
import { LiveBookingParties } from './foundation-adapters.ts'
import { LivePricingQuotes } from '../pricing/adapters.ts'
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
        yield* db.insert(brands).values({
          id: 'brd_checkout_live',
          merchantId: 'mer_checkout_live',
          name: 'Checkout Live',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_checkout_live',
          brandId: 'brd_checkout_live',
          merchantId: 'mer_checkout_live',
          slug: 'central',
          publicName: 'Central',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(services).values({
          id: 'svc_snapshot',
          merchantId: 'mer_checkout_live',
          name: 'Cut',
          description: '',
          category: 'Hair',
          status: 'active',
          durationMinutes: 60,
          priceMinor: 5000,
          currency: 'USD',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(checkoutPolicies).values({
          id: 'pol_checkout_live',
          shopId: 'shp_checkout_live',
          merchantId: null,
          brandId: null,
          scope: 'shop',
          scopeId: 'shp_checkout_live',
          kind: 'checkout',
          version: 3,
          disclosure: 'Cancel up to 24 hours before the appointment.',
          effectiveAt: '2026-01-01T00:00:00.000Z',
          retiredAt: null,
          createdAt: now
        })
        yield* db.insert(checkoutPolicies).values({
          id: 'pol_marketing_live',
          shopId: 'shp_checkout_live',
          merchantId: null,
          brandId: null,
          scope: 'shop',
          scopeId: 'shp_checkout_live',
          kind: 'marketing',
          version: 1,
          disclosure: 'Marketing emails are optional.',
          effectiveAt: '2026-01-01T00:00:00.000Z',
          retiredAt: null,
          createdAt: now
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
        yield* db.insert(bookingParties).values({
          id: 'bpt_live_one',
          bookingSessionId: 'bsn_live_one',
          shopId: 'shp_checkout_live',
          activeRequestId: 'brq_live_one',
          lifecycle: 'active',
          currency: 'USD',
          locale: 'en',
          version: 1,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(bookingRequests).values({
          id: 'brq_live_one',
          bookingPartyId: 'bpt_live_one',
          position: 0,
          providerPreference: 'any',
          providerId: 'prv_snapshot',
          primaryServiceId: 'svc_snapshot',
          holdId: 'hld_bsn_live_one',
          startsAt: quote.startsAt,
          endsAt: quote.endsAt,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(bookingRequestServices).values({
          bookingRequestId: 'brq_live_one',
          serviceId: 'svc_snapshot',
          role: 'primary',
          position: 0,
          createdAt: now
        })
        yield* db
          .update(timeSlotHolds)
          .set({
            bookingRequestId: 'brq_live_one'
          })
          .where(eq(timeSlotHolds.id, 'hld_bsn_live_one'))
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Checkout', () => {
  it('persists contacts per session and reads immutable hold quote facts', async () => {
    const database = layerFromD1(test.d1)
    const dependencies = Layer.merge(
      LiveBookingParties.pipe(Layer.provide(database)),
      LivePricingQuotes.pipe(Layer.provide(database))
    )
    const layer = LiveBookingCheckout.pipe(
      Layer.provide(dependencies),
      Layer.provide(database)
    )
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

  it('persists exact quote, policy acceptance, and person-specific consent for review', async () => {
    const database = layerFromD1(test.d1)
    const dependencies = Layer.merge(
      LiveBookingParties.pipe(Layer.provide(database)),
      LivePricingQuotes.pipe(Layer.provide(database))
    )
    const layer = LiveBookingCheckout.pipe(
      Layer.provide(dependencies),
      Layer.provide(database)
    )
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const checkout = yield* BookingCheckout
          yield* checkout.saveCustomerDetails(
            session('bsn_live_one'),
            { name: 'Mia', email: 'mia@example.com', phone: null },
            { now }
          )
          const prepared = yield* checkout.prepare(session('bsn_live_one'), { now })
          yield* checkout.acceptQuote(session('bsn_live_one'), {
            quoteId: prepared.quote!.id,
            now
          })
          yield* checkout.acceptPolicy(session('bsn_live_one'), {
            policyId: prepared.policy!.id,
            now
          })
          yield* checkout.recordMarketingConsent(session('bsn_live_one'), {
            bookingRequestId: 'brq_live_one',
            channel: 'email',
            granted: false,
            now
          })
          return yield* checkout.reviewParty(session('bsn_live_one'), { now })
        }),
        layer
      )
    )
    expect(result).toMatchObject({
      readyToConfirm: true,
      acceptedQuote: { acceptedAt: now },
      policyAcceptance: {
        policyId: 'pol_checkout_live',
        disclosure: 'Cancel up to 24 hours before the appointment.'
      },
      marketingConsents: [{ bookingRequestId: 'brq_live_one', granted: false }]
    })
  })
})
