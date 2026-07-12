import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingCheckout,
  acceptCheckoutPolicy,
  buildCheckoutReview,
  createCheckoutTelemetry,
  CustomerDetails,
  normalizeCustomerDetails,
  resolveCheckoutPolicy,
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
  it('normalizes Customer Details and reports stable field error codes', () => {
    expect(
      normalizeCustomerDetails(
        {
          name: '  Mia   Popescu ',
          email: ' MIA@Example.COM ',
          phone: '0722 123 456'
        },
        'RO'
      )
    ).toEqual({
      name: 'Mia Popescu',
      email: 'mia@example.com',
      phone: '+40722123456'
    })

    expect(() =>
      normalizeCustomerDetails({ name: ' ', email: 'bad', phone: '12' }, 'RO')
    ).toThrow(
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

  it('requires every request, accepted quote, and policy acceptance in party review', () => {
    expect(() =>
      buildCheckoutReview({
        requests: [
          { id: 'brq_one', complete: true },
          { id: 'brq_two', complete: false }
        ],
        acceptedQuote: { id: 'pqt_one', acceptedAt: now },
        policyAcceptance: {
          policyId: 'pol_one',
          version: 1,
          disclosure: 'Terms',
          acceptedAt: now
        },
        marketingConsents: []
      })
    ).toThrow(expect.objectContaining({ reason: 'request_incomplete' }))

    expect(
      buildCheckoutReview({
        requests: [
          { id: 'brq_one', complete: true },
          { id: 'brq_two', complete: true }
        ],
        acceptedQuote: { id: 'pqt_one', acceptedAt: now },
        policyAcceptance: {
          policyId: 'pol_one',
          version: 1,
          disclosure: 'Terms',
          acceptedAt: now
        },
        marketingConsents: [
          {
            personId: 'brq_one',
            channel: 'email',
            granted: false,
            policyVersion: 'marketing:v1',
            recordedAt: now
          }
        ]
      })
    ).toMatchObject({ readyToConfirm: true, acceptedQuote: { id: 'pqt_one' } })
  })

  it('uses provider-neutral no-op telemetry and isolates optional provider failures', async () => {
    const noOp = createCheckoutTelemetry()
    await expect(
      noOp.track({ name: 'checkout_reviewed', analyticsConsent: true })
    ).resolves.toBeUndefined()

    const failing = createCheckoutTelemetry({
      analytics: { send: () => Promise.reject(new Error('provider down')) },
      errors: { report: () => Promise.reject(new Error('monitor down')) }
    })
    await expect(
      failing.track({ name: 'checkout_reviewed', analyticsConsent: false })
    ).resolves.toBeUndefined()
    await expect(
      failing.track({ name: 'checkout_reviewed', analyticsConsent: true })
    ).resolves.toBeUndefined()
    await expect(failing.report(new Error('command failed'))).resolves.toBeUndefined()
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
