import { describe, expect, it } from 'vitest'
import { bookingPartyContinuation, type BookingParty } from './foundations.ts'

const party = (requests: BookingParty['requests']): BookingParty => ({
  id: 'bpt_group',
  bookingSessionId: 'bsn_group',
  shopId: 'shp_one',
  lifecycle: 'active',
  currency: 'RON',
  locale: 'en',
  version: 1,
  requests
})
const complete = (id: string, position: number): BookingParty['requests'][number] => ({
  id,
  bookingPartyId: 'bpt_group',
  position,
  providerPreference: 'any',
  providerId: 'prv_one',
  primaryServiceId: 'svc_one',
  serviceIds: ['svc_one'],
  holdId: `hld_${id}`,
  holdExpiresAt: '2026-07-13T10:00:00.000Z',
  customerAccountId: null,
  customerDetails: { name: 'Guest', email: 'guest@example.com', phone: null },
  startsAt: '2026-07-13T09:00:00.000Z',
  endsAt: '2026-07-13T09:30:00.000Z'
})

describe('Booking Party continuation', () => {
  it('returns the earliest incomplete ordered request and never a later stale step', () => {
    const later = {
      ...complete('brq_later', 2),
      holdId: null,
      startsAt: null,
      endsAt: null
    }
    const earlier = {
      ...complete('brq_earlier', 1),
      primaryServiceId: null,
      serviceIds: [],
      holdId: null,
      startsAt: null,
      endsAt: null
    }
    expect(
      bookingPartyContinuation(party([later, earlier]), '2026-07-12T10:00:00.000Z')
    ).toEqual({
      requestId: 'brq_earlier',
      position: 1,
      step: 'services'
    })
  })

  it('returns null only when every guest request is complete', () => {
    expect(
      bookingPartyContinuation(
        party([complete('brq_one', 0), complete('brq_two', 1)]),
        '2026-07-12T10:00:00.000Z'
      )
    ).toBeNull()
  })

  it('returns to time selection when a previously stored hold has expired', () => {
    expect(
      bookingPartyContinuation(
        party([complete('brq_expired', 0)]),
        '2026-07-13T10:00:00.000Z'
      )
    ).toEqual({ requestId: 'brq_expired', position: 0, step: 'time' })
  })
})
