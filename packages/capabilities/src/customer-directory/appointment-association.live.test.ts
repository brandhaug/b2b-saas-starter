import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  batch,
  layerFromD1,
  merchantMemberships,
  merchants,
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
          id: 'usr_owner',
          name: 'Owner',
          email: 'owner@association.test',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date('2026-08-03T09:00:00.000Z'),
          updatedAt: new Date('2026-08-03T09:00:00.000Z')
        })
        yield* db.insert(merchants).values({
          id: 'mer_association_actor',
          publicName: 'Actor Studio',
          slug: 'actor-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo',
          createdAt: '2026-08-03T09:00:00.000Z',
          updatedAt: '2026-08-03T09:00:00.000Z'
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_association_actor',
          userId: 'usr_owner',
          role: 'owner',
          createdAt: '2026-08-03T09:00:00.000Z'
        })
      }),
      layerFromD1(test.d1)
    )
  )
  await test.d1
    .prepare(
      `INSERT INTO providers
         (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`
    )
    .bind(
      'prv_association_actor',
      'mer_association_actor',
      'usr_owner',
      'Owner',
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T09:00:00.000Z'
    )
    .run()
  await test.d1
    .prepare(
      `INSERT INTO appointments
         (id, merchant_id, provider_id, status, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?)`
    )
    .bind(
      'apt_attributed_association',
      'mer_association_actor',
      'prv_association_actor',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T11:00:00.000Z',
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T09:00:00.000Z'
    )
    .run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Appointment Customer association', () => {
  it('attributes Merchant-created history to the acting member and Operator', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          const statements = yield* prepareAppointmentCustomerAssociation(db, {
            merchantId: 'mer_association_actor',
            appointment: {
              id: 'apt_attributed_association',
              details: {
                name: 'Attributed Customer',
                email: 'attributed@example.com',
                phone: null
              }
            },
            origin: 'merchant_created',
            actor: {
              merchantMemberId: 'usr_owner',
              impersonatedBy: 'opr_support'
            },
            now: '2026-08-03T09:00:00.000Z'
          })
          yield* batch(db, statements)
        }),
        layerFromD1(test.d1)
      )
    )

    const history = await test.d1
      .prepare(
        `SELECT actor_id, impersonated_by
         FROM customer_directory_history
         WHERE id = 'cuh_apt_attributed_association'`
      )
      .first<{ actor_id: string; impersonated_by: string | null }>()
    expect(history).toEqual({
      actor_id: 'usr_owner',
      impersonated_by: 'opr_support'
    })
  })
})
