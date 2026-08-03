import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type {
  OperationalAppointment,
  ProviderCalendar
} from '@b2b-saas-starter/capabilities/booking'
import { merchantHomeCalendarQueryKey } from '@/lib/merchant-home-queries.ts'
import { cachedAppointmentDetail } from './cached-appointment-detail.ts'

const appointment: OperationalAppointment = {
  id: 'apt_cached',
  merchantId: 'mrc_cached',
  providerId: 'prv_cached',
  status: 'scheduled',
  startsAt: '2026-07-20T09:00:00.000Z',
  endsAt: '2026-07-20T09:30:00.000Z',
  createdAt: '2026-07-19T09:00:00.000Z',
  snapshot: {
    startsAt: '2026-07-20T09:00:00.000Z',
    endsAt: '2026-07-20T09:30:00.000Z',
    providerPreference: { kind: 'any' },
    assignedProvider: { id: 'prv_cached', displayName: 'Mara Ionescu' },
    services: [
      {
        id: 'svc_cached',
        role: 'primary',
        name: 'Signature Cut',
        durationMinutes: 30,
        beforeBufferMinutes: 0,
        afterBufferMinutes: 0,
        priceMinor: 2300,
        currency: 'USD'
      }
    ],
    durationMinutes: 30,
    beforeBufferMinutes: 0,
    afterBufferMinutes: 0,
    occupiedStartsAt: '2026-07-20T09:00:00.000Z',
    occupiedEndsAt: '2026-07-20T09:30:00.000Z',
    currency: 'USD',
    totalMinor: 2300,
    merchantTimezone: 'Europe/Bucharest',
    customerDetails: {
      name: 'Parity Customer',
      email: 'parity@example.com',
      phone: '+40722325637'
    },
    checkoutPath: 'pay_in_person'
  }
}

describe('cachedAppointmentDetail', () => {
  it('resolves a tapped appointment from any cached merchant calendar', () => {
    const queryClient = new QueryClient()
    const calendar: ProviderCalendar = {
      date: '2026-07-20',
      timezone: 'Europe/Bucharest',
      providers: [
        {
          provider: appointment.snapshot.assignedProvider,
          appointments: [appointment]
        }
      ]
    }
    queryClient.setQueryData(merchantHomeCalendarQueryKey(calendar.date), calendar)

    expect(cachedAppointmentDetail(queryClient, appointment.id)).toBe(appointment)
  })

  it('returns undefined when the appointment is not cached', () => {
    expect(cachedAppointmentDetail(new QueryClient(), 'apt_missing')).toBeUndefined()
  })
})
