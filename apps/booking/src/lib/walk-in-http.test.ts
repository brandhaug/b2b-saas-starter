import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { handleWalkInRequest } from './walk-in-http.ts'

const entry = {
  id: 'wie_one',
  shopId: 'shp_one',
  status: 'waiting',
  position: 1,
  projectedWaitMinutes: 0,
  serviceId: 'svc_cut',
  providerPreference: { kind: 'any' as const },
  locale: 'en',
  history: [{ from: null, to: 'waiting' as const, occurredAt: '2026-07-12T10:00:00Z' }]
} as const
const dependencies = {
  resolveShop: () => Effect.succeed({ id: 'shp_one' }),
  overview: () =>
    Effect.succeed({
      state: 'open' as const,
      services: [{ id: 'svc_cut', name: 'Signature cut' }],
      providers: [{ id: 'prv_ana', name: 'Ana' }],
      queue: [entry]
    }),
  enroll: () =>
    Effect.succeed({
      entry,
      acknowledgment: {
        capability: 'a'.repeat(64),
        expiresAt: '2099-07-12T11:00:00Z'
      },
      notificationIntent: {
        id: 'nti_one',
        topic: 'walk-in.enrolled' as const,
        sourceId: entry.id
      }
    }),
  inspect: () => Effect.succeed(entry)
}

describe('walk-in HTTP', () => {
  it('returns merchant-backed enrollment options and queue state', async () => {
    const response = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins'),
      dependencies
    )
    expect(await response?.json()).toMatchObject({
      state: 'open',
      services: [{ id: 'svc_cut', name: 'Signature cut' }],
      providers: [{ id: 'prv_ana', name: 'Ana' }]
    })
  })

  it('enrolls and moves the private capability into an HttpOnly cookie', async () => {
    const response = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Mara',
            email: 'mara@example.test',
            phone: '+40711111111'
          },
          locale: 'en'
        })
      }),
      dependencies
    )
    expect(response?.status).toBe(201)
    expect(response?.headers.get('set-cookie')).toContain('HttpOnly')
    expect(JSON.stringify(await response?.json())).not.toContain('aaaa')
  })

  it('requires the protected cookie for acknowledgment reads', async () => {
    const response = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins/wie_one'),
      dependencies
    )
    expect(response?.status).toBe(404)
  })

  it('continues successful enrollment through the protected acknowledgment cookie', async () => {
    const enrolled = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Mara',
            email: 'mara@example.test',
            phone: '+40711111111'
          },
          locale: 'en'
        })
      }),
      dependencies
    )
    const credential = enrolled!.headers.get('set-cookie')!.split(';', 1)[0]!
    const acknowledgment = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins/wie_one', {
        headers: { cookie: credential }
      }),
      dependencies
    )
    expect(acknowledgment?.status).toBe(200)
    expect(await acknowledgment?.json()).toMatchObject({
      id: 'wie_one',
      status: 'waiting'
    })
  })

  it('maps closed and provider failures without exposing internals', async () => {
    const closed = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Mara',
            email: 'mara@example.test',
            phone: '+40711111111'
          },
          locale: 'en'
        })
      }),
      { ...dependencies, enroll: () => Effect.fail({ _tag: 'WalkInsClosed' }) }
    )
    const unavailable = await handleWalkInRequest(
      new Request('https://booking.test/mara/booking/downtown/walk-ins'),
      {
        ...dependencies,
        overview: () => Effect.fail({ _tag: 'CapabilityUnavailable' })
      }
    )
    expect(closed?.status).toBe(409)
    expect(unavailable?.status).toBe(503)
    expect(await unavailable?.json()).toEqual({ error: 'walk_ins_unavailable' })
  })

  it('keeps Shop resolution bound to the Merchant path', async () => {
    const response = await handleWalkInRequest(
      new Request('https://booking.test/other/booking/downtown/walk-ins'),
      {
        ...dependencies,
        resolveShop: ({ merchantSlug }) =>
          merchantSlug === 'mara'
            ? Effect.succeed({ id: 'shp_one' })
            : Effect.fail({ _tag: 'ShopNotFound' })
      }
    )
    expect(response?.status).toBe(404)
  })
})
