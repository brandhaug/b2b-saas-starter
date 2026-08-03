import { describe, expect, it } from 'vitest'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import {
  groupAppointmentClients,
  makeDraftAppointmentClient
} from './mobile-appointment-client-model.ts'

const customerRecord = (
  input: Pick<
    CustomerRecord,
    'id' | 'displayName' | 'preferredEmail' | 'preferredPhone'
  > &
    Partial<Pick<CustomerRecord, 'contacts' | 'observations'>>
): CustomerRecord => ({
  merchantId: 'mer_test',
  status: 'active',
  contacts: [],
  observations: [],
  notes: [],
  consent: [],
  ban: null,
  possibleDuplicateOf: [],
  mergedInto: null,
  revision: 1,
  lastActivityAt: '2026-07-25T10:00:00.000Z',
  history: [],
  ...input
})

const entries: readonly CustomerRecord[] = [
  customerRecord({
    id: 'cur_b',
    displayName: 'Bianca Trifan',
    preferredEmail: 'bianca@example.test',
    preferredPhone: null
  }),
  customerRecord({
    id: 'cur_a',
    displayName: 'Alex Raucescu',
    preferredEmail: 'alex@example.test',
    preferredPhone: '+40711111111',
    contacts: [
      {
        kind: 'email',
        value: 'alex.old@example.test',
        status: 'superseded',
        preferred: false
      }
    ],
    observations: [
      {
        id: 'cuo_alex_old',
        appointmentId: 'apt_alex_old',
        details: {
          name: 'Alex Ionescu',
          email: 'alex.old@example.test',
          phone: null
        },
        observedAt: '2026-06-25T10:00:00.000Z',
        source: 'appointment'
      }
    ]
  })
]

describe('appointment client model', () => {
  it('filters and alphabetizes durable Customer Records', () => {
    expect(groupAppointmentClients(entries, 'example.test')).toEqual([
      { letter: 'A', entries: [entries[1]] },
      { letter: 'B', entries: [entries[0]] }
    ])
    expect(groupAppointmentClients(entries, 'Alex Ionescu')).toEqual([
      { letter: 'A', entries: [entries[1]] }
    ])
    expect(groupAppointmentClients(entries, 'alex.old@example')).toEqual([
      { letter: 'A', entries: [entries[1]] }
    ])
    expect(groupAppointmentClients(entries, '(407) 111-111-11')).toEqual([
      { letter: 'A', entries: [entries[1]] }
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
