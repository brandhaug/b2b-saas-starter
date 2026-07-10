// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingJourney } from '@b2b-saas-starter/capabilities'
import { BookingSessionRouteView } from './$merchantSlug.booking_.session.$sessionId.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('protected Booking Session route', () => {
  it('reloads persisted selection from the Merchant-scoped Session URL', async () => {
    const journey: BookingJourney = {
      presentation: 'team',
      providerPreference: { kind: 'any' },
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
    const fetchMock = vi.fn(async () => Response.json(journey))
    vi.stubGlobal('fetch', fetchMock)

    const renderRoute = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BookingSessionRouteView merchantSlug="mara-studio" sessionId="bsn_refresh" />
        </QueryClientProvider>
      )
    const first = renderRoute()
    await screen.findByText('Signature Cut')
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/mara-studio/booking/session/bsn_refresh/selection',
      { credentials: 'same-origin' }
    )

    first.unmount()
    renderRoute()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
