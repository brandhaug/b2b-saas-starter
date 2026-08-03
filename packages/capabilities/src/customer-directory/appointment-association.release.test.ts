import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appointmentFoundations,
  appointments,
  batch,
  Database,
  layerFromD1,
  merchantMemberships,
  merchants,
  providers,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { prepareAppointmentCustomerAssociation } from './appointment-association.ts'

let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(user).values({
          id: 'usr_release_association',
          email: 'owner@release-association.test',
          name: 'Owner',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date('2026-08-03T10:00:00.000Z'),
          updatedAt: new Date('2026-08-03T10:00:00.000Z')
        })
        yield* db.insert(merchants).values({
          id: 'mer_release_association',
          publicName: 'Release Association Studio',
          slug: 'release-association-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo',
          createdAt: '2026-08-03T10:00:00.000Z',
          updatedAt: '2026-08-03T10:00:00.000Z'
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_release_association',
          userId: 'usr_release_association',
          role: 'owner',
          createdAt: '2026-08-03T10:00:00.000Z'
        })
        yield* db.insert(providers).values({
          id: 'prv_release_association',
          merchantId: 'mer_release_association',
          linkedUserId: 'usr_release_association',
          displayName: 'Owner',
          status: 'active',
          isDefault: true,
          createdAt: '2026-08-03T10:00:00.000Z',
          updatedAt: '2026-08-03T10:00:00.000Z'
        })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Appointment Customer association release contract', () => {
  it('fails before preparing writes for an Appointment owned by another Merchant', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values({
            id: 'apt_cross_merchant_association',
            merchantId: 'mer_release_association',
            providerId: 'prv_release_association',
            status: 'scheduled',
            startsAt: '2026-08-05T10:00:00.000Z',
            endsAt: '2026-08-05T11:00:00.000Z',
            createdAt: '2026-08-03T10:00:00.000Z',
            updatedAt: '2026-08-03T10:00:00.000Z'
          })
        }),
        layerFromD1(test.d1)
      )
    )

    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const db = yield* Database
            return yield* prepareAppointmentCustomerAssociation(db, {
              merchantId: 'mer_requesting_other',
              appointment: {
                id: 'apt_cross_merchant_association',
                details: {
                  name: 'Cross Merchant',
                  email: 'cross-merchant@example.com',
                  phone: null
                }
              },
              origin: 'public_booking',
              now: '2026-08-03T12:00:00.000Z'
            })
          }),
          layerFromD1(test.d1)
        )
      )
    ).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable',
      reason: 'appointment association unavailable'
    })

    const leaked = await test.d1
      .prepare(`SELECT count(*) count FROM customer_records WHERE merchant_id = ?`)
      .bind('mer_requesting_other')
      .first<{ count: number }>()
    expect(leaked?.count).toBe(0)
  })

  it('converges only the association without rewriting Booking snapshot facts', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values({
            id: 'apt_release_association',
            merchantId: 'mer_release_association',
            providerId: 'prv_release_association',
            status: 'scheduled',
            startsAt: '2026-08-04T10:00:00.000Z',
            endsAt: '2026-08-04T11:00:00.000Z',
            createdAt: '2026-08-03T10:00:00.000Z',
            updatedAt: '2026-08-03T10:00:00.000Z'
          })
          yield* db
            .update(appointmentFoundations)
            .set({ origin: 'public_booking', customerNote: 'Booking-owned note' })
            .where(eq(appointmentFoundations.appointmentId, 'apt_release_association'))
          const statements = yield* prepareAppointmentCustomerAssociation(db, {
            merchantId: 'mer_release_association',
            appointment: {
              id: 'apt_release_association',
              details: {
                name: 'Snapshot Customer',
                email: 'snapshot@example.com',
                phone: null,
                note: 'Directory must not replace this'
              }
            },
            origin: 'merchant_created',
            actor: { merchantMemberId: 'usr_release_association' },
            now: '2026-08-03T12:00:00.000Z'
          })
          yield* batch(db, statements)
        }),
        layerFromD1(test.d1)
      )
    )

    const foundation = await test.d1
      .prepare(
        `SELECT customer_record_id, origin, customer_note
         FROM appointment_foundations WHERE appointment_id = ?`
      )
      .bind('apt_release_association')
      .first<{
        customer_record_id: string | null
        origin: string
        customer_note: string | null
      }>()
    expect(foundation).toMatchObject({
      customer_record_id: expect.any(String),
      origin: 'public_booking',
      customer_note: 'Booking-owned note'
    })
  })
})
