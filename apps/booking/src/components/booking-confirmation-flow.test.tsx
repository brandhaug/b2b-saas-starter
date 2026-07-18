// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingConfirmationPresentation } from '../lib/booking-confirmation-presentation.ts'
import { BookingConfirmationRouteFlow } from './booking-confirmation-flow.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const snapshot = {
  startsAt: '2026-07-20T06:00:00.000Z',
  endsAt: '2026-07-20T07:00:00.000Z',
  providerPreference: { kind: 'specific' as const, providerId: 'prv_mara' },
  assignedProvider: { id: 'prv_mara', displayName: 'Mara Ionescu' },
  services: [
    {
      id: 'svc_cut',
      role: 'primary' as const,
      name: 'Signature Cut',
      durationMinutes: 60,
      priceMinor: 9000,
      currency: 'RON'
    }
  ],
  durationMinutes: 60,
  currency: 'RON',
  totalMinor: 9000,
  merchantTimezone: 'Europe/Bucharest',
  checkoutPath: 'pay_in_person' as const,
  cancellationPolicy: {
    id: 'cancellation:default:v1',
    version: 1,
    cancellableUntilMinutesBeforeStart: 60
  }
}

const confirmation = {
  routeId: 'cnf_demo',
  status: 'scheduled' as const,
  startsAt: snapshot.startsAt,
  endsAt: snapshot.endsAt,
  locale: 'en' as const,
  customerFirstName: 'gg',
  snapshot,
  appointments: [
    {
      id: 'apt_DEMO123',
      status: 'scheduled' as const,
      startsAt: snapshot.startsAt,
      endsAt: snapshot.endsAt,
      snapshot
    }
  ],
  shop: {
    publicName: 'Mara Booking Studio',
    coverPhotoUrl: 'https://images.example.test/mara.jpg',
    addressLines: ['Strada Lipscani 21', 'București'],
    coordinates: { latitude: 44.4314, longitude: 26.1002 }
  }
} satisfies BookingConfirmationPresentation

