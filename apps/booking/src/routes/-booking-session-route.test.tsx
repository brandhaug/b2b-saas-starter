// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingJourney } from '@b2b-saas-starter/capabilities/booking'
import { BookingSessionRouteView } from './$merchantSlug.booking_.session.$sessionId.tsx'
import { BookingLocalizationProvider } from '../localization/booking-localization-provider.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('protected Booking Session route', () => {
  it('reloads persisted selection from the Merchant-scoped Session URL', async () => {
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
        premiumPaletteSource: null,
        adultsOnly: false
      },
      catalogRecovery: null,
      reconciliation: [],
      providerPreference: { kind: 'any' },
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
    const fetchMock = vi.fn(async () => Response.json(journey))
    vi.stubGlobal('fetch', fetchMock)

    const renderRoute = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BookingLocalizationProvider sessionLocale="en">
            <BookingSessionRouteView
              merchantSlug="mara-studio"
              sessionId="bsn_refresh"
            />
          </BookingLocalizationProvider>
        </QueryClientProvider>
      )
    const first = renderRoute()
    await screen.findByTestId('service:svc_cut')
    expect(fetchMock).toHaveBeenCalledWith(
      '/mara-studio/booking/session/bsn_refresh/selection',
      { credentials: 'same-origin' }
    )

    first.unmount()
    renderRoute()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  })
})
