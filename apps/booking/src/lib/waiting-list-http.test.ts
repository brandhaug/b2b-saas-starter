import { describe, expect, it, vi } from 'vitest'
import {
  handleWaitingListRequest,
  type WaitingListHttpDependencies
} from './waiting-list-http.ts'

const offer = {
  id: 'avo_1',
  applicationId: 'wla_1',
  status: 'pending' as const,
  slot: {
    shopId: 'shp_1',
    serviceIds: ['svc_1'],
    providerId: 'prv_1',
    startsAt: '2026-07-14T09:00:00.000Z',
    endsAt: '2026-07-14T09:30:00.000Z'
  },
  createdAt: '2026-07-12T12:00:00.000Z',
  expiresAt: '2026-07-13T00:00:00.000Z',
  respondedAt: null,
  bookingSessionId: null
}
const dependencies = (): WaitingListHttpDependencies => ({
  apply: vi.fn(async (input) => ({
    ...input,
    status: 'active' as const,
    createdAt: input.now
  })),
  withdraw: vi.fn(),
  inspectApplication: vi.fn(),
  inspect: vi.fn(async () => offer),
  exchangeOfferAccess: vi.fn(async () => offer),
  decline: vi.fn(async () => ({ ...offer, status: 'declined' as const })),
  accept: vi.fn(async () => ({
    bookingSessionId: 'bsn_1',
    timeSlotHoldId: 'hld_1',
    routeId: 'brt_1',
    capability: 'session-secret',
    purpose: 'new-booking' as const
  })),
  now: () => '2026-07-12T12:00:00.000Z',
  newApplicationId: () => 'wla_1',
  newApplicationCapability: () => 'application-secret',
  newOfferCookieCapability: () => 'cookie-secret',
  authorizeReplacement: vi.fn(async () => {})
})

describe('Waiting List HTTP', () => {
  it('creates an application', async () => {
    const response = await handleWaitingListRequest(
      new Request('https://example.com/shop/booking/waiting-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shopId: 'shp_1',
          request: {
            serviceIds: ['svc_1'],
            providerPreference: { kind: 'any' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-20T00:00:00.000Z'
          },
          customer: { name: 'Ada', email: 'ada@example.com' },
          expiresAt: '2026-07-21T00:00:00.000Z'
        })
      }),
      dependencies()
    )
    expect(response?.status).toBe(201)
    await expect(response?.clone().json()).resolves.toMatchObject({
      id: 'wla_1',
      status: 'active'
    })
  })

  it('exchanges a query capability for an HttpOnly cookie before rendering', async () => {
    const response = await handleWaitingListRequest(
      new Request(
        'https://example.com/shop/booking/waiting-list/wla_1/offers/avo_1?capability=secret'
      ),
      dependencies()
    )
    expect(response?.status).toBe(303)
    expect(response?.headers.get('location')).not.toContain('capability')
    expect(response?.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('accepts from protected cookie access into a session and hold', async () => {
    const response = await handleWaitingListRequest(
      new Request('https://example.com/shop/booking/waiting-list/wla_1/offers/avo_1', {
        method: 'POST',
        headers: { cookie: '__Host-availability-offer-avo_1=secret' }
      }),
      dependencies()
    )
    await expect(response?.clone().json()).resolves.toMatchObject({
      state: 'accepted',
      bookingSessionId: 'bsn_1',
      timeSlotHoldId: 'hld_1'
    })
    expect(await response?.json()).not.toHaveProperty('capability')
    expect(response?.headers.get('set-cookie')).toContain(
      'booking_session_bsn_1=session-secret'
    )
  })

  it('creates replacement applications only from the exact confirmation cookie path', async () => {
    const deps = dependencies()
    const response = await handleWaitingListRequest(
      new Request('https://example.com/shop/booking/confirmations/cnf_1/waiting-list', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'confirmation_cnf_1=confirmation-cookie'
        },
        body: JSON.stringify({
          shopId: 'shp_1',
          request: {
            serviceIds: ['svc_1'],
            providerPreference: { kind: 'any' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-20T00:00:00.000Z',
            replacementAppointmentId: 'apt_1'
          },
          customer: { name: 'Ada', email: 'ada@example.com' },
          expiresAt: '2026-07-21T00:00:00.000Z'
        })
      }),
      deps
    )
    expect(response?.status).toBe(201)
    expect(deps.authorizeReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'apt_1',
        routeId: 'cnf_1',
        cookieCredential: 'confirmation-cookie'
      })
    )
  })
})
