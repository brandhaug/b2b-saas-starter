import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  BookingSchedulingRejected,
  BookingPartyConflict,
  BookingSelectionRejected,
  BookingSessionGone,
  BookingConfirmationProcessing,
  CapabilityUnavailable,
  CheckoutReviewUnavailable,
  type BookingJourney
} from '@b2b-saas-starter/capabilities/booking'
import {
  bookingSessionCookie,
  handleBookingSessionRequest,
  readBookingSessionCapabilities,
  validatePrivateMutationRequest
} from './booking-session-http.ts'

describe('Booking Session HTTP boundary', () => {
  const journey: BookingJourney = {
    version: 1,
    presentation: 'solo',
    shopId: 'shp_main',
    shops: [{ id: 'shp_main', slug: 'main', name: 'Main Shop' }],
    resolvedConfiguration: {
      merchantName: { text: 'Merchant', locale: 'en', isSourceLanguageFallback: false },
      brandName: { text: 'Brand', locale: 'en', isSourceLanguageFallback: false },
      shopName: { text: 'Main Shop', locale: 'en', isSourceLanguageFallback: false },
      premiumPalette: null,
      premiumPaletteSource: null,
      adultsOnly: false
    },
    catalogRecovery: null,
    reconciliation: [],
    providerPreference: null,
    selection: { primaryServiceId: null, additionalServiceIds: [] },
    compatibleAdditionalServiceIds: [],
    providers: [
      {
        id: 'prv_ava',
        displayName: 'Ava S.',
        shortName: 'Ava S.',
        isDefault: true,
        access: 'public',
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

  it('does not expose online Payment methods or settlement through the public Booking Session', async () => {
    const capability = '8'.repeat(64)
    const session = {
      id: 'bsn_payment_http',
      merchantSlug: 'mara-studio',
      checkoutPath: 'pay_in_person' as const,
      lifecycle: 'active' as const,
      createdAt: '2026-07-10T09:30:00.000Z',
      lastActivityAt: '2026-07-10T09:30:00.000Z',
      idleExpiresAt: '2026-07-10T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
    }
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.succeed(session),
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-10T09:30:00.000Z'
    }
    const headers = {
      cookie: `booking_session_bsn_payment_http=${capability}`,
      origin: 'https://www.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    }
    const methods = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_payment_http/payment-methods',
          { headers }
        ),
        dependencies
      )
    )
    expect(methods.status).toBe(404)
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_payment_http/payment-settle',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              method: 'apple_pay',
              idempotencyKey: 'payment-submit-http',
              paymentMethodReference: 'pm_http'
            })
          }
        ),
        dependencies
      )
    )
    expect(response.status).toBe(404)
  })

  it('routes authorized party switching and coordinated holds through the real private contract', async () => {
    const capability = '9'.repeat(64)
    const session = {
      id: 'bsn_group',
      merchantSlug: 'mara-studio',
      checkoutPath: 'pay_in_person' as const,
      lifecycle: 'active' as const,
      createdAt: '2026-07-10T09:30:00.000Z',
      lastActivityAt: '2026-07-10T09:30:00.000Z',
      idleExpiresAt: '2026-07-10T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
    }
    const requests = ['brq_one', 'brq_two'].map((id, position) => ({
      id,
      bookingPartyId: 'bpt_group',
      position,
      providerPreference: position ? ('any' as const) : ('specific' as const),
      providerId: position ? null : 'prv_one',
      primaryServiceId: 'svc_one',
      serviceIds: ['svc_one'],
      holdId: null,
      customerAccountId: null,
      customerDetails: null,
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z'
    }))
    const party = {
      id: 'bpt_group',
      bookingSessionId: session.id,
      shopId: 'shp_one',
      activeRequestId: 'brq_one',
      lifecycle: 'active' as const,
      currency: 'RON',
      locale: 'en',
      version: 2,
      requests
    }
    let activated = ''
    let heldRequests: readonly string[] = []
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.succeed(session),
      parties: {
        load: () => Effect.succeed(party),
        add: () => Effect.succeed(party),
        remove: () => Effect.succeed(party),
        reorder: () => Effect.succeed(party),
        update: () => Effect.succeed(party),
        activate: (_partyId: string, requestId: string) => {
          activated = requestId
          return Effect.succeed({ ...party, activeRequestId: requestId, version: 3 })
        }
      },
      scheduling: {
        availability: () => Effect.die(new Error('not called')),
        hold: () => Effect.die(new Error('not called')),
        release: () => Effect.void,
        holdParty: (
          _session: unknown,
          input: { readonly requests: readonly { readonly bookingRequestId: string }[] }
        ) => {
          heldRequests = input.requests.map((request) => request.bookingRequestId)
          return Effect.succeed([])
        }
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-10T09:30:00.000Z'
    }
    const headers = {
      cookie: `booking_session_bsn_group=${capability}`,
      origin: 'https://www.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    }
    const activatedResponse = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_group/party-activate',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ version: 2, requestId: 'brq_two' })
          }
        ),
        dependencies
      )
    )
    expect(activatedResponse.status).toBe(200)
    expect(activated).toBe('brq_two')
    const heldResponse = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_group/holds',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              now: 'ignored',
              requests: requests.map((request) => ({
                bookingRequestId: request.id,
                startsAt: request.startsAt
              }))
            })
          }
        ),
        dependencies
      )
    )
    expect(heldResponse.status).toBe(200)
    expect(heldRequests).toEqual(['brq_one', 'brq_two'])
  })

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
              routeId: 'brt_created',
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
      '/mara-studio/booking?booking=brt_created'
    )
    expect(response?.headers.get('location')).not.toContain(capability)
    expect(response?.headers.get('set-cookie')).toContain(capability)
  })

  it('creates from the booking-first landing and keeps both landing and flow cookie scopes', async () => {
    const capability = 'd'.repeat(64)
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request('https://www.example.test/booking/mara-studio'),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () =>
            Effect.succeed({
              kind: 'created',
              routeId: 'brt_alias',
              capability,
              session: {
                id: 'bsn_alias',
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
      '/booking/mara-studio?booking=brt_alias'
    )
    const cookies = response?.headers.getSetCookie() ?? []
    expect(cookies).toHaveLength(2)
    expect(cookies.some((cookie) => cookie.includes('Path=/booking/mara-studio'))).toBe(
      true
    )
    expect(cookies.some((cookie) => cookie.includes('Path=/mara-studio/booking'))).toBe(
      true
    )
  })

  it('isolates each tab by entering only the Session named by its non-secret locator', async () => {
    const calls: { locator: string | null; candidates: string[] }[] = []
    const capability = 'b'.repeat(64)
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking?booking=brt_tab_two',
          {
            headers: {
              cookie: `booking_session_bsn_tab_one=${'a'.repeat(64)}; booking_session_bsn_tab_two=${capability}`
            }
          }
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: (input) => {
            calls.push({
              locator: input.routeLocator,
              candidates: input.candidates.map((candidate) => candidate.sessionId)
            })
            return Effect.succeed({
              kind: 'resumed',
              routeId: 'brt_tab_two',
              session: {
                id: 'bsn_tab_two',
                merchantSlug: 'mara-studio',
                checkoutPath: 'pay_in_person',
                lifecycle: 'active',
                createdAt: '2026-07-10T10:00:00.000Z',
                lastActivityAt: '2026-07-10T10:00:00.000Z',
                idleExpiresAt: '2026-07-10T10:30:00.000Z',
                absoluteExpiresAt: '2026-07-10T12:00:00.000Z'
              }
            })
          },
          authorize: () => Effect.die(new Error('not called')),
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.succeed(new Response('canonical shell'))
        }
      )
    )

    expect(calls).toEqual([
      {
        locator: 'brt_tab_two',
        candidates: ['bsn_tab_one', 'bsn_tab_two']
      }
    ])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('canonical shell')
  })

  it('restores persisted locale and embedding when a continuation omits context', async () => {
    const capability = 'c'.repeat(64)
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () =>
        Effect.succeed({
          kind: 'resumed' as const,
          routeId: 'brt_persisted',
          session: {
            id: 'bsn_persisted',
            merchantSlug: 'mara-studio',
            checkoutPath: 'pay_in_person' as const,
            lifecycle: 'active' as const,
            createdAt: '2026-07-10T10:00:00.000Z',
            lastActivityAt: '2026-07-10T10:00:00.000Z',
            idleExpiresAt: '2026-07-10T10:30:00.000Z',
            absoluteExpiresAt: '2026-07-10T12:00:00.000Z',
            locale: 'fr' as const,
            embeddingProfile: 'widget' as const
          }
        }),
      authorize: () => Effect.die(new Error('not called')),
      captureContext: () => Effect.succeed(undefined),
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called'))
    }

    for (const suffix of ['', '&embed=garbage']) {
      const response = await Effect.runPromise(
        handleBookingSessionRequest(
          new Request(
            `https://www.example.test/mara-studio/booking?booking=brt_persisted${suffix}`,
            {
              headers: {
                cookie: `booking_session_bsn_persisted=${capability}`
              }
            }
          ),
          dependencies
        )
      )

      expect(response.status).toBe(suffix ? 307 : 303)
      expect(response.headers.get('location')).toBe(
        '/mara-studio/booking?booking=brt_persisted&locale=fr&embed=widget'
      )
      expect(response.headers.get('content-language')).toBe('fr')
      expect(response.headers.get('x-booking-embedding')).toBe('widget')
    }
  })

  it('captures acquisition once and redirects to a clean localized embedded URL', async () => {
    const captured: unknown[] = []
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/MARA-STUDIO/BOOKING/?locale=FR-ca&embed=widget&utm_source=partner&customer=secret'
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () =>
            Effect.succeed({
              kind: 'created',
              routeId: 'brt_captured',
              capability: 'c'.repeat(64),
              session: {
                id: 'bsn_captured',
                merchantSlug: 'mara-studio',
                checkoutPath: 'pay_in_person',
                lifecycle: 'active',
                createdAt: '2026-07-10T10:00:00.000Z',
                lastActivityAt: '2026-07-10T10:00:00.000Z',
                idleExpiresAt: '2026-07-10T10:30:00.000Z',
                absoluteExpiresAt: '2026-07-10T12:00:00.000Z'
              }
            }),
          captureContext: (_session, context) => {
            captured.push(context)
            return Effect.void
          },
          authorize: () => Effect.die(new Error('not called')),
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.die(new Error('not called'))
        }
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/mara-studio/booking?booking=brt_captured&locale=fr&embed=widget'
    )
    expect(captured).toEqual([
      {
        locale: 'fr',
        embedding: 'widget',
        acquisition: { utm_source: 'partner' }
      }
    ])
    expect(response.headers.get('location')).not.toContain('customer')
    expect(response.headers.get('set-cookie')).toContain('Path=/mara-studio/booking')
  })

  it('returns localized recovery inside the embedding profile for unmatched routes', async () => {
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/not/a/canonical/route?locale=ro&embed=google'
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () => Effect.die(new Error('not called')),
          authorize: () => Effect.die(new Error('not called')),
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.die(new Error('not called'))
        }
      )
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('content-language')).toBe('ro')
    expect(response.headers.get('x-booking-embedding')).toBe('google')
    expect(await response.text()).toContain('Pagina de rezervare nu a fost găsită')
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

  it('rejects the removed Provider-selection route after Session authorization', async () => {
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
        body: JSON.stringify({ version: 1, preference: { kind: 'any' } })
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

    expect(response.status).toBe(404)
    expect(calls).toEqual(['authorize:bsn_private'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects the removed Shop-selection route after Session authorization', async () => {
    const capability = '7'.repeat(64)
    const calls: string[] = []
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_private/shop',
          {
            method: 'POST',
            headers: {
              cookie: `booking_session_bsn_private=${capability}`,
              origin: 'https://www.example.test',
              'sec-fetch-site': 'same-origin',
              'content-type': 'application/json'
            },
            body: JSON.stringify({ version: 1, shopId: 'shp_other' })
          }
        ),
        {
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
        }
      )
    )

    expect(response.status).toBe(404)
    expect(calls).toEqual(['authorize:bsn_private'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('does not revive the removed Provider route for a stale aggregate version', async () => {
    const capability = '8'.repeat(64)
    const latest = {
      ...journey,
      version: 3,
      providerPreference: { kind: 'any' as const }
    }
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_private/provider',
          {
            method: 'POST',
            headers: {
              cookie: `booking_session_bsn_private=${capability}`,
              origin: 'https://www.example.test',
              'sec-fetch-site': 'same-origin',
              'content-type': 'application/json'
            },
            body: JSON.stringify({ version: 1, preference: { kind: 'any' } })
          }
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () => Effect.die(new Error('not called')),
          authorize: (input) =>
            Effect.succeed({
              id: input.sessionId,
              merchantSlug: input.merchantSlug,
              checkoutPath: 'pay_in_person',
              lifecycle: 'active',
              createdAt: input.now,
              lastActivityAt: input.now,
              idleExpiresAt: input.now,
              absoluteExpiresAt: input.now
            }),
          selection: {
            load: () => Effect.succeed(latest),
            chooseServices: () => Effect.succeed(latest)
          },
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.die(new Error('not called'))
        }
      )
    )

    expect(response.status).toBe(404)
  })

  it('persists a locale change through the authorized Session boundary', async () => {
    const capability = '6'.repeat(64)
    const captured: unknown[] = []
    const response = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(
          'https://www.example.test/mara-studio/booking/session/bsn_private/context',
          {
            method: 'POST',
            headers: {
              cookie: `booking_session_bsn_private=${capability}`,
              origin: 'https://www.example.test',
              'sec-fetch-site': 'same-origin',
              'content-type': 'application/json'
            },
            body: JSON.stringify({ locale: 'es', embedding: 'widget' })
          }
        ),
        {
          publicSiteOrigin: 'https://www.example.test',
          enter: () => Effect.die(new Error('not called')),
          authorize: (input) =>
            Effect.succeed({
              id: input.sessionId,
              merchantSlug: input.merchantSlug,
              checkoutPath: 'pay_in_person',
              lifecycle: 'active',
              createdAt: input.now,
              lastActivityAt: input.now,
              idleExpiresAt: input.now,
              absoluteExpiresAt: input.now
            }),
          captureContext: (_session, context) => {
            captured.push(context)
            return Effect.void
          },
          takeRead: () => Effect.succeed(true),
          takeWrite: () => Effect.succeed(true),
          fallback: () => Effect.die(new Error('not called'))
        }
      )
    )

    expect(response.status).toBe(204)
    expect(captured).toEqual([{ locale: 'es', embedding: 'widget', acquisition: {} }])
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
                message: 'This Booking Session has expired',
                locale: 'fr',
                embeddingProfile: 'widget'
              })
            )
        }
      )
    )
    expect(proven.status).toBe(410)
    const recovery = await proven.text()
    expect(recovery).toContain('/mara-studio/booking')
    expect(recovery).toContain('Cette session de réservation a expiré')
    expect(recovery).toContain('data-embedding="widget"')
  })

  it('serves authorized Availability and returns a safe slot-lost recovery state', async () => {
    const capability = '7'.repeat(64)
    const base = 'https://www.example.test/mara-studio/booking/session/bsn_rsc_private'
    const session = {
      id: 'bsn_rsc_private',
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
        availability: (
          _session: unknown,
          input: { readonly from: string; readonly days?: number }
        ) => {
          requestedDays = input.days
          return Effect.succeed({
            timezone: 'UTC',
            range: { from: input.from, days: input.days ?? 14 },
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
          ),
        release: () => Effect.void
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-10T09:30:00.000Z'
    }
    const headers = { cookie: `booking_session_bsn_rsc_private=${capability}` }
    const availability = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/availability`, { headers }),
        dependencies
      )
    )
    expect(availability.status).toBe(200)
    expect(await availability.json()).toMatchObject({ timezone: 'UTC', hold: null })
    expect(requestedDays).toBeUndefined()

    const rescheduleAvailability = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/availability`, {
          headers: { 'x-booking-session-capability': capability }
        }),
        dependencies
      )
    )
    expect(rescheduleAvailability.status).toBe(200)

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

    const released = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/hold`, {
          method: 'DELETE',
          headers: {
            ...headers,
            origin: 'https://www.example.test',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json'
          }
        }),
        dependencies
      )
    )
    expect(released.status).toBe(204)
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
    const checkoutCommands: string[] = []
    let checkoutReady = true
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () =>
        Effect.succeed({
          id: 'bsn_private',
          merchantSlug: 'mara-studio',
          checkoutPath: 'pay_in_person' as const,
          locale: 'ro' as const,
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
        review: () => Effect.die(new Error('not called')),
        prepare: () => {
          checkoutCommands.push('prepare')
          return Effect.succeed({} as never)
        },
        acceptQuote: () => {
          checkoutCommands.push('quote')
          return Effect.succeed({} as never)
        },
        acceptPolicy: () => {
          checkoutCommands.push('policy')
          return Effect.succeed({} as never)
        },
        recordMarketingConsent: () => {
          checkoutCommands.push('consent')
          return Effect.succeed({} as never)
        },
        recordOperationalMessagingPermission: () => {
          checkoutCommands.push('operational-permission')
          return Effect.succeed({} as never)
        },
        reviewParty: () => {
          checkoutCommands.push('review')
          return checkoutReady
            ? Effect.succeed({} as never)
            : Effect.fail(
                new CheckoutReviewUnavailable({ reason: 'policy_unaccepted' })
              )
        }
      },
      confirmation: {
        read: () => Effect.die(new Error('not called')),
        confirm: () =>
          Effect.succeed({
            appointment: {
              id: 'apt_confirmed',
              merchantId: 'mer_mara',
              providerId: 'prv_ava',
              status: 'scheduled' as const,
              startsAt: quote.startsAt,
              endsAt: quote.endsAt,
              snapshot: quote,
              createdAt: '2026-07-10T09:30:00.000Z'
            },
            appointments: [
              {
                id: 'apt_confirmed',
                merchantId: 'mer_mara',
                providerId: 'prv_ava',
                status: 'scheduled' as const,
                startsAt: quote.startsAt,
                endsAt: quote.endsAt,
                snapshot: quote,
                createdAt: '2026-07-10T09:30:00.000Z'
              }
            ],
            access: {
              routeId: 'cnf_clean',
              tokenVersion: 1,
              signingKeyId: 'current',
              expiresAt: '2026-08-12T10:00:00.000Z',
              token: 'secret-confirmation-token'
            },
            accesses: [
              {
                routeId: 'cnf_clean',
                tokenVersion: 1,
                signingKeyId: 'current',
                expiresAt: '2026-08-12T10:00:00.000Z',
                token: 'secret-confirmation-token'
              }
            ],
            outboxId: 'obx_confirmed',
            outboxIds: ['obx_confirmed'],
            replayed: false
          })
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
            phone: '0722 123 456',
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
      phone: '+40722123456'
    })
    expect(await response.json()).toMatchObject({
      checkoutPath: 'pay_in_person',
      quote: { totalMinor: 5000, assignedProvider: { id: 'prv_ava' } }
    })

    for (const [endpoint, body] of [
      ['checkout-prepare', null],
      ['quote-accept', { quoteId: 'pqt_one' }],
      ['policy-accept', { policyId: 'pol_one' }],
      [
        'marketing-consent',
        {
          bookingRequestId: 'brq_one',
          channel: 'email',
          granted: false
        }
      ],
      [
        'operational-messaging-permission',
        { bookingRequestId: 'brq_one', granted: true }
      ],
      ['checkout-review', null]
    ] as const) {
      const command = await Effect.runPromise(
        handleBookingSessionRequest(
          new Request(`${base}/${endpoint}`, {
            method: body ? 'POST' : 'GET',
            headers,
            ...(body ? { body: JSON.stringify(body) } : {})
          }),
          dependencies
        )
      )
      expect(command.status).toBe(200)
    }
    expect(checkoutCommands).toEqual([
      'prepare',
      'quote',
      'policy',
      'consent',
      'operational-permission',
      'review'
    ])
    const giftCard = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/gift-card-reserve`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            giftCardCode: 'CODE-ONE',
            amountMinor: 2500,
            idempotencyKey: 'gift-card-one'
          })
        }),
        dependencies
      )
    )
    expect(giftCard.status).toBe(404)

    const invalid = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/customer-details`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: '', email: 'bad', phone: '12' })
        }),
        dependencies
      )
    )
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toEqual({
      kind: 'invalid_customer_details',
      issues: [
        { field: 'name', code: 'name_required' },
        { field: 'email', code: 'email_invalid' },
        { field: 'phone', code: 'phone_invalid' }
      ]
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

    checkoutReady = false
    const blockedConfirmation = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/confirm`, {
          method: 'POST',
          headers,
          body: '{}'
        }),
        dependencies
      )
    )
    expect(blockedConfirmation.status).toBe(409)
    expect(await blockedConfirmation.json()).toEqual({
      kind: 'policy_unaccepted'
    })
    checkoutReady = true

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
    expect(acceptedCommand.status).toBe(200)
    expect(await acceptedCommand.json()).toMatchObject({
      location:
        '/mara-studio/booking/confirmations/cnf_clean?token=secret-confirmation-token',
      outboxId: 'obx_confirmed'
    })
    expect(acceptedCommand.headers.get('set-cookie')).toBeNull()

    const uncertain = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/confirm`, {
          method: 'POST',
          headers,
          body: '{}'
        }),
        {
          ...dependencies,
          confirmation: {
            ...dependencies.confirmation,
            confirm: () =>
              Effect.fail(
                new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              )
          }
        }
      )
    )
    expect(uncertain.status).toBe(202)
    expect(await uncertain.json()).toEqual({ kind: 'processing' })

    const unavailableConfirmation = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`${base}/confirm`, {
          method: 'POST',
          headers,
          body: '{}'
        }),
        {
          ...dependencies,
          confirmation: {
            ...dependencies.confirmation,
            confirm: () =>
              Effect.fail(
                new CapabilityUnavailable({
                  capability: 'booking-confirmation',
                  reason: 'Signing key unavailable'
                })
              )
          }
        }
      )
    )
    expect(unavailableConfirmation.status).toBe(503)
  })

  it('exchanges a valid Confirmation token and serves facts through the canonical app shell', async () => {
    const token = 'a'.repeat(64)
    const cookieCredential = 'b'.repeat(64)
    const snapshot = {
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
      totalMinor: 5000,
      merchantTimezone: 'America/New_York',
      customerDetails: {
        name: 'Mia Private',
        email: 'mia@example.com',
        phone: '+15550000001'
      },
      checkoutPath: 'pay_in_person' as const
    }
    const confirmation = {
      routeId: 'cnf_clean',
      status: 'scheduled' as const,
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z',
      locale: 'ro' as const,
      appointments: [
        {
          id: 'apt_mia',
          status: 'scheduled' as const,
          startsAt: snapshot.startsAt,
          endsAt: snapshot.endsAt,
          snapshot,
          adjustments: [
            { kind: 'tax' as const, amountMinor: 700 },
            { kind: 'fee' as const, amountMinor: 300 }
          ]
        },
        {
          id: 'apt_noah',
          status: 'scheduled' as const,
          startsAt: '2026-07-13T11:00:00.000Z',
          endsAt: '2026-07-13T12:00:00.000Z',
          snapshot: {
            ...snapshot,
            startsAt: '2026-07-13T11:00:00.000Z',
            endsAt: '2026-07-13T12:00:00.000Z',
            customerDetails: {
              name: 'Noah Private',
              email: 'noah@example.com',
              phone: '+15550000002'
            }
          },
          adjustments: []
        }
      ],
      shop: {
        publicName: "Mara </script><script>alert('x')</script>",
        coverPhotoUrl: 'https://images.example.test/mara.jpg',
        addressLines: ['Strada Lipscani 21', 'București', '030167', 'RO'],
        coordinates: { latitude: 44.4314, longitude: 26.1002 }
      },
      snapshot
    }
    const readKeys: string[] = []
    let bearerExchanged = false
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.die(new Error('not called')),
      confirmation: {
        confirm: () => Effect.die(new Error('not called')),
        read: (input: { readonly credentialKind: 'bearer' | 'cookie' }) =>
          input.credentialKind === 'bearer' && bearerExchanged
            ? Effect.succeed({ kind: 'not_found' as const })
            : Effect.succeed({
                kind: 'found' as const,
                confirmation,
                cookieCredential,
                expiresAt: '2027-07-13T10:00:00.000Z'
              })
      },
      takeRead: (key: string) => {
        readKeys.push(key)
        return Effect.succeed(true)
      },
      takeWrite: () => Effect.succeed(true),
      now: () => '2026-07-13T10:00:00.000Z',
      fallback: () =>
        Effect.succeed(
          new Response(
            '<!doctype html><html><body><div id="root" data-booking-app="canonical"></div></body></html>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } }
          )
        )
    }
    const path = '/mara-studio/booking/confirmations/cnf_clean'
    const exchange = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`https://www.example.test${path}?token=${token}`),
        dependencies
      )
    )
    expect(exchange.status).toBe(303)
    expect(exchange.headers.get('location')).toBe(path)
    expect(exchange.headers.get('set-cookie')).toContain(`Path=${path}`)
    expect(exchange.headers.get('set-cookie')).toContain(cookieCredential)
    expect(exchange.headers.get('set-cookie')).not.toContain(token)
    expect(exchange.headers.get('set-cookie')).toContain('Max-Age=31536000')
    expect(exchange.headers.get('set-cookie')).toContain('HttpOnly')
    expect(exchange.headers.get('set-cookie')).not.toContain('Domain=')

    bearerExchanged = true
    const replay = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`https://www.example.test${path}?token=${token}`, {
          headers: { cookie: `confirmation_cnf_clean=${cookieCredential}` }
        }),
        dependencies
      )
    )
    expect(replay.status).toBe(303)
    expect(replay.headers.get('location')).toBe(path)

    const clean = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`https://www.example.test${path}`, {
          headers: { cookie: `confirmation_cnf_clean=${cookieCredential}` }
        }),
        dependencies
      )
    )
    expect(clean.status).toBe(200)
    const html = await clean.text()
    expect(html).toContain('id="root"')
    expect(html).toContain('data-booking-app="canonical"')
    expect(html).not.toContain('class="reservation-widget"')
    expect(clean.headers.get('cache-control')).toBe('private, no-store')
    expect(clean.headers.get('referrer-policy')).toBe('no-referrer')

    const data = await Effect.runPromise(
      handleBookingSessionRequest(
        new Request(`https://www.example.test${path}/data`, {
          headers: { cookie: `confirmation_cnf_clean=${cookieCredential}` }
        }),
        dependencies
      )
    )
    expect(data.status).toBe(200)
    const presentation = (await data.json()) as Record<string, unknown>
    expect(presentation).toMatchObject({
      routeId: 'cnf_clean',
      customerFirstName: 'Mia',
      appointments: [
        {
          id: 'apt_mia',
          status: 'scheduled',
          adjustments: [
            { kind: 'tax', amountMinor: 700 },
            { kind: 'fee', amountMinor: 300 }
          ]
        },
        { id: 'apt_noah', status: 'scheduled', adjustments: [] }
      ]
    })
    expect(presentation).not.toHaveProperty('snapshot.customerDetails')
    expect(presentation).not.toHaveProperty('appointments.0.snapshot.customerDetails')
    expect(presentation).not.toHaveProperty('appointments.1.snapshot.customerDetails')
    const serializedPresentation = JSON.stringify(presentation)
    expect(serializedPresentation).not.toContain('mia@example.com')
    expect(serializedPresentation).not.toContain('noah@example.com')
    expect(serializedPresentation).not.toContain('Private')
    expect(serializedPresentation).not.toContain('+15550000001')
    expect(serializedPresentation).not.toContain('+15550000002')
    expect(serializedPresentation).not.toContain('customerDetails')
    expect(serializedPresentation).not.toContain('phone')
    expect(data.headers.get('cache-control')).toBe('private, no-store')
    expect(data.headers.get('referrer-policy')).toBe('no-referrer')
    expect(readKeys).toEqual([
      `confirmation:exchange:path:${path}`,
      `confirmation:exchange:path:${path}`,
      `confirmation:display:path:${path}`,
      `confirmation:data:path:${path}/data`
    ])
  })

  it('uses uniform private 404s for unknown credentials and a private explanatory 410 only for authentic expiry', async () => {
    const token = 'c'.repeat(64)
    const baseDependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.die(new Error('not called')),
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called'))
    }
    const url = `https://www.example.test/mara-studio/booking/confirmations/cnf_private?token=${token}`
    for (const result of [
      { kind: 'not_found' as const },
      { kind: 'expired' as const, locale: 'ro' as const }
    ]) {
      const response = await Effect.runPromise(
        handleBookingSessionRequest(new Request(url), {
          ...baseDependencies,
          confirmation: {
            confirm: () => Effect.die(new Error('not called')),
            read: () => Effect.succeed(result)
          }
        })
      )
      expect(response.status).toBe(result.kind === 'expired' ? 410 : 404)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      if (result.kind === 'expired')
        expect(await response.text()).toContain('link de confirmare a expirat')
      else expect(await response.text()).toBe('Not found')
    }
  })

  it('exports a privacy-minimal calendar snapshot only for a currently authorized Appointment', async () => {
    const cookieCredential = 'c'.repeat(64)
    const snapshot = {
      startsAt: '2026-07-14T09:00:00.000Z',
      endsAt: '2026-07-14T10:00:00.000Z',
      providerPreference: { kind: 'any' as const },
      assignedProvider: { id: 'prv_private', displayName: 'Private Provider' },
      services: [
        {
          id: 'svc_cut',
          role: 'primary' as const,
          name: 'Signature Cut',
          durationMinutes: 60,
          priceMinor: 5000,
          currency: 'USD'
        }
      ],
      durationMinutes: 60,
      currency: 'USD',
      totalMinor: 5000,
      merchantTimezone: 'UTC',
      customerDetails: {
        name: 'Private Customer',
        email: 'private@example.test',
        phone: '+15550100100'
      },
      checkoutPath: 'pay_in_person' as const
    }
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.die(new Error('not called')),
      confirmation: {
        confirm: () => Effect.die(new Error('not called')),
        read: () =>
          Effect.succeed({
            kind: 'found' as const,
            expiresAt: '2026-08-13T10:00:00.000Z',
            confirmation: {
              routeId: 'cnf_calendar',
              status: 'scheduled' as const,
              startsAt: snapshot.startsAt,
              endsAt: snapshot.endsAt,
              locale: 'en' as const,
              snapshot,
              appointments: [
                {
                  id: 'apt_calendar',
                  status: 'scheduled' as const,
                  startsAt: snapshot.startsAt,
                  endsAt: snapshot.endsAt,
                  snapshot,
                  adjustments: []
                }
              ],
              shop: {
                publicName: 'Mara Studio',
                addressLines: ['21 Mercer Street', 'New York, NY']
              }
            },
            cookieCredential
          })
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-13T10:00:00.000Z'
    }
    const request = (appointmentId: string, credential = cookieCredential) =>
      new Request(
        `https://www.example.test/mara-studio/booking/confirmations/cnf_calendar/appointments/${appointmentId}/calendar.ics`,
        credential
          ? { headers: { cookie: `confirmation_cnf_calendar=${credential}` } }
          : undefined
      )

    const response = await Effect.runPromise(
      handleBookingSessionRequest(request('apt_calendar'), dependencies)
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="appointment-apt_calendar.ics"'
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const calendar = await response.text()
    expect(calendar).toContain('SUMMARY:Signature Cut — Mara Studio')
    expect(calendar).not.toContain('Private Customer')
    expect(calendar).not.toContain('private@example.test')
    expect(calendar).not.toContain('Private Provider')

    expect(
      await Effect.runPromise(
        handleBookingSessionRequest(request('apt_other'), dependencies)
      )
    ).toMatchObject({ status: 404 })
    expect(
      await Effect.runPromise(
        handleBookingSessionRequest(request('apt_calendar', ''), dependencies)
      )
    ).toMatchObject({ status: 404 })
    const rateLimited = await Effect.runPromise(
      handleBookingSessionRequest(request('apt_calendar'), {
        ...dependencies,
        takeRead: () => Effect.succeed(false)
      })
    )
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('cache-control')).toBe('private, no-store')

    const malformed = await Effect.runPromise(
      handleBookingSessionRequest(request('apt_calendar'), {
        ...dependencies,
        confirmation: {
          ...dependencies.confirmation,
          read: () =>
            Effect.succeed({
              kind: 'found' as const,
              expiresAt: '2026-08-13T10:00:00.000Z',
              cookieCredential,
              confirmation: {
                routeId: 'cnf_calendar',
                status: 'scheduled' as const,
                startsAt: snapshot.startsAt,
                endsAt: snapshot.endsAt,
                locale: 'en' as const,
                snapshot,
                appointments: [
                  {
                    id: 'apt_calendar',
                    status: 'scheduled' as const,
                    startsAt: snapshot.startsAt,
                    endsAt: snapshot.endsAt,
                    snapshot: {
                      ...snapshot,
                      services: null
                    } as unknown as typeof snapshot,
                    adjustments: []
                  }
                ],
                shop: { publicName: 'Mara Studio' }
              }
            })
        }
      })
    )
    expect(malformed.status).toBe(503)
  })

  it('cancels only an appointment authorized by the protected confirmation', async () => {
    const cookieCredential = 'd'.repeat(64)
    const snapshot = {
      startsAt: '2026-07-14T09:00:00.000Z',
      endsAt: '2026-07-14T10:00:00.000Z',
      providerPreference: { kind: 'any' as const },
      assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
      services: [],
      durationMinutes: 60,
      currency: 'USD',
      totalMinor: 5000,
      merchantTimezone: 'UTC',
      customerDetails: { name: 'Mia', email: 'mia@example.test', phone: null },
      checkoutPath: 'online_payment' as const
    }
    const appointments = ['apt_one', 'apt_sibling'].map((id) => ({
      id,
      status: 'scheduled' as const,
      startsAt: snapshot.startsAt,
      endsAt: snapshot.endsAt,
      snapshot
    }))
    let command: unknown
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.die(new Error('not called')),
      confirmation: {
        confirm: () => Effect.die(new Error('not called')),
        read: () =>
          Effect.succeed({
            kind: 'found' as const,
            confirmation: {
              routeId: 'cnf_cancel',
              status: 'scheduled' as const,
              startsAt: snapshot.startsAt,
              endsAt: snapshot.endsAt,
              locale: 'en' as const,
              snapshot,
              appointments,
              shop: { publicName: 'Mara Studio' }
            },
            cookieCredential
          })
      },
      cancellations: {
        cancel: (input: unknown) => {
          command = input
          return Effect.succeed({
            commandId: 'ccm_http',
            scope: { kind: 'appointment' as const, appointmentId: 'apt_one' },
            appointments: [],
            refundObligations: [],
            replayed: false
          })
        }
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-13T10:00:00.000Z'
    }
    const request = (appointmentId: string) =>
      new Request(
        `https://www.example.test/mara-studio/booking/confirmations/cnf_cancel/appointments/${appointmentId}/cancel`,
        {
          method: 'POST',
          headers: {
            cookie: `confirmation_cnf_cancel=${cookieCredential}`,
            origin: 'https://www.example.test',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            idempotencyKey: 'cancel-http-once',
            reason: 'customer_requested'
          })
        }
      )
    const response = await Effect.runPromise(
      handleBookingSessionRequest(request('apt_one'), dependencies)
    )
    expect(response.status).toBe(200)
    expect(command).toMatchObject({
      merchantSlug: 'mara-studio',
      scope: { kind: 'appointment', appointmentId: 'apt_one' },
      idempotencyKey: 'cancel-http-once',
      reason: 'customer_requested'
    })
    expect(
      await Effect.runPromise(
        handleBookingSessionRequest(request('apt_other'), dependencies)
      )
    ).toMatchObject({ status: 404 })
  })

  it('runs rescheduling commands only for an appointment in the protected confirmation', async () => {
    const cookieCredential = 'e'.repeat(64)
    let command: unknown
    const dependencies = {
      publicSiteOrigin: 'https://www.example.test',
      enter: () => Effect.die(new Error('not called')),
      authorize: () => Effect.die(new Error('not called')),
      confirmation: {
        confirm: () => Effect.die(new Error('not called')),
        read: () =>
          Effect.succeed({
            kind: 'found' as const,
            confirmation: {
              routeId: 'cnf_reschedule',
              status: 'scheduled' as const,
              startsAt: '2026-07-14T09:00:00.000Z',
              endsAt: '2026-07-14T10:00:00.000Z',
              locale: 'en' as const,
              snapshot: {} as never,
              appointments: [{ id: 'apt_one' } as never],
              shop: { publicName: 'Mara Studio' }
            },
            cookieCredential
          })
      },
      rescheduling: {
        execute: (input: unknown) => {
          command = input
          return Effect.succeed({
            sessionId: 'rsc_http',
            bookingSessionId: 'rsc_http',
            expiresAt: '2026-07-13T10:20:00.000Z',
            status: 'active'
          })
        }
      },
      takeRead: () => Effect.succeed(true),
      takeWrite: () => Effect.succeed(true),
      fallback: () => Effect.die(new Error('not called')),
      now: () => '2026-07-13T10:00:00.000Z'
    }
    const request = (appointmentId: string) =>
      new Request(
        `https://www.example.test/mara-studio/booking/confirmations/cnf_reschedule/appointments/${appointmentId}/reschedule`,
        {
          method: 'POST',
          headers: {
            cookie: `confirmation_cnf_reschedule=${cookieCredential}`,
            origin: 'https://www.example.test',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            action: 'begin',
            capability: 'a'.repeat(64),
            expiresAt: '2026-07-13T10:20:00.000Z'
          })
        }
      )
    const response = await Effect.runPromise(
      handleBookingSessionRequest(request('apt_one'), dependencies)
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain(
      'booking_session_rsc_http=' + 'a'.repeat(64)
    )
    expect(command).toMatchObject({
      merchantSlug: 'mara-studio',
      appointmentId: 'apt_one',
      command: { action: 'begin' }
    })
    expect(
      await Effect.runPromise(
        handleBookingSessionRequest(request('apt_other'), dependencies)
      )
    ).toMatchObject({ status: 404 })
  })
})
