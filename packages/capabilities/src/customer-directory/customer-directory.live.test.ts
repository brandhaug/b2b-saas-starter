import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  appointments,
  batch,
  layerFromD1,
  merchants,
  providers
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import { LiveCustomerDirectory } from './adapters.ts'
import { CustomerDirectory } from './customer-directory.ts'
import { prepareAppointmentCustomerAssociation } from './appointment-association.ts'

let test: TestD1
const merchant = Layer.succeed(MerchantContext)({
  id: 'mer_customer_live',
  publicName: 'Customer Studio',
  slug: 'customer-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo'
})
const layer = () =>
  Layer.merge(LiveCustomerDirectory.pipe(Layer.provide(layerFromD1(test.d1))), merchant)
const run = <A, E>(effect: Effect.Effect<A, E, CustomerDirectory | MerchantContext>) =>
  Effect.runPromise(Effect.provide(effect, layer()))

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_customer_live',
          publicName: 'Customer Studio',
          slug: 'customer-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo',
          createdAt: '2026-08-02T10:00:00.000Z',
          updatedAt: '2026-08-02T10:00:00.000Z'
        })
        yield* db.insert(providers).values({
          id: 'prv_customer_live',
          merchantId: 'mer_customer_live',
          displayName: 'Owner',
          status: 'active',
          isDefault: true,
          createdAt: '2026-08-02T10:00:00.000Z',
          updatedAt: '2026-08-02T10:00:00.000Z'
        })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Customer Directory contract', () => {
  it('converges same-contact associations prepared from one pre-batch view', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values(
            ['apt_converge_1', 'apt_converge_2'].map((id, index) => ({
              id,
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'scheduled' as const,
              startsAt: `2026-07-0${index + 3}T10:00:00.000Z`,
              endsAt: `2026-07-0${index + 3}T11:00:00.000Z`,
              createdAt: '2026-07-03T10:00:00.000Z',
              updatedAt: '2026-07-03T10:00:00.000Z'
            }))
          )
          const prepared = yield* Effect.all(
            ['apt_converge_1', 'apt_converge_2'].map((id) =>
              prepareAppointmentCustomerAssociation(db, {
                merchantId: 'mer_customer_live',
                appointment: {
                  id,
                  details: {
                    name: 'Same Customer',
                    email: 'same@example.com',
                    phone: null
                  }
                },
                origin: 'merchant_created',
                now: '2026-07-03T12:00:00.000Z'
              })
            )
          )
          yield* batch(db, prepared.flat())
        }),
        layerFromD1(test.d1)
      )
    )

    const links = await test.d1
      .prepare(
        `SELECT DISTINCT customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_converge_1','apt_converge_2')`
      )
      .all<{ customer_record_id: string }>()
    expect(links.results).toHaveLength(1)
  })

  it('persists matching, revisions, attributed history, and idempotent recovery', async () => {
    const created = await run(
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        return yield* service.matchOrCreate({
          appointmentId: 'apt_live_1',
          details: { name: 'Mara Ionescu', email: 'MARA@example.com', phone: null },
          now: '2026-08-02T10:00:00.000Z'
        })
      })
    )

    const updated = await run(
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const command = {
          expectedRevision: 1,
          idempotencyKey: 'note-live-1',
          actorId: 'usr_owner',
          text: 'Prefers quiet appointments',
          now: '2026-08-02T11:00:00.000Z'
        }
        const first = yield* service.addNote(created.record.id, command)
        const replay = yield* service.addNote(created.record.id, command)
        return { first, replay }
      })
    )

    expect(updated.first.revision).toBe(2)
    expect(updated.replay.notes).toHaveLength(1)
    expect(updated.replay.history.at(-1)).toMatchObject({
      kind: 'note_added',
      actorId: 'usr_owner'
    })

    const restored = await run(
      Effect.flatMap(CustomerDirectory, (service) => service.search('mara@example.com'))
    )
    expect(restored[0]?.id).toBe(created.record.id)
    expect(restored[0]?.notes[0]?.text).toBe('Prefers quiet appointments')
  })

  it('moves relational Appointment associations through merge and split', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values([
            {
              id: 'apt_merge_left',
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'completed',
              startsAt: '2026-07-01T10:00:00.000Z',
              endsAt: '2026-07-01T11:00:00.000Z',
              createdAt: '2026-07-01T10:00:00.000Z',
              updatedAt: '2026-07-01T10:00:00.000Z'
            },
            {
              id: 'apt_merge_right',
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'completed',
              startsAt: '2026-07-02T10:00:00.000Z',
              endsAt: '2026-07-02T11:00:00.000Z',
              createdAt: '2026-07-02T10:00:00.000Z',
              updatedAt: '2026-07-02T10:00:00.000Z'
            }
          ])
          for (const [id, name, email] of [
            ['apt_merge_left', 'Alex Left', 'left@example.com'],
            ['apt_merge_right', 'Alex Right', 'right@example.com']
          ] as const) {
            const statements = yield* prepareAppointmentCustomerAssociation(db, {
              merchantId: 'mer_customer_live',
              appointment: { id, details: { name, email, phone: null } },
              origin: 'record_completed',
              now: '2026-08-02T12:00:00.000Z'
            })
            yield* batch(db, statements)
          }
        }),
        layerFromD1(test.d1)
      )
    )

    const result = await run(
      Effect.gen(function* () {
        const directory = yield* CustomerDirectory
        const left = (yield* directory.search('left@example.com'))[0]!
        const right = (yield* directory.search('right@example.com'))[0]!
        const merged = yield* directory.merge({
          survivorId: left.id,
          absorbedId: right.id,
          expectedSurvivorRevision: left.revision,
          expectedAbsorbedRevision: right.revision,
          idempotencyKey: 'merge-live-links',
          actorId: 'usr_owner',
          reason: 'Confirmed duplicate',
          now: '2026-08-02T13:00:00.000Z'
        })
        const moved = merged.observations.find(
          (observation) => observation.appointmentId === 'apt_merge_right'
        )!
        return yield* directory.split({
          sourceId: merged.id,
          observationIds: [moved.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-live-links',
          actorId: 'usr_owner',
          reason: 'Mistaken merge',
          now: '2026-08-02T14:00:00.000Z'
        })
      })
    )

    const links = await test.d1
      .prepare(
        `SELECT appointment_id, customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_merge_left','apt_merge_right')
         ORDER BY appointment_id`
      )
      .all<{ appointment_id: string; customer_record_id: string }>()
    expect(links.results).toEqual([
      {
        appointment_id: 'apt_merge_left',
        customer_record_id: result.source.id
      },
      {
        appointment_id: 'apt_merge_right',
        customer_record_id: result.created.id
      }
    ])
  })
})
