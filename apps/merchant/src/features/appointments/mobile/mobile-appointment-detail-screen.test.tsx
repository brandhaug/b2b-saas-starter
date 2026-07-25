import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import {
  MobileAppointmentDetailScreen,
  mobileAppointmentPaymentLabel
} from './mobile-appointment-detail-screen.tsx'

const appointment = (
  overrides: Partial<OperationalAppointment> = {}
): OperationalAppointment => ({
  id: 'apt_detail',
  merchantId: 'mrc_detail',
  providerId: 'prv_mara',
  status: 'scheduled',
  startsAt: '2026-07-24T09:00:00.000Z',
  endsAt: '2026-07-24T09:30:00.000Z',
  createdAt: '2026-07-20T09:00:00.000Z',
  snapshot: {
    startsAt: '2026-07-24T09:00:00.000Z',
    endsAt: '2026-07-24T09:30:00.000Z',
    providerPreference: { kind: 'specific', providerId: 'prv_mara' },
    assignedProvider: { id: 'prv_mara', displayName: 'Mara Ionescu' },
    services: [
      {
        id: 'svc_cut',
        role: 'primary',
        name: 'Signature Cut',
        durationMinutes: 30,
        priceMinor: 2300,
        currency: 'USD'
      }
    ],
    durationMinutes: 30,
    currency: 'USD',
    totalMinor: 2300,
    merchantTimezone: 'Europe/Bucharest',
    customerDetails: {
      name: 'Parity Customer',
      email: 'parity@example.com',
      phone: '+40722325637'
    },
    checkoutPath: 'pay_in_person'
  },
  ...overrides
})

describe('MobileAppointmentDetailScreen', () => {
  it('renders the compact detail hierarchy and real action links', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentDetailScreen
        appointment={appointment()}
        bookingUrl="/mara/booking"
      />
    )

    expect(html).toContain('data-mobile-appointment-detail="true"')
    expect(html).toContain('Parity Customer')
    expect(html).toContain('Signature Cut')
    expect(html).toContain('Due in person')
    expect(html).toContain('href="tel:+40722325637"')
    expect(html).toContain('href="mailto:parity@example.com"')
    expect(html).toContain('href="/mara/booking"')
    expect(html).toContain('New booking')
  })

  it('uses completed and paid-online labels without inventing a refund state', () => {
    const completed = appointment({
      status: 'completed',
      snapshot: {
        ...appointment().snapshot,
        checkoutPath: 'online_payment'
      }
    })
    const html = renderToStaticMarkup(
      <MobileAppointmentDetailScreen appointment={completed} />
    )

    expect(mobileAppointmentPaymentLabel(completed)).toBe('Paid online')
    expect(html).toContain('Completed')
    expect(html).toContain('Paid online')
    expect(html).toContain('Book again')
    expect(html).not.toContain('Refund')
  })

  it('keeps contact details inactive until the sensitive detail read succeeds', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentDetailScreen
        appointment={appointment()}
        bookingUrl="/mara/booking"
        contactActionsEnabled={false}
      />
    )

    expect(html).toContain('Loading contact…')
    expect(html).not.toContain('href="tel:+40722325637"')
    expect(html).not.toContain('href="mailto:parity@example.com"')
    expect(html).toContain('Parity Customer')
    expect(html).toContain('Signature Cut')
  })

  it('does not claim a cancelled online payment is still paid', () => {
    const cancelled = appointment({
      status: 'cancelled',
      snapshot: {
        ...appointment().snapshot,
        checkoutPath: 'online_payment'
      }
    })

    expect(mobileAppointmentPaymentLabel(cancelled)).toBe('Online payment')
  })
})
