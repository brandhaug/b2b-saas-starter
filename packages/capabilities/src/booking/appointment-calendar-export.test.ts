import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { appointmentCalendarExport } from './appointment-calendar-export.ts'

describe('Appointment Calendar Export', () => {
  it('renders one privacy-minimal on-demand event from customer-visible snapshots', () => {
    const calendar = Effect.runSync(
      appointmentCalendarExport({
        generatedAt: '2026-08-03T10:11:12.000Z',
        appointmentId: 'apt_public_123',
        appointments: [
          {
            id: 'apt_public_123',
            status: 'scheduled',
            startsAt: '2026-08-04T07:00:00.000Z',
            endsAt: '2026-08-04T08:00:00.000Z',
            snapshot: {
              services: [{ name: 'Cut, wash & style' }, { name: 'Beard trim; shape' }]
            }
          }
        ],
        shop: {
          publicName: 'Mara Studio',
          addressLines: ['Strada Exemplu 1', 'Bucuresti, Romania']
        }
      })
    )

    expect(calendar).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')
    expect(calendar).toContain('UID:appointment-apt_public_123@beesolo\r\n')
    expect(calendar).toContain('DTSTAMP:20260803T101112Z\r\n')
    expect(calendar).toContain('DTSTART:20260804T070000Z\r\n')
    expect(calendar).toContain('DTEND:20260804T080000Z\r\n')
    expect(calendar).toContain(
      'SUMMARY:Cut\\, wash & style + Beard trim\\; shape — Mara Studio\r\n'
    )
    expect(calendar).toContain('LOCATION:Strada Exemplu 1\\, Bucuresti\\, Romania\r\n')
    expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('folds long UTF-8 content lines without exceeding the calendar limit', () => {
    const calendar = Effect.runSync(
      appointmentCalendarExport({
        generatedAt: '2026-08-03T10:11:12.000Z',
        appointmentId: 'apt_long',
        appointments: [
          {
            id: 'apt_long',
            status: 'scheduled',
            startsAt: '2026-08-04T07:00:00.000Z',
            endsAt: '2026-08-04T08:00:00.000Z',
            snapshot: {
              services: [{ name: 'Îngrijire premium '.repeat(8) }]
            }
          }
        ],
        shop: { publicName: 'Studio București' }
      })
    )

    const encoder = new TextEncoder()
    expect(
      calendar
        .split('\r\n')
        .filter(Boolean)
        .every((line) => encoder.encode(line).byteLength <= 75)
    ).toBe(true)
    expect(calendar).toContain('\r\n ')
  })

  it('escapes every newline form instead of allowing property injection', () => {
    const calendar = Effect.runSync(
      appointmentCalendarExport({
        generatedAt: '2026-08-03T10:11:12.000Z',
        appointmentId: 'apt_safe',
        appointments: [
          {
            id: 'apt_safe',
            status: 'scheduled',
            startsAt: '2026-08-04T07:00:00.000Z',
            endsAt: '2026-08-04T08:00:00.000Z',
            snapshot: { services: [{ name: 'Cut\rATTENDEE:private@example.test' }] }
          }
        ],
        shop: { publicName: 'Mara Studio' }
      })
    )

    expect(calendar).toContain(
      'SUMMARY:Cut\\nATTENDEE:private@example.test — Mara Studio'
    )
    expect(calendar).not.toContain('\rATTENDEE:')
  })
})
