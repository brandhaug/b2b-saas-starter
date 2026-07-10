import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { BookingSessionGone } from '@b2b-saas-starter/capabilities'
import {
  bookingSessionCookie,
  handleBookingSessionRequest,
  readBookingSessionCapabilities,
  validatePrivateMutationRequest
} from './booking-session-http.ts'

describe('Booking Session HTTP boundary', () => {
  it('sets a session-specific host-only capability cookie on the exact Merchant path', () => {
    const cookie = Effect.runSync(
      bookingSessionCookie({
        sessionId: 'bsn_abc123',
        merchantSlug: 'mara-studio',
        capability: 'a'.repeat(64),
        absoluteExpiresAt: '2026-07-10T12:00:00.000Z',
        now: '2026-07-10T10:00:00.000Z',
        secure: true
      })
    )

    expect(cookie).toContain('booking_session_bsn_abc123=' + 'a'.repeat(64))
    expect(cookie).toContain('Path=/mara-studio/booking')
    expect(cookie).toContain('Max-Age=7200')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
  })

  it('reads concurrent session-specific cookies without exposing them to JavaScript', () => {
    const candidates = readBookingSessionCapabilities(
      `other=value; booking_session_bsn_one=${'b'.repeat(64)}; booking_session_bsn_two=${'c'.repeat(64)}`
    )
    expect(candidates).toEqual([
      { sessionId: 'bsn_one', capability: 'b'.repeat(64) },
      { sessionId: 'bsn_two', capability: 'c'.repeat(64) }
    ])
  })

  it('requires exact same-origin evidence, Fetch Metadata, and JSON for private mutations', () => {
    const valid = new Request(
      'https://www.example.test/mara-studio/booking/session/bsn_one/services',
      {
        method: 'POST',
        headers: {
          origin: 'https://www.example.test',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json'
        },
        body: '{}'
      }
    )
    expect(validatePrivateMutationRequest(valid, 'https://www.example.test')).toBeNull()

    for (const headers of [
      { origin: 'https://evil.test', 'content-type': 'application/json' },
      {
        origin: 'https://www.example.test',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json'
      },
      {
        origin: 'https://www.example.test',
        'content-type': 'application/x-www-form-urlencoded'
      }
    ]) {
      const request = new Request(valid.url, { method: 'POST', headers, body: '{}' })
      expect(
        validatePrivateMutationRequest(request, 'https://www.example.test')
      ).not.toBeNull()
    }
  })

  it('creates through the server boundary and redirects without putting the capability in the URL', async () => {
    const capability = 'd'.repeat(64)
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request('https://www.example.test/mara-studio/booking'),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () =>
            Effect.succeed({
              kind: 'created',
              capability,
              session: {
                id: 'bsn_created',
                merchantSlug: 'mara-studio',
                checkoutPath: 'pay_in_person',
                lifecycle: 'active',
                createdAt: '2026-07-10T10:00:00.000Z',
                lastActivityAt: '2026-07-10T10:00:00.000Z',
                idleExpiresAt: '2026-07-10T10:30:00.000Z',
                absoluteExpiresAt: '2026-07-10T12:00:00.000Z'
              }
            }),
          authorize: () => Effect.die(new Error('not called')),
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.succeed(new Response('not called'))
        }
      )
    )

    expect(response?.status).toBe(303)
    expect(response?.headers.get('location')).toBe(
      '/mara-studio/booking/session/bsn_created'
    )
    expect(response?.headers.get('location')).not.toContain(capability)
    expect(response?.headers.get('set-cookie')).toContain(capability)
  })

  it('protects private routes and rate-limits authorized mutations by Session ID', async () => {
    const capability = 'e'.repeat(64)
    const calls: string[] = []
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_private/services',
          {
            method: 'POST',
            headers: {
              cookie: `booking_session_bsn_private=${capability}`,
              origin: 'https://www.example.test',
              'sec-fetch-site': 'same-origin',
              'content-type': 'application/json'
            },
            body: '{}'
          }
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () => Effect.die(new Error('not called')),
          authorize: (input) => {
            calls.push(`authorize:${input.sessionId}:${input.capability}`)
            return Effect.succeed({
              id: input.sessionId,
              merchantSlug: input.merchantSlug,
              checkoutPath: 'pay_in_person',
              lifecycle: 'active',
              createdAt: input.now,
              lastActivityAt: input.now,
              idleExpiresAt: input.now,
              absoluteExpiresAt: input.now
            })
          },
          takeRead: () => Effect.succeed(true),
          takeWrite: (key) => {
            calls.push(`write:${key}`)
            return Effect.succeed(false)
          },
          fallback: () => Effect.succeed(new Response('not called'))
        }
      )
    )

    expect(response?.status).toBe(429)
    expect(calls).toEqual([
      `authorize:bsn_private:${capability}`,
      'write:session:bsn_private'
    ])
  })

  it('uses generic 404s for missing capabilities and a safe 410 only for a proven expired capability', async () => {
    const base = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.succeed(new Response('private'))
    }
    const url =
      'https://www.example.test/mara-studio/booking/session/bsn_expired/services'
    const missing = await Effect.runPromise(
      handleBookingSessionRequest(new Request(url), {
        ...base,
        authorize: () => Effect.die(new Error('not called'))
      })
    )
    expect(missing.status).toBe(404)

    const proven = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(url, {
          headers: {
            cookie: `booking_session_bsn_expired=${'f'.repeat(64)}`
          }
        }),
        {
          ...base,
          authorize: () =>
            Effect.fail(
              new BookingSessionGone({
                message: 'This Booking Session has expired'
              })
            )
        }
      )
    )
    expect(proven.status).toBe(410)
    expect(await proven.text()).toContain('/mara-studio/booking')
  })
})
