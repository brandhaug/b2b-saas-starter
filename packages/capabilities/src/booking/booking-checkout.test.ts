import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingCheckout,
  acceptCheckoutPolicy,
  buildCheckoutReview,
  CustomerDetails,
  normalizeCustomerDetails,
  validateCustomerDetailsField,
  resolveCheckoutPolicy,
  emptySeedBookingCheckoutStore,
  SeedBookingCheckout
} from './booking-checkout.ts'
import type { SeedBookingSchedulingStore } from './booking-scheduling.ts'
import type { BookingSession } from './booking-sessions.ts'
import { SeedBookingParties } from './foundation-adapters.ts'
import { SeedPricingQuotes } from '../pricing/adapters.ts'

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

const legacyCheckoutLayer = (store: ReturnType<typeof emptySeedBookingCheckoutStore>) =>
  SeedBookingCheckout(store).pipe(
    Layer.provide(Layer.merge(SeedBookingParties(), SeedPricingQuotes()))
  )

describe('Booking Checkout', () => {
  it('prepares and accepts an exact party quote and policy before review', async () => {
    const store = emptySeedBookingCheckoutStore(scheduling)
    store.policies.push({
      id: 'pol_shop',
      scope: 'shop',
      scopeId: 'shp_one',
      kind: 'checkout',
      version: 3,
      disclosure: 'Cancel up to 24 hours before the appointment.',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      retiredAt: null
    })
    store.policies.push({
      id: 'pol_marketing_shop',
      scope: 'shop',
      scopeId: 'shp_one',
      kind: 'marketing',
      version: 1,
      disclosure: 'Marketing emails are optional.',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      retiredAt: null
    })
    const party = {
      id: 'bpt_one',
      bookingSessionId: 'bsn_one',
      shopId: 'shp_one',
      activeRequestId: 'brq_one',
      lifecycle: 'active' as const,
      currency: 'USD',
      locale: 'en',
      version: 1,
      requests: [
        {
          id: 'brq_one',
          bookingPartyId: 'bpt_one',
          position: 0,
          providerPreference: 'any' as const,
          providerId: 'prv_ava',
          primaryServiceId: 'svc_cut',
          serviceIds: ['svc_cut'],
          holdId: 'hld_one',
          holdExpiresAt: '2026-07-10T09:40:00.000Z',
          customerAccountId: null,
          customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
          startsAt: quote.startsAt,
          endsAt: quote.endsAt
        }
      ]
    }
    scheduling.holds.set('hld_one', {
      ...scheduling.holds.get('hld_one')!,
      bookingRequestId: 'brq_one'
    })
    const layer = SeedBookingCheckout(store).pipe(
      Layer.provide(
        Layer.merge(
          SeedBookingParties(
            [party],
            new Map(),
            new Map(),
            new Map(),
            scheduling.holds
          ),
          SeedPricingQuotes()
        )
      )
    )
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const checkout = yield* BookingCheckout
          const prepared = yield* checkout.prepare(session('bsn_one'), { now })
          const quoted = yield* checkout.acceptQuote(session('bsn_one'), {
            quoteId: prepared.quote!.id,
            now
          })
          yield* checkout.acceptPolicy(session('bsn_one'), {
            policyId: prepared.policy!.id,
            now
          })
          yield* checkout.recordMarketingConsent(session('bsn_one'), {
            bookingRequestId: 'brq_one',
            channel: 'email',
            granted: false,
            now
          })
          const review = yield* checkout.reviewParty(session('bsn_one'), { now })
          store.policies.push({
            ...store.policies[0]!,
            id: 'pol_shop_v4',
            version: 4,
            disclosure: 'Cancel up to 48 hours before the appointment.'
          })
          const rebuilt = yield* checkout.prepare(session('bsn_one'), { now })
          return { quoted, review, rebuilt }
        }),
        layer
      )
    )
    expect(result.quoted.acceptedAt).toBe(now)
    expect(result.rebuilt.policyEligibility).toEqual({
      bookingKind: 'appointment',
      depositRequired: false
    })
    expect(result.review).toMatchObject({
      readyToConfirm: true,
      policyAcceptance: { policyId: 'pol_shop', version: 3 },
      marketingConsents: [{ bookingRequestId: 'brq_one', granted: false }]
    })
    expect(result.rebuilt).toMatchObject({
      quote: { version: 2, acceptedAt: null },
      policy: { id: 'pol_shop_v4', version: 4 },
      policyAcceptance: { policyId: 'pol_shop', version: 3 }
    })
  })
  it('normalizes Customer Details and reports stable field error codes', async () => {
    expect(
      validateCustomerDetailsField({
        field: 'phone',
        value: '',
        required: true,
        defaultCountry: 'RO'
      })
    ).toBe('phone_invalid')
    expect(
      validateCustomerDetailsField({
        field: 'phone',
        value: '+40722123456',
        required: true,
        defaultCountry: 'RO'
      })
    ).toBeNull()
    await expect(
      Effect.runPromise(
        normalizeCustomerDetails(
          {
            name: '  Mia   Popescu ',
            email: ' MIA@Example.COM ',
            phone: '0722 123 456'
          },
          'RO'
        )
      )
    ).resolves.toEqual({
      name: 'Mia Popescu',
      email: 'mia@example.com',
      phone: '+40722123456'
    })

    await expect(
      Effect.runPromise(
        normalizeCustomerDetails({ name: ' ', email: 'bad', phone: '12' }, 'RO')
      )
    ).rejects.toMatchObject(
      expect.objectContaining({
        _tag: 'CustomerDetailsInvalid',
        issues: [
          { field: 'name', code: 'name_required' },
          { field: 'email', code: 'email_invalid' },
          { field: 'phone', code: 'phone_invalid' }
        ]
      })
    )
  })

  it('resolves the most specific active Checkout Policy and snapshots it once', () => {
    const policies = [
      {
        id: 'pol_merchant',
        scope: 'merchant' as const,
        scopeId: 'mer_mara',
        kind: 'checkout',
        version: 1,
        disclosure: 'Merchant terms',
        effectiveAt: '2026-01-01T00:00:00.000Z',
        retiredAt: null
      },
      {
        id: 'pol_brand',
        scope: 'brand' as const,
        scopeId: 'brd_mara',
        kind: 'checkout',
        version: 2,
        disclosure: 'Brand terms',
        effectiveAt: '2026-01-01T00:00:00.000Z',
        retiredAt: null
      },
      {
        id: 'pol_shop',
        scope: 'shop' as const,
        scopeId: 'shp_central',
        kind: 'checkout',
        version: 3,
        disclosure: 'Shop terms',
        effectiveAt: '2026-01-01T00:00:00.000Z',
        retiredAt: null
      }
    ]
    const resolved = resolveCheckoutPolicy(policies, {
      merchantId: 'mer_mara',
      brandId: 'brd_mara',
      shopId: 'shp_central',
      now
    })!
    expect(resolved).toMatchObject({ id: 'pol_shop', version: 3 })
    const accepted = acceptCheckoutPolicy(resolved, now)
    expect(
      acceptCheckoutPolicy(
        { ...resolved, version: 4, disclosure: 'New terms' },
        '2026-07-12T11:00:00.000Z',
        accepted
      )
    ).toEqual({
      policyId: 'pol_shop',
      version: 4,
      disclosure: 'New terms',
      acceptedAt: '2026-07-12T11:00:00.000Z'
    })
  })

  it('requires every request, accepted quote, and policy acceptance in party review', async () => {
    const policy = {
      id: 'pol_one',
      scope: 'shop' as const,
      scopeId: 'shp_one',
      kind: 'checkout',
      version: 1,
      disclosure: 'Terms',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      retiredAt: null
    }
    await expect(
      Effect.runPromise(
        buildCheckoutReview({
          requests: [
            { id: 'brq_one', complete: true },
            { id: 'brq_two', complete: false }
          ],
          acceptedQuote: { id: 'pqt_one', acceptedAt: now },
          policy,
          policyAcceptance: {
            policyId: 'pol_one',
            version: 1,
            disclosure: 'Terms',
            acceptedAt: now
          },
          marketingConsents: []
        })
      )
    ).rejects.toMatchObject({ reason: 'request_incomplete' })

    await expect(
      Effect.runPromise(
        buildCheckoutReview({
          requests: [
            { id: 'brq_one', complete: true },
            { id: 'brq_two', complete: true }
          ],
          acceptedQuote: { id: 'pqt_one', acceptedAt: now },
          policy,
          policyAcceptance: {
            policyId: 'pol_one',
            version: 1,
            disclosure: 'Terms',
            acceptedAt: now
          },
          marketingConsents: [
            {
              bookingRequestId: 'brq_one',
              channel: 'email',
              granted: false,
              policyVersion: 'marketing:v1',
              disclosure: 'Marketing emails are optional.',
              recordedAt: now
            }
          ]
        })
      )
    ).resolves.toMatchObject({ readyToConfirm: true, acceptedQuote: { id: 'pqt_one' } })
  })

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
        legacyCheckoutLayer(store)
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
      phone: '+15550100100'
    })
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingCheckout, (checkout) =>
            checkout.saveCustomerDetails(
              session('bsn_one'),
              { name: 'Mia', email: 'mia@example.com', phone: '+15550100100' },
              { now: '2026-07-10T09:40:00.000Z' }
            )
          )
        ),
        legacyCheckoutLayer(store)
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
