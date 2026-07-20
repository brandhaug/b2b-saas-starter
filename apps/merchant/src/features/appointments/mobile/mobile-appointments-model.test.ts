import { describe, expect, it } from 'vitest'
import { mobileAppointmentLedger, mobileWeek } from './mobile-appointments-model.ts'

describe('mobileWeek', () => {
  it('builds a Monday-first week around the selected day', () => {
    expect(mobileWeek('2026-07-22')).toEqual([
      { date: '2026-07-20', day: '20', weekday: 'Mon', selected: false },
      { date: '2026-07-21', day: '21', weekday: 'Tue', selected: false },
      { date: '2026-07-22', day: '22', weekday: 'Wed', selected: true },
      { date: '2026-07-23', day: '23', weekday: 'Thu', selected: false },
      { date: '2026-07-24', day: '24', weekday: 'Fri', selected: false },
      { date: '2026-07-25', day: '25', weekday: 'Sat', selected: false },
      { date: '2026-07-26', day: '26', weekday: 'Sun', selected: false }
    ])
  })
})

describe('mobileAppointmentLedger', () => {
  it('orders Appointments chronologically across Providers', () => {
    const groups = [
      {
        provider: { displayName: 'Ana' },
        appointments: [appointment('apt_late', '2026-07-20T14:00:00.000Z', 'Mia')]
      },
      {
        provider: { displayName: 'Mara' },
        appointments: [appointment('apt_early', '2026-07-20T08:00:00.000Z', 'Leon')]
      }
    ]

    expect(mobileAppointmentLedger(groups, 'UTC')).toEqual([
      {
        id: 'apt_early',
        customerName: 'Leon',
        providerName: 'Mara',
        serviceNames: 'Haircut',
        startsAt: '2026-07-20T08:00:00.000Z',
        status: 'scheduled',
        time: '08:00'
      },
      {
        id: 'apt_late',
        customerName: 'Mia',
        providerName: 'Ana',
        serviceNames: 'Haircut',
        startsAt: '2026-07-20T14:00:00.000Z',
        status: 'scheduled',
        time: '14:00'
      }
    ])
  })
})

function appointment(id: string, startsAt: string, customerName: string) {
  return {
    id,
    startsAt,
    status: 'scheduled' as const,
    snapshot: {
      customerDetails: { name: customerName },
      services: [{ name: 'Haircut' }]
    }
  }
}
