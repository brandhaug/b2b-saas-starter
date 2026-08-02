import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database, layerFromD1, merchants } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import { LiveCustomerDirectory } from './adapters.ts'
import { CustomerDirectory } from './customer-directory.ts'

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
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Customer Directory contract', () => {
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
})
