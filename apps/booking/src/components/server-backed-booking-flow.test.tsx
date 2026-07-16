// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BookingAvailability,
  BookingJourney
} from '@b2b-saas-starter/capabilities/booking'
import { ServerBackedBookingFlow } from './server-backed-booking-flow.tsx'
import { BookingLocalizationProvider } from '../localization/booking-localization-provider.tsx'

const checkoutPreparation = (
  party: Record<string, unknown> & {
    readonly requests: readonly (Record<string, unknown> & {
      readonly providerPreference: unknown
    })[]
  }
) => ({
  party: {
    ...party,
    requests: party.requests.map((request) => ({
      ...request,
      providerPreference:
        typeof request.providerPreference === 'object' &&
        request.providerPreference !== null &&
        'kind' in request.providerPreference
          ? request.providerPreference.kind
          : request.providerPreference
    }))
  },
  requestReviews: [],
  quote: null,
  policy: {
    id: 'pol_checkout',
    scope: 'shop',
    scopeId: 'shp_main',
    kind: 'checkout',
    version: 1,
    disclosure: 'Cancel up to 24 hours before the appointment.',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    retiredAt: null
  },
  policyEligibility: {
    bookingKind: 'appointment',
    depositRequired: false
  },
  cancellationWindow: {
    eligible: false,
    cancellableUntil: '2026-07-16T08:00:00.000Z'
  },
  marketingPolicy: null,
  policyAcceptance: null,
  marketingConsents: []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('server-backed Booking scheduling', () => {
  it('slides between Services and Schedule inside the same canonical shell', async () => {
    window.history.replaceState(
      null,
      '',
      '/mara/booking/main/prv_ava/services/svc_cut?booking=bsn_transition'
    )
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
    const party = {
      id: 'bpt_one',
      bookingSessionId: 'bsn_transition',
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
          providerPreference: { kind: 'specific', providerId: 'prv_ava' },
          providerId: 'prv_ava',
          primaryServiceId: 'svc_cut',
          serviceIds: ['svc_cut'],
          holdId: null,
          holdExpiresAt: null,
          customerAccountId: null,
          customerDetails: null,
          startsAt: null,
          endsAt: null
        }
      ]
    }
    const availability: BookingAvailability = {
      timezone: 'UTC',
      range: { from: '2026-07-15T00:00:00.000Z', days: 60 },
      slots: [
        {
          startsAt: '2026-07-15T14:00:00.000Z',
          endsAt: '2026-07-15T15:00:00.000Z'
        },
        {
          startsAt: '2026-07-15T15:00:00.000Z',
          endsAt: '2026-07-15T16:00:00.000Z'
        }
      ],
      hold: null
    }
    const hold: NonNullable<BookingAvailability['hold']> = {
      id: 'hld_transition',
      bookingSessionId: 'bsn_transition',
      createdAt: '2026-07-15T13:55:00.000Z',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      quote: {
        startsAt: '2026-07-15T14:00:00.000Z',
        endsAt: '2026-07-15T15:00:00.000Z',
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
        totalMinor: 5500
      }
    }
    const replacementHold: NonNullable<BookingAvailability['hold']> = {
      ...hold,
      id: 'hld_transition_replacement',
      quote: {
        ...hold.quote,
        startsAt: '2026-07-15T15:00:00.000Z',
        endsAt: '2026-07-15T16:00:00.000Z'
      }
    }
    let requestedAvailabilityDays: string | null = null
    let resolveHold!: (response: Response) => void
    const holdResponse = new Promise<Response>((resolve) => {
      resolveHold = resolve
    })
    let resolveReplacementHold!: (response: Response) => void
    const replacementHoldResponse = new Promise<Response>((resolve) => {
      resolveReplacementHold = resolve
    })
    let holdRequestCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/selection')) return Response.json(journey)
      if (url.endsWith('/party')) return Response.json(party)
      if (url.endsWith('/checkout-prepare'))
        return Response.json(checkoutPreparation(party))
      if (new URL(url, 'http://localhost').pathname.endsWith('/availability')) {
        requestedAvailabilityDays = new URL(url, 'http://localhost').searchParams.get(
          'days'
        )
        return Response.json(availability)
      }
      if (url.endsWith('/hold') && init?.method === 'POST')
        return holdRequestCount++ === 0 ? holdResponse : replacementHoldResponse
      throw new Error(`unexpected request: ${url}`)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingLocalizationProvider sessionLocale="en">
          <ServerBackedBookingFlow merchantSlug="mara" sessionId="bsn_transition" />
        </BookingLocalizationProvider>
      </QueryClientProvider>
    )

    const viewOrder = await screen.findByRole('button', { name: /view order/i })
    const canonicalShell = viewOrder.closest('[data-booking-shell="canonical"]')
    fireEvent.click(viewOrder)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a time' }))

    await screen.findByTestId('calendarLine')
    const schedulingTitle = await screen.findByText('Choose a time')
    expect(requestedAvailabilityDays).toBe('60')
    expect(window.location.pathname).toBe(
      '/mara/booking/main/prv_ava/services/svc_cut/schedule'
    )
    expect(schedulingTitle.closest('[data-booking-shell="canonical"]')).toBe(
      canonicalShell
    )
    const schedulingViewOrder = screen.getByRole('button', {
      name: /view order, \$50\.00/i
    })
    fireEvent.click(schedulingViewOrder)
    expect(screen.getByRole('dialog', { name: 'Order summary' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close order summary' }))

    fireEvent.click(screen.getByTestId('btn:chooseTime:time:2:00PM'))
    await screen.findByTestId('btn:chooseTime:time:2:00PM:selected')
    const pendingCheckoutOrder = screen.getByRole('button', {
      name: /go to checkout, \$50\.00/i
    })
    expect(pendingCheckoutOrder.getAttribute('data-order-state')).toBe('checkout')
    expect(pendingCheckoutOrder).toHaveProperty('disabled', true)
    resolveHold(Response.json(hold))
    await waitFor(() => expect(pendingCheckoutOrder).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('btn:chooseTime:time:3:00PM'))
    await screen.findByTestId('btn:chooseTime:time:3:00PM:selected')
    expect(pendingCheckoutOrder).toHaveProperty('disabled', true)
    resolveReplacementHold(Response.json(replacementHold))
    await waitFor(() => expect(pendingCheckoutOrder).toHaveProperty('disabled', false))
    expect(screen.getAllByTestId('btn:viewOrder')).toHaveLength(1)
    const checkoutOrder = screen.getByRole('button', {
      name: /go to checkout, \$55\.00/i
    })
    expect(checkoutOrder.getAttribute('data-order-state')).toBe('checkout')
    fireEvent.click(checkoutOrder)
    const heldOrderSummary = screen.getByRole('dialog', { name: 'Order summary' })
    expect(heldOrderSummary.getAttribute('data-cart-mode')).toBe('scheduleChosen')
    expect(within(heldOrderSummary).getByText('$50.00')).toBeTruthy()
    expect(within(heldOrderSummary).getByText('$55.00')).toBeTruthy()
    expect(within(heldOrderSummary).getByTestId('text:aptDate').textContent).toMatch(
      /Jul 15 at 3:00 PM/i
    )
    expect(within(heldOrderSummary).getByText('60 min')).toBeTruthy()
    const schedulingScroll = screen.getByTestId('container:scrollable')
    schedulingScroll.scrollTop = 72
    const bodyOverflow = document.body.style.overflow
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const policy = await screen.findByRole('dialog', { name: 'Cancelation policy' })
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    expect(screen.getByRole('dialog', { name: 'Order summary' })).toBeTruthy()
    expect(within(policy).getByTestId('text:noCancellation').textContent).toBe(
      'According to the cancelation policy, you cannot cancel this appointment.'
    )
    expect(within(policy).getByTestId('btn:confirm').textContent).toBe('OK')
    expect(screen.getByTestId('calendarLine')).toBeTruthy()
    expect(schedulingScroll.scrollTop).toBe(72)
    expect(document.body.style.overflow).toBe(bodyOverflow)
    expect(window.location.pathname).toBe(
      '/mara/booking/main/prv_ava/services/svc_cut/schedule'
    )
    fireEvent.click(within(policy).getByRole('button', { name: 'OK' }))
    const checkout = screen.getByRole('dialog', { name: 'Confirm booking' })
    expect(checkout).not.toBe(policy)
    expect(await within(checkout).findByLabelText('First name')).toBeTruthy()
    expect(screen.getByTestId('calendarLine')).toBeTruthy()
    fireEvent.click(within(checkout).getByRole('button', { name: 'Close' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Order summary' })).getByRole(
        'button',
        { name: 'Close order summary' }
      )
    )
    const forwardRoute = canonicalShell?.querySelector(
      '[data-presence-variant="route"][data-route-direction="forward"]'
    )
    expect(forwardRoute?.querySelector('[data-testid="calendarLine"]')).toBeTruthy()

    fireEvent.click(screen.getByTestId('btn:back'))
    await screen.findByText('Choose a service')
    const backRoute = canonicalShell?.querySelector(
      '[data-presence-variant="route"][data-route-direction="back"]'
    )
    expect(backRoute?.querySelector('[data-testid="service:svc_cut"]')).toBeTruthy()

    fireEvent.click(await screen.findByRole('button', { name: /view order/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose a time' }))
    await screen.findByTestId('calendarLine')
    const reopenedForwardRoute = canonicalShell?.querySelector(
      '[data-presence-variant="route"][data-route-direction="forward"]'
    )
    expect(
      reopenedForwardRoute?.querySelector('[data-testid="calendarLine"]')
    ).toBeTruthy()
    queryClient.clear()
  })

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
        premiumPaletteSource: null,
        adultsOnly: false
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
        premiumPaletteSource: null,
        adultsOnly: false
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
      range: { from: '2026-07-15T00:00:00.000Z', days: 60 },
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
      if (new URL(url, 'http://localhost').pathname.endsWith('/availability')) {
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
    fireEvent.click(screen.getByRole('button', { name: 'Choose a time' }))
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
        premiumPaletteSource: null,
        adultsOnly: false
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
      range: { from: '2026-07-15T00:00:00.000Z', days: 60 },
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
    const checkoutParty = {
      id: 'bpt_expiring',
      bookingSessionId: 'bsn_expiring',
      shopId: 'shp_main',
      activeRequestId: 'brq_expiring',
      lifecycle: 'active',
      currency: 'USD',
      locale: 'en',
      version: 1,
      requests: [
        {
          id: 'brq_expiring',
          bookingPartyId: 'bpt_expiring',
          position: 0,
          providerPreference: 'specific',
          providerId: 'prv_ava',
          primaryServiceId: 'svc_cut',
          serviceIds: ['svc_cut'],
          holdId: 'hld_live',
          holdExpiresAt: availability.hold?.expiresAt ?? null,
          customerAccountId: null,
          customerDetails: null,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          durationMinutes: 60,
          priceMinor: 5000,
          currency: 'USD'
        }
      ],
      durationMinutes: 60,
      totalMinor: 5000
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/selection')) return Response.json(journey)
      if (url.endsWith('/checkout-prepare'))
        return Response.json(checkoutPreparation(checkoutParty))
      if (new URL(url, 'http://localhost').pathname.endsWith('/availability'))
        return Response.json(availability)
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
    fireEvent.click(screen.getByRole('button', { name: 'Choose a time' }))
    await screen.findByTestId('calendarLine')
    fireEvent.click(
      await screen.findByRole('button', { name: /go to checkout, \$50\.00/i })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'Mia' }
    })
    fireEvent.change(await screen.findByLabelText('Last name'), {
      target: { value: 'Test' }
    })
    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '202 555 0123' }
    })
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'mia@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    expect(await screen.findByRole('link', { name: 'Start again' })).toHaveProperty(
      'pathname',
      '/mara/booking'
    )
    queryClient.clear()
  })
})
