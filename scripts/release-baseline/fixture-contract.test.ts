import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildSeedBookingScenario } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { handleBookingSessionRequest } from '../../apps/booking/src/lib/booking-session-http.ts'
import {
  dispatchBookingRequest,
  type BookingServiceBinding
} from '../../apps/web/src/lib/booking-dispatch.ts'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

describe('canonical production-shaped fixture boundaries', () => {
  it('dispatches every fixture request through a fresh Booking service-binding read', async () => {
    let reads = 0
    const booking: BookingServiceBinding = {
      fetch: async () => new Response(`fresh-${++reads}`)
    }
    const request = () =>
      new Request(`https://www.example.test/${scenario.merchant.slug}/booking/services`)
    const fallback = async () => new Response('unexpected', { status: 500 })

    const first = await dispatchBookingRequest(
      request(),
      { BOOKING: booking },
      fallback
    )
    const second = await dispatchBookingRequest(
      request(),
      { BOOKING: booking },
      fallback
    )

    await expect(first.text()).resolves.toBe('fresh-1')
    await expect(second.text()).resolves.toBe('fresh-2')
    expect(reads).toBe(2)
  })

  it('marks a fixture-scoped protected read private and no-store', async () => {
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          `https://www.example.test/${scenario.merchant.slug}/booking/confirmations/cnf_release/appointments/apt_release/calendar.ics`
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () => Effect.die(new Error('not called')),
          authorize: () => Effect.die(new Error('not called')),
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.die(new Error('not called')),
          now: () => scenario.anchorTime
        }
      )
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
