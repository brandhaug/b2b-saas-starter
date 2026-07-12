import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { SeedWalkIns } from './adapters.ts'
import { WalkIns } from './index.ts'

const now = '2026-07-12T10:00:00.000Z'
const enroll = (phone: string, shopId = 'shp_downtown') =>
  Effect.gen(function* () {
    const walkIns = yield* WalkIns
    return yield* walkIns.enroll({
      shopId,
      serviceId: 'svc_cut',
      providerPreference: { kind: 'any' },
      customerDetails: {
        name: 'Mara Ionescu',
        email: 'mara@example.test',
        phone
      },
      locale: 'en'
    })
  })

const layer = () =>
  SeedWalkIns({
    now: () => now,
    configurations: [
      {
        shopId: 'shp_downtown',
        open: true,
        eligibleServiceIds: ['svc_cut'],
        eligibleProviderIds: ['prv_ana'],
        averageServiceMinutes: 15,
        acknowledgmentTtlMinutes: 60
      },
      {
        shopId: 'shp_uptown',
        open: true,
        eligibleServiceIds: ['svc_cut'],
        eligibleProviderIds: ['prv_ana'],
        averageServiceMinutes: 15,
        acknowledgmentTtlMinutes: 60
      }
    ]
  })

describe('Walk-ins', () => {
  it('enrolls once and derives position and wait from ordered active entries', async () => {
    const runtime = layer()
    const first = await Effect.runPromise(
      enroll('+40711111111').pipe(Effect.provide(runtime))
    )
    const second = await Effect.runPromise(
      enroll('+40722222222').pipe(Effect.provide(runtime))
    )

    expect(first.acknowledgment.capability).toHaveLength(64)
    expect(second.entry).toMatchObject({ status: 'waiting', position: 2 })
    expect(second.entry.projectedWaitMinutes).toBe(15)
    expect(second.notificationIntent).toMatchObject({
      topic: 'walk-in.enrolled',
      sourceId: second.entry.id
    })
  })

  it('rejects a duplicate active contact deterministically', async () => {
    const runtime = layer()
    const first = await Effect.runPromise(
      enroll('+40711111111').pipe(Effect.provide(runtime))
    )
    const duplicate = await Effect.runPromise(
      Effect.result(enroll('+40 711 111 111').pipe(Effect.provide(runtime)))
    )

    expect(duplicate).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'WalkInDuplicate', entryId: first.entry.id }
    })
  })

  it('preserves lifecycle history and shop isolation', async () => {
    const runtime = layer()
    const first = await Effect.runPromise(
      enroll('+40711111111').pipe(Effect.provide(runtime))
    )
    const called = await Effect.runPromise(
      Effect.gen(function* () {
        const walkIns = yield* WalkIns
        return yield* walkIns.transition({
          shopId: 'shp_downtown',
          entryId: first.entry.id,
          to: 'called'
        })
      }).pipe(Effect.provide(runtime))
    )
    const denied = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const walkIns = yield* WalkIns
          return yield* walkIns.transition({
            shopId: 'shp_uptown',
            entryId: first.entry.id,
            to: 'serving'
          })
        }).pipe(Effect.provide(runtime))
      )
    )

    expect(called.entry.status).toBe('called')
    expect(called.entry.history.map((event) => event.to)).toEqual(['waiting', 'called'])
    expect(denied).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'WalkInEntryNotFound' }
    })
  })
})
