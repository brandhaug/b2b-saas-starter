import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveWalkIns } from './adapters.ts'
import { WalkIns } from './index.ts'

let test: TestD1
const now = '2026-07-12T10:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await test.d1.batch([
    test.d1.prepare(
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_walk', 'Walk', 'walk', 'UTC', 'EUR', 'solo', '${now}', '${now}')`
    ),
    test.d1.prepare(
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_walk', 'mrc_walk', 'Walk', '${now}', '${now}')`
    ),
    test.d1.prepare(
      `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, booking_config_json, created_at, updated_at) VALUES ('shp_walk', 'brd_walk', 'mrc_walk', 'walk', 'Walk', 'UTC', 'EUR', '{"walkIns":{"open":true,"eligibleServiceIds":["svc_cut"],"eligibleProviderIds":[],"averageServiceMinutes":20,"acknowledgmentTtlMinutes":60}}', '${now}', '${now}')`
    ),
    test.d1.prepare(
      `INSERT INTO services (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at) VALUES ('svc_cut', 'mrc_walk', 'Signature cut', 2500, 'EUR', 20, 'active', '${now}', '${now}')`
    ),
    test.d1.prepare(
      `INSERT INTO shop_services (shop_id, service_id, created_at) VALUES ('shp_walk', 'svc_cut', '${now}')`
    )
  ])
})

afterAll(async () => test.dispose())

describe('Live Walk-ins', () => {
  it('derives enrollment options from active Shop catalog state', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const overview = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) => walkIns.overview('shp_walk')).pipe(
        Effect.provide(layer)
      )
    )
    expect(overview.state).toBe('open')
    expect(overview.services).toEqual([{ id: 'svc_cut', name: 'Signature cut' }])
  })

  it('atomically persists enrollment, protected access, lifecycle, and intents', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const enrolled = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.enroll({
          shopId: 'shp_walk',
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Mara',
            email: 'mara@example.test',
            phone: '+40711111111'
          },
          locale: 'en'
        })
      ).pipe(Effect.provide(layer))
    )
    const called = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.transition({
          shopId: 'shp_walk',
          entryId: enrolled.entry.id,
          to: 'called'
        })
      ).pipe(Effect.provide(layer))
    )
    const privateView = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.inspect({
          shopId: 'shp_walk',
          entryId: enrolled.entry.id,
          capability: enrolled.acknowledgment.capability
        })
      ).pipe(Effect.provide(layer))
    )
    expect(called.entry.status).toBe('called')
    expect(privateView.position).toBe(1)
    expect(privateView.projectedWaitMinutes).toBe(0)
    const persisted = await test.d1.batch([
      test.d1
        .prepare('SELECT * FROM lifecycle_history WHERE aggregate_id = ?')
        .bind(enrolled.entry.id),
      test.d1
        .prepare('SELECT * FROM notification_intents WHERE source_id = ?')
        .bind(enrolled.entry.id)
    ])
    expect(persisted[0]!.results).toHaveLength(2)
    expect(persisted[1]!.results).toHaveLength(2)
  })

  it('converges concurrent duplicate enrollments on one active entry', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const attempt = (phone: string) =>
      Effect.runPromise(
        Effect.result(
          Effect.flatMap(WalkIns, (walkIns) =>
            walkIns.enroll({
              shopId: 'shp_walk',
              serviceId: 'svc_cut',
              providerPreference: { kind: 'any' },
              customerDetails: { name: 'Ana', email: 'ana@example.test', phone },
              locale: 'en'
            })
          ).pipe(Effect.provide(layer))
        )
      )
    const results = await Promise.all([
      attempt('+40722222222'),
      attempt('+40 722 222 222')
    ])
    expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1)
    expect(results.filter((result) => result._tag === 'Failure')).toHaveLength(1)
  })

  it('expires due protected acknowledgments deterministically', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const enrolled = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.enroll({
          shopId: 'shp_walk',
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Due',
            email: 'due@example.test',
            phone: '+40799999999'
          },
          locale: 'en'
        })
      ).pipe(Effect.provide(layer))
    )
    await test.d1
      .prepare(
        "UPDATE protected_access_grants SET expires_at = '2026-07-12T09:00:00.000Z' WHERE resource_type = 'walk-in-entry' AND resource_id = ?"
      )
      .bind(enrolled.entry.id)
      .run()
    const expired = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.expireAcknowledgments('2026-07-12T12:00:00.000Z')
      ).pipe(Effect.provide(layer))
    )
    expect(expired.length).toBeGreaterThan(0)
    expect(expired.every((entry) => entry.status === 'expired')).toBe(true)
  })

  it('maps malformed persisted requests to a typed unavailable failure', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    await test.d1
      .prepare(
        `INSERT INTO walk_in_entries (id, shop_id, status, position, request_json, customer_snapshot_json, created_at, updated_at) VALUES ('wie_invalid', 'shp_walk', 'served', 99, '{"providerPreference":{"kind":"invalid"}}', '{}', '${now}', '${now}')`
      )
      .run()
    const result = await Effect.runPromise(
      Effect.result(
        Effect.flatMap(WalkIns, (walkIns) =>
          walkIns.findById({ shopId: 'shp_walk', entryId: 'wie_invalid' })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'CapabilityUnavailable', reason: 'invalid-persisted-request' }
    })
  })
})
