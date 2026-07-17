import { describe, expect, it } from 'vitest'
import type { CustomerConfirmation } from '@b2b-saas-starter/capabilities/booking'
import { renderBookingConfirmationView } from './booking-confirmation-view.ts'

const snapshot = {
  startsAt: '2026-07-18T18:00:00.000Z',
  endsAt: '2026-07-18T18:30:00.000Z',
  providerPreference: { kind: 'specific' as const, providerId: 'prv_ava' },
  assignedProvider: { id: 'prv_ava', displayName: 'Ava S.' },
  services: [
    {
      id: 'svc_beard',
      role: 'primary' as const,
      name: 'Beard Trim',
      durationMinutes: 30,
      priceMinor: 2800,
      currency: 'USD'
    }
  ],
  durationMinutes: 30,
  currency: 'USD',
  totalMinor: 2800,
  merchantTimezone: 'America/New_York',
  customerDetails: { name: 'gg', email: 'gg@example.test', phone: null },
  checkoutPath: 'pay_in_person' as const,
  cancellationPolicy: {
    id: 'cancellation:default:v1',
    version: 1,
    cancellableUntilMinutesBeforeStart: 60
  }
}

const confirmation = (status: CustomerConfirmation['status']) =>
  ({
    routeId: 'cnf_demo',
    status,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    locale: 'en',
    snapshot,
    appointments: [
      {
        id: 'apt_DEMO123',
        status,
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
        snapshot
      }
    ],
    shop: {
      publicName: 'SQUIRE Demo Barbershop',
      coverPhotoUrl: 'https://images.example.test/shop.jpg',
      addressLines: ['21 Mercer Street', 'New York', 'NY 10013'],
      coordinates: { latitude: 40.723, longitude: -74.0 }
    }
  }) satisfies CustomerConfirmation

describe('legacy reservation confirmation view', () => {
  it('renders the complete scheduled legacy reservation hierarchy', () => {
    const html = renderBookingConfirmationView(confirmation('scheduled'))

    expect(html).toContain('gg, your appointment is confirmed!')
    expect(html).toContain('data-testid="text:servicePrice"')
    expect(html).toContain('data-testid="text:confirmationCode"')
    expect(html).toContain('data-testid="btn:calendar:apple"')
    expect(html).toContain('data-testid="unfold:taxes-n-fees"')
    expect(html).toContain('data-testid="text:shopAddress"')
    expect(html).toContain('data-testid="btn:getDirections"')
    expect(html).toContain(
      "background-image:url('https://images.example.test/shop.jpg')"
    )
    expect(html).toContain('data-testid="btn:reschedule"')
    expect(html).toContain('data-testid="btn:cancel"')
  })

  it('uses the legacy cancelled title, icon, payment status, and actions', () => {
    const html = renderBookingConfirmationView(confirmation('cancelled'))

    expect(html).toContain('Appointment canceled')
    expect(html).toContain('fill="#FF3B30"')
    expect(html).toContain('class="payment-label is-cancelled"')
    expect(html).not.toContain('data-testid="text:confirmationCode"')
    expect(html).not.toContain('data-testid="btn:calendar:apple"')
    expect(html).not.toContain('data-testid="btn:reschedule"')
    expect(html).not.toContain('data-testid="btn:cancel"')
    expect(html).toContain('data-testid="btn:scheduleAnother"')
    expect(html.indexOf('data-testid="btn:scheduleAnother"')).toBeLessThan(
      html.indexOf('class="shop-marker"')
    )
  })
})
