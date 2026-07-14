// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BookingAvailability,
  BookingJourney
} from '@b2b-saas-starter/capabilities/booking'
import { ServerBackedBookingFlow } from './server-backed-booking-flow.tsx'
import { BookingLocalizationProvider } from '../localization/booking-localization-provider.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('server-backed Booking scheduling', () => {
  it('keeps the single-customer shell free of group controls', async () => {
    const journey: BookingJourney = {
      version: 1,
      presentation: 'team',
      shopId: 'shp_main',
      shops: [{ id: 'shp_main', slug: 'main', name: 'Main Shop' }],
      resolvedConfiguration: {
        merchantName: {
          text: 'Merchant',
          locale: 'en',
          isSourceLanguageFallback: false
        },
        brandName: { text: 'Brand', locale: 'en', isSourceLanguageFallback: false },
        shopName: { text: 'Main Shop', locale: 'en', isSourceLanguageFallback: false },
        premiumPalette: null,
        premiumPaletteSource: null
      },
      catalogRecovery: null,
      reconciliation: [],
      providerPreference: null,
      selection: { primaryServiceId: null, additionalServiceIds: [] },
      compatibleAdditionalServiceIds: [],
      providers: [],
      services: []
    }
    const party = {
      id: 'bpt_one',
      bookingSessionId: 'bsn_one',
      shopId: 'shp_main',
      lifecycle: 'active',
      currency: 'USD',
      locale: 'en',
      version: 1,
      requests: [
        {
          id: 'brq_one',
          bookingPartyId: 'bpt_one',
          position: 0,
          providerPreference: null,
          providerId: null,
          primaryServiceId: null,
          serviceIds: [],
          holdId: null,
          holdExpiresAt: null,
          customerAccountId: null,
          customerDetails: null,
          startsAt: null,
          endsAt: null
        }
      ]
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/selection')) return Response.json(journey)
      if (url.endsWith('/party')) return Response.json(party)
      throw new Error(`unexpected request: ${url}`)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingLocalizationProvider sessionLocale="en">
          <ServerBackedBookingFlow merchantSlug="mara" sessionId="bsn_one" />
        </BookingLocalizationProvider>
      </QueryClientProvider>
    )

    await waitFor(() =>
      expect(
        queryClient.getQueryData(['booking-party', 'mara', 'bsn_one'])
      ).toBeTruthy()
    )
    expect(screen.queryByText('Your group')).toBeNull()
    queryClient.clear()
  })

  it('invalidates the selected hold at its exact expiry and shows safe recovery', async () => {
    const journey: BookingJourney = {
      version: 1,
      presentation: 'solo',
      shopId: 'shp_main',
      shops: [{ id: 'shp_main', slug: 'main', name: 'Main Shop' }],
      resolvedConfiguration: {
        merchantName: {
          text: 'Merchant',
          locale: 'en',
          isSourceLanguageFallback: false
        },
        brandName: { text: 'Brand', locale: 'en', isSourceLanguageFallback: false },
        shopName: { text: 'Main Shop', locale: 'en', isSourceLanguageFallback: false },
        premiumPalette: null,
        premiumPaletteSource: null
      },
      catalogRecovery: null,
      reconciliation: [],
      providerPreference: { kind: 'specific', providerId: 'prv_ava' },
      selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] },
      compatibleAdditionalServiceIds: [],
      providers: [
        {
          id: 'prv_ava',
          displayName: 'Ava',
          shortName: 'Ava',
          isDefault: true,
          access: 'public',
          eligibleServiceIds: ['svc_cut']
        }
      ],
      services: [
        {
          id: 'svc_cut',
          name: 'Cut',
          category: 'Hair',
          priceMinor: 5000,
          currency: 'USD',
          durationMinutes: 60,
          eligibleProviderIds: ['prv_ava']
        }
      ]
    }
    const slot = {
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z'
    }
    const expiresAt = new Date(Date.now() + 400).toISOString()
    const held: BookingAvailability = {
      timezone: 'UTC',
      slots: [slot],
      hold: {
        id: 'hld_expiring',
        bookingSessionId: 'bsn_one',
        createdAt: new Date().toISOString(),
        expiresAt,
        quote: {
          ...slot,
          providerPreference: { kind: 'specific', providerId: 'prv_ava' },
          assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
          services: [
            {
              id: 'svc_cut',
              role: 'primary',
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
      }
    }
    let availabilityReads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/selection')) return Response.json(journey)
      if (url.endsWith('/availability')) {
        availabilityReads += 1
        return Response.json(availabilityReads === 1 ? held : { ...held, hold: null })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingLocalizationProvider sessionLocale="en">
          <ServerBackedBookingFlow merchantSlug="mara" sessionId="bsn_one" />
        </BookingLocalizationProvider>
      </QueryClientProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: /view order/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }))
    expect(
      await screen.findByRole('button', { name: /view order, \$50\.00/i })
    ).toBeTruthy()
    expect(await screen.findByText('Your held time expired')).toBeTruthy()
    expect(availabilityReads).toBeGreaterThanOrEqual(2)
    queryClient.clear()
  })

  it('offers a safe restart when the Session expires during checkout', async () => {
    const journey: BookingJourney = {
      version: 1,
      presentation: 'solo',
      shopId: 'shp_main',
      shops: [{ id: 'shp_main', slug: 'main', name: 'Main Shop' }],
      resolvedConfiguration: {
        merchantName: {
          text: 'Merchant',
          locale: 'en',
          isSourceLanguageFallback: false
        },
        brandName: { text: 'Brand', locale: 'en', isSourceLanguageFallback: false },
        shopName: { text: 'Main Shop', locale: 'en', isSourceLanguageFallback: false },
        premiumPalette: null,
        premiumPaletteSource: null
      },
      catalogRecovery: null,
      reconciliation: [],
      providerPreference: { kind: 'specific', providerId: 'prv_ava' },
      selection: { primaryServiceId: 'svc_cut', additionalServiceIds: [] },
      compatibleAdditionalServiceIds: [],
      providers: [
        {
          id: 'prv_ava',
          displayName: 'Ava',
          shortName: 'Ava',
          isDefault: true,
          access: 'public',
          eligibleServiceIds: ['svc_cut']
        }
      ],
      services: [
        {
          id: 'svc_cut',
          name: 'Cut',
          category: 'Hair',
          priceMinor: 5000,
          currency: 'USD',
          durationMinutes: 60,
          eligibleProviderIds: ['prv_ava']
        }
      ]
    }
    const slot = {
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z'
    }
    const availability: BookingAvailability = {
      timezone: 'UTC',
      slots: [slot],
      hold: {
        id: 'hld_live',
        bookingSessionId: 'bsn_expiring',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        quote: {
          ...slot,
          providerPreference: { kind: 'specific', providerId: 'prv_ava' },
          assignedProvider: { id: 'prv_ava', displayName: 'Ava' },
          services: [
            {
              id: 'svc_cut',
              role: 'primary',
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
      }
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/selection')) return Response.json(journey)
      if (url.endsWith('/availability')) return Response.json(availability)
      if (url.endsWith('/customer-details'))
        return new Response('expired', { status: 410 })
      throw new Error(`unexpected request: ${url}`)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingLocalizationProvider sessionLocale="en">
          <ServerBackedBookingFlow merchantSlug="mara" sessionId="bsn_expiring" />
        </BookingLocalizationProvider>
      </QueryClientProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: /view order/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose time' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /view order, \$50\.00/i })
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mia' } })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'mia@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review booking' }))
    expect(await screen.findByRole('link', { name: 'Start again' })).toHaveProperty(
      'pathname',
      '/mara/booking'
    )
    queryClient.clear()
  })
})
