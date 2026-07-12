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
      `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, booking_config_json, created_at, updated_at) VALUES ('shp_walk', 'brd_walk', 'mrc_walk', 'walk', 'Walk', 'UTC', 'EUR', '{"walkIns":{"open":true,"eligibleServiceIds":["svc_cut"],"eligibleProviderIds":[],"averageServiceMinutes":20,"acknowledgmentTtlMinutes":60,"entryTtlMinutes":240}}', '${now}', '${now}')`
    ),
    test.d1.prepare(
      `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, booking_config_json, created_at, updated_at) VALUES ('shp_other', 'brd_walk', 'mrc_walk', 'other', 'Other', 'UTC', 'EUR', '{"walkIns":{"open":true,"eligibleServiceIds":[],"eligibleProviderIds":[],"averageServiceMinutes":20,"acknowledgmentTtlMinutes":60,"entryTtlMinutes":240}}', '${now}', '${now}')`
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

  it('derives a stable total order for concurrent distinct enrollments', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const attempt = (suffix: string) =>
      Effect.runPromise(
        Effect.flatMap(WalkIns, (walkIns) =>
          walkIns.enroll({
            shopId: 'shp_walk',
            serviceId: 'svc_cut',
            providerPreference: { kind: 'any' },
            customerDetails: {
              name: suffix,
              email: `${suffix}@example.test`,
              phone: `+40777${suffix.padStart(6, '0')}`
            },
            locale: 'en'
          })
        ).pipe(Effect.provide(layer))
      )
    const enrolled = await Promise.all([attempt('101'), attempt('102'), attempt('103')])
    const ids = new Set(enrolled.map(({ entry }) => entry.id))
    const read = () =>
      Effect.runPromise(
        Effect.flatMap(WalkIns, (walkIns) => walkIns.queue('shp_walk')).pipe(
          Effect.provide(layer)
        )
      )
    const first = (await read()).filter(({ id }) => ids.has(id))
    const second = (await read()).filter(({ id }) => ids.has(id))
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id))
    expect(new Set(first.map(({ position }) => position)).size).toBe(3)
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
        "UPDATE protected_access_grants SET expires_at = '2026-07-12T09:00:00.000Z' WHERE resource_id = ?"
      )
      .bind(enrolled.entry.id)
      .run()
    const notDue = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.expireEntries({
          shopId: 'shp_walk',
          now: '2026-07-12T12:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )
    expect(notDue.some(({ id }) => id === enrolled.entry.id)).toBe(false)
    await test.d1
      .prepare(
        "UPDATE walk_in_entries SET expires_at = '2026-07-12T09:00:00.000Z' WHERE id = ?"
      )
      .bind(enrolled.entry.id)
      .run()
    const expired = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.expireEntries({
          shopId: 'shp_walk',
          now: '2026-07-12T12:00:00.000Z'
        })
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

  it('keeps protected reads and lifecycle commands isolated by Shop', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const enrolled = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.enroll({
          shopId: 'shp_walk',
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Scope',
            email: 'scope@example.test',
            phone: '+40788888888'
          },
          locale: 'en'
        })
      ).pipe(Effect.provide(layer))
    )
    const [read, transition] = await Promise.all([
      Effect.runPromise(
        Effect.result(
          Effect.flatMap(WalkIns, (walkIns) =>
            walkIns.inspect({
              shopId: 'shp_other',
              entryId: enrolled.entry.id,
              capability: enrolled.acknowledgment.capability
            })
          ).pipe(Effect.provide(layer))
        )
      ),
      Effect.runPromise(
        Effect.result(
          Effect.flatMap(WalkIns, (walkIns) =>
            walkIns.transition({
              shopId: 'shp_other',
              entryId: enrolled.entry.id,
              to: 'called'
            })
          ).pipe(Effect.provide(layer))
        )
      )
    ])
    expect(read).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'WalkInEntryNotFound' }
    })
    expect(transition).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'WalkInEntryNotFound' }
    })
  })

  it('records repeated call cycles as distinct lifecycle notification events', async () => {
    const layer = LiveWalkIns.pipe(Layer.provide(layerFromD1(test.d1)))
    const enrolled = await Effect.runPromise(
      Effect.flatMap(WalkIns, (walkIns) =>
        walkIns.enroll({
          shopId: 'shp_walk',
          serviceId: 'svc_cut',
          providerPreference: { kind: 'any' },
          customerDetails: {
            name: 'Recall',
            email: 'recall@example.test',
            phone: '+40766666666'
          },
          locale: 'en'
        })
      ).pipe(Effect.provide(layer))
    )
    const move = (to: 'called' | 'waiting') =>
      Effect.runPromise(
        Effect.flatMap(WalkIns, (walkIns) =>
          walkIns.transition({
            shopId: 'shp_walk',
            entryId: enrolled.entry.id,
            to
          })
        ).pipe(Effect.provide(layer))
      )
    await move('called')
    await move('waiting')
    await move('called')
    const intents = await test.d1
      .prepare(
        "SELECT deduplication_key FROM notification_intents WHERE source_id = ? AND topic = 'walk-in.called'"
      )
      .bind(enrolled.entry.id)
      .all<{ deduplication_key: string }>()
    expect(intents.results).toHaveLength(2)
    expect(
      new Set(intents.results.map(({ deduplication_key }) => deduplication_key)).size
    ).toBe(2)
  })
})
