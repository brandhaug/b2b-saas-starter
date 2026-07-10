import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  BookingSchedulingRejected,
  BookingSelectionRejected,
  BookingSessionGone,
  type BookingJourney
} from '@b2b-saas-starter/capabilities'
import {
  bookingSessionCookie,
  handleBookingSessionRequest,
  readBookingSessionCapabilities,
  validatePrivateMutationRequest
} from './booking-session-http.ts'

describe('Booking Session HTTP boundary', () => {
  const journey: BookingJourney = {
    presentation: 'team',
    providerPreference: null,
    selection: { primaryServiceId: null, additionalServiceIds: [] },
    compatibleAdditionalServiceIds: [],
    providers: [
      {
        id: 'prv_ava',
        displayName: 'Ava S.',
        isDefault: true,
        eligibleServiceIds: ['svc_cut']
      }
    ],
    services: [
      {
        id: 'svc_cut',
        name: 'Signature Cut',
        category: 'Haircuts',
        priceMinor: 4500,
        currency: 'USD',
        durationMinutes: 45,
        eligibleProviderIds: ['prv_ava']
      }
    ]
  }

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
    const directLocal = new Request(
      'http://localhost:3073/mara-studio/booking/session/bsn_one/services',
      {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3073',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json'
        },
        body: '{}'
      }
    )
    expect(
      validatePrivateMutationRequest(directLocal, 'http://localhost:3071')
    ).toBeNull()

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

  it('reads and changes persisted journey selection only after Session authorization', async () => {
    const capability = '9'.repeat(64)
    const calls: string[] = []
    const request = new Request(
      'https://www.example.test/mara-studio/booking/session/bsn_private/provider',
      {
        method: 'POST',
        headers: {
          cookie: `booking_session_bsn_private=${capability}`,
          origin: 'https://www.example.test',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ kind: 'any' })
      }
    )
    const response = await Effect.runPromise(
      handleBookingSessionRequest(request, {
        publicSiteOrigin: 'https://www.example.test',
        enter: () => Effect.die(new Error('not called')),
        authorize: (input) => {
          calls.push(`authorize:${input.sessionId}`)
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
        selection: {
          load: () => Effect.succeed(journey),
          chooseProvider: (_session, preference) => {
            calls.push(`provider:${preference.kind}`)
            return Effect.succeed({ ...journey, providerPreference: preference })
          },
          chooseServices: () =>
            Effect.fail(
              new BookingSelectionRejected({
                message: 'Selection could not be accepted'
              })
            )
        },
        takeRead: () => Effect.succeed(true),
        takeWrite: () => Effect.succeed(true),
        fallback: () => Effect.die(new Error('not called'))
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ providerPreference: { kind: 'any' } })
    expect(calls).toEqual(['authorize:bsn_private', 'provider:any'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('settles malformed and rejected selection mutations as the same non-disclosing response', async () => {
    const capability = '8'.repeat(64)
    const baseRequest = {
      method: 'POST',
      headers: {
        cookie: `booking_session_bsn_private=${capability}`,
        origin: 'https://www.example.test',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json'
      }
    }
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: (
        input: Parameters<
          NonNullable<Parameters<typeof handleBookingSessionRequest>[1]['authorize']>
        >[0]
      ) =>
        Effect.succeed({
          id: input.sessionId,
          merchantSlug: input.merchantSlug,
          checkoutPath: 'pay_in_person' as const,
          lifecycle: 'active' as const,
          createdAt: input.now,
          lastActivityAt: input.now,
          idleExpiresAt: input.now,
          absoluteExpiresAt: input.now
        }),
      selection: {
        load: () => Effect.succeed(journey),
        chooseProvider: () =>
          Effect.fail(
            new BookingSelectionRejected({ message: 'Selection could not be accepted' })
          ),
        chooseServices: () =>
          Effect.fail(
            new BookingSelectionRejected({ message: 'Selection could not be accepted' })
          )
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called'))
    }
    for (const body of [
      '{}',
      JSON.stringify({ kind: 'specific', providerId: 'private' })
    ]) {
      const response = await Effect.runPromise(
        handleBookingSessionRequest(
          new Request(
            'https://www.example.test/mara-studio/booking/session/bsn_private/provider',
            { ...baseRequest, body }
          ),
          dependencies
        )
      )
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not found')
    }
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

  it('serves authorized Availability and returns a safe slot-lost recovery state', async () => {
    const capability = '7'.repeat(64)
    const base = 'https://www.example.test/mara-studio/booking/session/bsn_private'
    const session = {
      id: 'bsn_private',
      merchantSlug: 'mara-studio',
      checkoutPath: 'pay_in_person' as const,
      lifecycle: 'active' as const,
      createdAt: '2026-07-10T09:30:00.000Z',
      lastActivityAt: '2026-07-10T09:30:00.000Z',
      idleExpiresAt: '2026-07-10T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
    }
    let requestedDays: number | undefined
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.succeed(session),
      scheduling: {
        availability: (_session: unknown, input: { readonly days?: number }) => {
          requestedDays = input.days
          return Effect.succeed({
            timezone: 'UTC',
            slots: [
              {
                startsAt: '2026-07-13T09:00:00.000Z',
                endsAt: '2026-07-13T10:00:00.000Z'
              }
            ],
            hold: null
          })
        },
        hold: () =>
          Effect.fail(
            new BookingSchedulingRejected({
              reason: 'slot_lost',
              message: 'That time was just booked'
            })
          )
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-10T09:30:00.000Z'
    }
    const headers = { cookie: `booking_session_bsn_private=${capability}` }
    const availability = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/availability`, { headers }),
        dependencies
      )
    )
    expect(availability.status).toBe(200)
    expect(await availability.json()).toMatchObject({ timezone: 'UTC', hold: null })
    expect(requestedDays).toBeUndefined()

    const lost = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/hold`, {
          method: 'POST',
          headers: {
            ...headers,
            origin: 'https://www.example.test',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ startsAt: '2026-07-13T09:00:00.000Z' })
        }),
        dependencies
      )
    )
    expect(lost.status).toBe(409)
    expect(await lost.json()).toEqual({
      kind: 'slot_lost',
      message: 'That time was just booked'
    })
  })

  it('accepts only Customer Details and returns server-owned Pay In Person review facts', async () => {
    const capability = '8'.repeat(64)
    const base = 'https://www.example.test/mara-studio/booking/session/bsn_private'
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
    let received: unknown
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () =>
        Effect.succeed({
          id: 'bsn_private',
          merchantSlug: 'mara-studio',
          checkoutPath: 'pay_in_person' as const,
          lifecycle: 'active' as const,
          createdAt: '2026-07-10T09:30:00.000Z',
          lastActivityAt: '2026-07-10T09:30:00.000Z',
          idleExpiresAt: '2026-07-10T10:00:00.000Z',
          absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
        }),
      checkout: {
        saveCustomerDetails: (_session: unknown, details: unknown) => {
          received = details
          return Effect.succeed({
            customerDetails: details as {
              name: string
              email: string
              phone: string | null
            },
            checkoutPath: 'pay_in_person' as const,
            holdExpiresAt: '2026-07-10T09:40:00.000Z',
            quote
          })
        },
        review: () => Effect.die(new Error('not called'))
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-10T09:30:00.000Z'
    }
    const headers = {
      cookie: `booking_session_bsn_private=${capability}`,
      origin: 'https://www.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    }
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/customer-details`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: ' Mia ',
            email: 'MIA@EXAMPLE.COM',
            phone: '',
            checkoutPath: 'pay_now',
            totalMinor: 1,
            providerId: 'prv_attacker'
          })
        }),
        dependencies
      )
    )
    expect(received).toEqual({
      name: 'Mia',
      email: 'mia@example.com',
      phone: null
    })
    expect(await response.json()).toMatchObject({
      checkoutPath: 'pay_in_person',
      quote: { totalMinor: 5000, assignedProvider: { id: 'prv_ava' } }
    })

    const confirm = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/confirm`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ quote, checkoutPath: 'pay_now' })
        }),
        dependencies
      )
    )
    expect(confirm.status).toBe(404)

    const acceptedCommand = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/confirm`, {
          method: 'POST',
          headers,
          body: '{}'
        }),
        dependencies
      )
    )
    expect(acceptedCommand.status).toBe(501)
    expect(await acceptedCommand.json()).toMatchObject({
      kind: 'confirmation_pending'
    })
  })
})
