// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomerConfirmation } from '@b2b-saas-starter/capabilities/booking'
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
  customerDetails: { name: 'gg', email: 'gg@example.test', phone: null },
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
} satisfies CustomerConfirmation

describe('Booking confirmation route flow', () => {
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
})
