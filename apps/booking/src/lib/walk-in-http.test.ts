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
  resolveShop: async () => ({ id: 'shp_one' }),
  queue: async () => [entry],
  enroll: async () => ({
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
  inspect: async () => entry
}

describe('walk-in HTTP', () => {
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
})
