import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import type { StoredAppointmentSnapshot } from '@b2b-saas-starter/db'
import {
  AppointmentOperations,
  appointmentCalendarUtcRange,
  SeedAppointmentOperations,
  type OperationalAppointment
} from './appointment-operations.ts'
import {
  MerchantContext,
  testMerchantContext,
  type MerchantIdentity
} from '../merchant-catalog/merchant-context.ts'

const merchant: MerchantIdentity = {
  id: 'merchant_one',
  publicName: 'One Studio',
  slug: 'one-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'team'
}

const snapshot = (name: string, email: string): StoredAppointmentSnapshot => ({
  startsAt: '2026-07-11T09:00:00.000Z',
  endsAt: '2026-07-11T09:45:00.000Z',
  providerPreference: { kind: 'any' },
  assignedProvider: { id: 'provider_one', displayName: 'Original Provider' },
  services: [
    {
      id: 'service_one',
      role: 'primary',
      name: 'Original Service',
      durationMinutes: 45,
      priceMinor: 9000,
      currency: 'RON'
    }
  ],
  durationMinutes: 45,
  currency: 'RON',
  totalMinor: 9000,
  merchantTimezone: 'Europe/Bucharest',
  customerDetails: { name, email, phone: '+40123456789' },
  checkoutPath: 'pay_in_person'
})

const appointments: ReadonlyArray<OperationalAppointment> = [
  {
    id: 'past',
    merchantId: merchant.id,
    providerId: 'provider_one',
    status: 'completed',
    startsAt: '2026-07-10T09:00:00.000Z',
    endsAt: '2026-07-10T09:45:00.000Z',
    snapshot: snapshot('Alex Doe', 'shared@example.com'),
    createdAt: '2026-07-01T10:00:00.000Z'
  },
  {
    id: 'future',
    merchantId: merchant.id,
    providerId: 'provider_one',
    status: 'scheduled',
    startsAt: '2026-07-11T09:00:00.000Z',
    endsAt: '2026-07-11T09:45:00.000Z',
    snapshot: snapshot('Alex Doe', 'shared@example.com'),
    createdAt: '2026-07-01T10:00:00.000Z'
  },
  {
    id: 'other',
    merchantId: 'merchant_other',
    providerId: 'provider_other',
    status: 'scheduled',
    startsAt: '2026-07-11T10:00:00.000Z',
    endsAt: '2026-07-11T10:45:00.000Z',
    snapshot: snapshot('Hidden Person', 'hidden@example.com'),
    createdAt: '2026-07-01T10:00:00.000Z'
  }
]

const run = <A>(
  effect: Effect.Effect<A, unknown, AppointmentOperations | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(
        SeedAppointmentOperations(appointments),
        testMerchantContext(merchant)
      )
    )
  )

describe('AppointmentOperations', () => {
  it('builds timezone-correct UTC ranges across daylight-saving changes', () => {
    expect(appointmentCalendarUtcRange('2026-03-29', 'Europe/Bucharest')).toEqual({
      startsAt: '2026-03-28T22:00:00.000Z',
      endsAt: '2026-03-29T21:00:00.000Z'
    })
    expect(appointmentCalendarUtcRange('2026-10-25', 'Europe/Bucharest')).toEqual({
      startsAt: '2026-10-24T21:00:00.000Z',
      endsAt: '2026-10-25T22:00:00.000Z'
    })
  })

  it('groups the selected day by the immutable assigned Provider snapshot', async () => {
    const calendar = await run(
      Effect.flatMap(AppointmentOperations, (service) => service.calendar('2026-07-11'))
    )

    expect(calendar.providers).toEqual([
      {
        provider: { id: 'provider_one', displayName: 'Original Provider' },
        appointments: [expect.objectContaining({ id: 'future' })]
      }
    ])
  })

  it('returns immutable Appointment facts and hides another Merchant appointment', async () => {
    const found = await run(
      Effect.flatMap(AppointmentOperations, (service) => service.detail('future'))
    )
    const hidden = await run(
      Effect.flatMap(AppointmentOperations, (service) => service.detail('other'))
    )

    expect(found).toEqual(
      expect.objectContaining({
        kind: 'found',
        appointment: expect.objectContaining({
          snapshot: expect.objectContaining({
            assignedProvider: { id: 'provider_one', displayName: 'Original Provider' },
            services: [expect.objectContaining({ name: 'Original Service' })]
          })
        })
      })
    )
    expect(hidden).toEqual({ kind: 'not_found' })
  })

  it('derives one Customer Directory entry per Appointment without deduplication', async () => {
    const directory = await run(
      Effect.flatMap(AppointmentOperations, (service) => service.customers())
    )

    expect(directory.timezone).toBe('Europe/Bucharest')
    expect(directory.entries).toHaveLength(2)
    expect(directory.entries.map((entry) => entry.appointmentId)).toEqual([
      'future',
      'past'
    ])
    expect(new Set(directory.entries.map((entry) => entry.email))).toEqual(
      new Set(['shared@example.com'])
    )
  })

  it('returns deterministic empty calendar and directory states', async () => {
    const calendar = await run(
      Effect.flatMap(AppointmentOperations, (service) => service.calendar('2026-07-12'))
    )
    const directory = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(AppointmentOperations, (service) => service.customers()),
        Layer.merge(SeedAppointmentOperations([]), testMerchantContext(merchant))
      )
    )

    expect(calendar.providers).toEqual([])
    expect(directory.entries).toEqual([])
  })
})