describe('Booking confirmation route flow', () => {
  it('does not imply payment status or chargeability for no-card Pay In Person', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(confirmation))
    )

    render(
      <BookingConfirmationRouteFlow
        merchantSlug="mara-booking-studio"
        routeId="cnf_demo"
        embedding="standalone"
      />
    )

    expect((await screen.findByTestId('text:payInPerson')).textContent).toBe(
      'Pay in person'
    )
    expect(screen.queryByText('Pending payment')).toBeNull()
    expect(
      screen.queryByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent?.includes('You will only be charged') === true
      )
    ).toBeNull()
  })

  it('renders the legacy reservation hierarchy inside the canonical booking shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(confirmation))
    )

    const { container } = render(
      <BookingConfirmationRouteFlow
        merchantSlug="mara-booking-studio"
        routeId="cnf_demo"
        embedding="standalone"
      />
    )

    const title = await screen.findByTestId('container:title')
    const scrollable = screen.getByTestId('container:scrollable')
    const shell = title.closest('[data-booking-shell="canonical"]')

    expect(shell).toBeTruthy()
    expect(scrollable.closest('[data-booking-shell="canonical"]')).toBe(shell)
    expect(container.querySelectorAll('[data-booking-shell="canonical"]')).toHaveLength(
      1
    )
    expect(shell?.tagName).toBe('DIV')
    expect(screen.getByTestId('text:apptConfirmationTitle').textContent).toBe(
      'gg, your appointment is confirmed!'
    )
    expect(screen.getByTestId('container:orderApptGroup')).toBeTruthy()
    expect(screen.queryByTestId('text:customerName')).toBeNull()
    const appointmentCard = screen.getByTestId('container:groupAppt')
    expect(appointmentCard.children).toHaveLength(3)
    expect(screen.getByTestId('text:barberName').textContent).toBe('Mara I.')
    expect(screen.getByTestId('service:svc_cut')).toBeTruthy()
    expect(screen.queryByTestId('text:servicePrice')).toBeNull()
    expect(
      screen
        .getByTestId('btn:calendar:apple')
        .querySelector('svg')
        ?.getAttribute('width')
    ).toBe('14px')
    expect(
      screen
        .getByTestId('btn:calendar:google')
        .querySelector('svg')
        ?.getAttribute('width')
    ).toBe('16px')
    expect(
      screen
        .getByTestId('btn:calendar:yahoo')
        .querySelector('svg')
        ?.getAttribute('width')
    ).toBe('14px')
    for (const kind of ['apple', 'google', 'yahoo'])
      expect(
        screen
          .getByTestId(`btn:calendar:${kind}`)
          .querySelector('svg')
          ?.getAttribute('height')
      ).toBe('16px')
    expect(screen.getByTestId('text:shopName').tagName).toBe('P')
    expect(screen.getByTestId('text:shopAddress').tagName).toBe('P')
    expect(screen.getByTestId('btn:getDirections').firstElementChild?.tagName).toBe('P')
    const taxesToggle = screen.getByTestId('unfold:taxes-n-fees')
    expect(taxesToggle.tagName).toBe('P')
    expect(taxesToggle.querySelector('svg')?.getAttribute('width')).toBe('9')
    expect(taxesToggle.querySelector('svg')?.getAttribute('height')).toBe('16')
    expect(taxesToggle.querySelector('path')?.getAttribute('d')).toContain(
      'M8.07552 15.8411'
    )
    fireEvent.click(taxesToggle)
    await waitFor(() => expect(screen.queryByTestId('unfold:taxes-n-fees')).toBeNull())
    expect(fetch).toHaveBeenCalledWith(
      '/mara-booking-studio/booking/confirmations/cnf_demo/data',
      expect.objectContaining({ credentials: 'same-origin' })
    )

    fireEvent.click(screen.getByTestId('btn:cancel'))
    const cancelPopup = await screen.findByRole('dialog', { name: 'Cancel order' })
    expect(cancelPopup.closest('[data-booking-shell="canonical"]')).toBe(shell)
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the legacy cancelled hierarchy inside the same shell', async () => {
    const cancelled = {
      ...confirmation,
      status: 'cancelled' as const,
      appointments: confirmation.appointments.map((appointment) => ({
        ...appointment,
        status: 'cancelled' as const
      }))
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(cancelled))
    )

    render(
      <BookingConfirmationRouteFlow
        merchantSlug="mara-booking-studio"
        routeId="cnf_demo"
        embedding="standalone"
      />
    )

    expect(await screen.findByText('Appointment canceled')).toBeTruthy()
    expect(screen.queryByTestId('text:confirmationCode')).toBeNull()
    expect(screen.queryByTestId('btn:calendar:apple')).toBeNull()
    expect(screen.queryByTestId('btn:reschedule')).toBeNull()
    expect(screen.queryByTestId('btn:cancel')).toBeNull()
    const scheduleAnother = screen.getByTestId('btn:scheduleAnother')
    const shop = screen.getByTestId('text:shopName')
    expect(
      scheduleAnother.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(scheduleAnother.closest('[data-booking-shell="canonical"]')).toBeTruthy()
  })

  it('opens the legacy reschedule popup before preparing a replacement time', async () => {
    let resolveBegin!: (response: Response) => void
    const begin = new Promise<Response>((resolve) => {
      resolveBegin = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/data')) return Promise.resolve(Response.json(confirmation))
      if (url.endsWith('/appointments/apt_DEMO123/reschedule')) return begin
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BookingConfirmationRouteFlow
        merchantSlug="mara-booking-studio"
        routeId="cnf_demo"
        embedding="standalone"
      />
    )

    fireEvent.click(await screen.findByTestId('btn:reschedule'))

    const popup = await screen.findByTestId('popup:rescheduleAppointment')
    expect(popup.getAttribute('role')).toBe('dialog')
    expect(popup.getAttribute('aria-label')).toBe('Reschedule appointment')
    expect(popup.querySelector('h2')?.textContent).toBe('Reschedule appointment')
    expect(screen.getByText('Finding available times…')).toBeTruthy()
    expect(document.body.style.overflow).toBe('')
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/appointments/apt_DEMO123/reschedule'),
        expect.objectContaining({ method: 'POST' })
      )
    )

    resolveBegin(Response.json({ bookingSessionId: 'bsn_reschedule' }))
  })

  it('shows the legacy confirm control after holding a replacement time', async () => {
    const startsAt = '2026-07-21T07:00:00.000Z'
    const endsAt = '2026-07-21T08:00:00.000Z'
    const availability = {
      timezone: 'Europe/Bucharest',
      range: { from: '2026-07-21T00:00:00.000Z', days: 60 },
      slots: [{ startsAt, endsAt }],
      hold: null
    }
    const hold = {
      id: 'hld_reschedule',
      bookingSessionId: 'bsn_reschedule',
      bookingRequestId: 'bkr_reschedule',
      createdAt: '2026-07-18T10:00:00.000Z',
      expiresAt: '2026-07-18T10:15:00.000Z',
      quote: {
        startsAt,
        endsAt,
        providerPreference: { kind: 'specific' as const, providerId: 'prv_mara' },
        assignedProvider: { id: 'prv_mara', displayName: 'Mara Ionescu' },
        services: snapshot.services,
        durationMinutes: 60,
        currency: 'RON',
        totalMinor: 9000
      }
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/data')) return Response.json(confirmation)
      if (url.endsWith('/appointments/apt_DEMO123/reschedule'))
        return Response.json({ id: 'rsc_demo', bookingSessionId: 'bsn_reschedule' })
      if (url.includes('/availability?')) return Response.json(availability)
      if (url.endsWith('/hold')) return Response.json(hold)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BookingConfirmationRouteFlow
        merchantSlug="mara-booking-studio"
        routeId="cnf_demo"
        embedding="standalone"
      />
    )

    fireEvent.click(await screen.findByTestId('btn:reschedule'))
    const time = await screen.findByRole('button', { name: '10:00 AM' })
    fireEvent.click(time)

    expect(await screen.findByTestId('btn:confirm')).toBeTruthy()
    expect(screen.getByTestId('popup:rescheduleAppointment')).toBeTruthy()
    expect(document.body.style.overflow).toBe('')
  })
})
