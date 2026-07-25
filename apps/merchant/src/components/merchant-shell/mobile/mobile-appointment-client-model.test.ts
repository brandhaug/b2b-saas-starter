import { describe, expect, it } from 'vitest'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import {
  groupAppointmentClients,
  makeDraftAppointmentClient
} from './mobile-appointment-client-model.ts'

const entries: CustomerDirectory['entries'] = [
  {
    appointmentId: 'apt_b',
    appointmentStatus: 'scheduled',
    scheduledAt: '2026-07-25T10:00:00.000Z',
    name: 'Bianca Trifan',
    email: 'bianca@example.test',
    phone: null
  },
  {
    appointmentId: 'apt_a',
    appointmentStatus: 'completed',
    scheduledAt: '2026-07-20T10:00:00.000Z',
    name: 'Alex Raucescu',
    email: 'alex@example.test',
    phone: '+40711111111'
  }
]

describe('appointment client model', () => {
  it('filters and alphabetizes directory entries without merging snapshots', () => {
    expect(groupAppointmentClients(entries, 'example.test')).toEqual([
      { letter: 'A', entries: [entries[1]] },
      { letter: 'B', entries: [entries[0]] }
    ])
  })

  it('builds customer details for the appointment draft', () => {
    expect(
      makeDraftAppointmentClient({
        firstName: ' Mara ',
        lastName: ' Ionescu ',
        email: ' Mara@Example.test ',
        phone: ' +40 711 111 111 ',
        birthday: '1990-05-14',
        prepaidOnly: true,
        notes: 'Prefers quiet appointments.'
      })
    ).toMatchObject({
      id: expect.stringMatching(/^draft:/),
      name: 'Mara Ionescu',
      email: 'mara@example.test',
      phone: '+40 711 111 111',
      source: 'draft',
      draftProfile: {
        birthday: '1990-05-14',
        blockBooking: false,
        prepaidOnly: true,
        notes: 'Prefers quiet appointments.'
      }
    })
  })
})
