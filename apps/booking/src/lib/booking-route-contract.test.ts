import { describe, expect, it } from 'vitest'
import {
  buildCanonicalBookingPath,
  canonicalizeBookingRequest,
  matchCanonicalBookingRoute
} from './booking-route-contract.ts'

describe('canonical Booking path building', () => {
  it.each([
    [{ kind: 'shop-selection', merchantSlug: 'mara' } as const, '/mara/booking'],
    [
      { kind: 'provider-selection', merchantSlug: 'mara', shopSlug: 'main' } as const,
      '/mara/booking/main'
    ],
    [
      {
        kind: 'service-selection',
        merchantSlug: 'mara',
        shopSlug: 'main',
        providerSlug: 'ava'
      } as const,
      '/mara/booking/main/ava/services'
    ],
    [
      {
        kind: 'additional-service-selection',
        merchantSlug: 'mara',
        shopSlug: 'main',
        providerSlug: 'ava',
        serviceSlug: 'cut'
      } as const,
      '/mara/booking/main/ava/services/cut'
    ],
    [
      {
        kind: 'schedule',
        merchantSlug: 'mara',
        shopSlug: 'main',
        providerSlug: 'ava',
        serviceSlug: 'cut'
      } as const,
      '/mara/booking/main/ava/services/cut/schedule'
    ],
    [
      { kind: 'checkout', merchantSlug: 'mara', sessionId: 'bsn_123' } as const,
      '/mara/booking/session/bsn_123/checkout'
    ]
  ])('builds $kind', (input, expected) => {
    expect(buildCanonicalBookingPath(input)).toBe(expected)
  })
})

describe('canonical Booking route contract', () => {
  it.each([
    ['/mara/booking', 'shop-selection'],
    ['/mara/booking/downtown', 'provider-selection'],
    ['/mara/booking/downtown/any/services', 'service-selection'],
    [
      '/mara/booking/downtown/ava/services/signature-cut',
      'additional-service-selection'
    ],
    ['/mara/booking/downtown/ava/services/signature-cut/schedule', 'schedule'],
    ['/mara/booking/session/bsn_123/checkout', 'checkout'],
    ['/mara/booking/confirmations/confirmation_123', 'confirmation'],
    [
      '/mara/booking/confirmations/confirmation_123/appointments/appointment_123/cancel',
      'appointment-cancellation'
    ],
    ['/mara/booking/confirmations/confirmation_123/cancel', 'party-cancellation'],
    ['/mara/booking/downtown/any/gift-cards', 'gift-card-purchase'],
    ['/mara/booking/gift-card-sales/sale_123', 'gift-card-receipt'],
    ['/mara/booking/waiting-list/offer_123', 'waiting-list-offer'],
    ['/mara/booking/downtown/walk-ins', 'walk-in-landing'],
    ['/mara/booking/downtown/any/services/signature-cut/walk-in', 'walk-in-service'],
    ['/mara/booking/downtown/walk-ins/entry_123', 'walk-in-acknowledgment'],
    [
      '/mara/booking/confirmations/confirmation_123/appointments/appointment_123/reschedule',
      'reschedule'
    ]
  ] as const)('recognizes %s as %s', (pathname, kind) => {
    expect(matchCanonicalBookingRoute(pathname)).toMatchObject({ kind })
  })

  it('rejects placeholder and malformed path segments instead of guessing intent', () => {
    for (const pathname of [
      '/mara/booking/downtown/ANY/services',
      '/mara/booking/downtown/ava/services/',
      '/mara/booking/downtown/%2F/services',
      '/mara/booking/downtown/ava/services/cut/unknown'
    ]) {
      expect(matchCanonicalBookingRoute(pathname)).toBeNull()
    }
  })

  it('normalizes safe syntax and retains only typed, canonical query inputs', () => {
    const result = canonicalizeBookingRequest(
      new URL(
        'https://booking.test/Mara/Booking/Downtown/ANY/Services/?locale=FR-ca&embed=widget&utm_source=Google&utm_campaign=Summer&gclid=abc&rwg_token=xyz&date=tomorrow&customer=secret'
      )
    )

    expect(result).toEqual({
      canonicalUrl:
        '/mara/booking/downtown/any/services?locale=fr&embed=widget&utm_source=Google&utm_campaign=Summer&gclid=abc&rwg_token=xyz',
      changed: true,
      locale: 'fr',
      embedding: 'widget',
      acquisition: {
        gclid: 'abc',
        rwg_token: 'xyz',
        utm_campaign: 'Summer',
        utm_source: 'Google'
      },
      bookingLocator: null
    })
  })

  it('accepts the Romanian locale, Google embedding, and a non-secret locator', () => {
    const result = canonicalizeBookingRequest(
      new URL(
        'https://booking.test/mara/booking?booking=bsn_tab_two&locale=ro&embed=google'
      )
    )

    expect(result).toMatchObject({
      changed: false,
      locale: 'ro',
      embedding: 'google',
      bookingLocator: 'bsn_tab_two'
    })
  })

  it('accepts the booking-first merchant landing alias', () => {
    expect(matchCanonicalBookingRoute('/booking/mara-booking-studio')).toEqual({
      kind: 'shop-selection',
      merchantSlug: 'mara-booking-studio',
      pathname: '/booking/mara-booking-studio',
      transactional: false,
      shopSlug: undefined,
      serviceSlug: undefined
    })
    expect(
      canonicalizeBookingRequest(
        new URL('https://booking.test/booking/Mara-Booking-Studio?booking=bsn_alias')
      )
    ).toMatchObject({
      canonicalUrl: '/booking/mara-booking-studio?booking=bsn_alias',
      changed: true,
      bookingLocator: 'bsn_alias'
    })
  })
})
