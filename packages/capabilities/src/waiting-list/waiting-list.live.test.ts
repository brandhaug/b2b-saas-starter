import { Effect, Layer, Result } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveWaitingList } from './adapters.ts'
import { AvailabilityOfferUnavailable, WaitingList } from './waiting-list.ts'

let test: TestD1
const now = '2026-07-12T12:00:00.000Z'
const layer = () => LiveWaitingList.pipe(Layer.provide(layerFromD1(test.d1)))
const run = <A>(effect: Effect.Effect<A, unknown, WaitingList>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer())))

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_wait', 'Wait Shop', 'wait-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_wait', 'mrc_wait', 'Wait Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_wait', 'brd_wait', 'mrc_wait', 'downtown', 'Wait Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, booking_access, is_default, created_at, updated_at) VALUES ('prv_wait', 'mrc_wait', 'Jordan', 'active', 'public', 1, '${now}', '${now}')`,
    `INSERT INTO services (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at) VALUES ('svc_wait', 'mrc_wait', 'Cut', 5000, 'USD', 30, 'active', '${now}', '${now}')`,
    `INSERT INTO provider_service_eligibility (merchant_id, provider_id, service_id, created_at) VALUES ('mrc_wait', 'prv_wait', 'svc_wait', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Waiting List', () => {
  it('stores only a capability hash and atomically accepts exactly once', async () => {
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* waitingList.apply({
          id: 'wla_live',
          merchantSlug: 'wait-shop',
          shopId: 'shp_wait',
          capability: 'application-secret',
          request: {
            serviceIds: ['svc_wait'],
            providerPreference: { kind: 'specific', providerId: 'prv_wait' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-20T00:00:00.000Z'
          },
          customer: { name: 'Ada', email: 'ada@example.com' },
          now,
          expiresAt: '2026-07-21T00:00:00.000Z'
        })
        yield* waitingList.offer({
          id: 'avo_live',
          applicationId: 'wla_live',
          slot: {
            shopId: 'shp_wait',
            serviceIds: ['svc_wait'],
            providerId: 'prv_wait',
            startsAt: '2026-07-14T09:00:00.000Z',
            endsAt: '2026-07-14T09:30:00.000Z'
          },
          capability: 'offer-secret',
          now,
          expiresAt: '2026-07-13T00:00:00.000Z'
        })
      })
    )
    const grant = await test.d1
      .prepare(
        `SELECT capability_hash capabilityHash FROM protected_access_grants WHERE resource_id = 'avo_live'`
      )
      .first<{ capabilityHash: string }>()
    expect(grant?.capabilityHash).not.toBe('offer-secret')

    await run(
      Effect.flatMap(WaitingList, (waitingList) =>
        waitingList.exchangeOfferAccess({
          offerId: 'avo_live',
          presentedCapability: 'offer-secret',
          cookieCapability: 'cookie-secret',
          now: '2026-07-12T12:04:00.000Z'
        })
      )
    )
    await expect(
      run(
        Effect.flatMap(WaitingList, (waitingList) =>
          waitingList.exchangeOfferAccess({
            offerId: 'avo_live',
            presentedCapability: 'offer-secret',
            cookieCapability: 'another-cookie',
            now: '2026-07-12T12:04:00.000Z'
          })
        )
      )
    ).rejects.toBeInstanceOf(AvailabilityOfferUnavailable)

    const accept = () =>
      Effect.runPromise(
        Effect.result(
          Effect.flatMap(WaitingList, (waitingList) =>
            waitingList.acceptOffer(
              'avo_live',
              'cookie-secret',
              '2026-07-12T12:05:00.000Z'
            )
          )
        ).pipe(Effect.provide(layer()))
      )
    const outcomes = await Promise.all([accept(), accept()])
    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1)
    expect(outcomes.filter(Result.isFailure)).toHaveLength(1)
    const sessions = await test.d1
      .prepare(`SELECT count(*) count FROM booking_sessions`)
      .first<{ count: number }>()
    const holds = await test.d1
      .prepare(`SELECT count(*) count FROM time_slot_holds`)
      .first<{ count: number }>()
    expect(sessions?.count).toBe(1)
    expect(holds?.count).toBe(1)
    expect(outcomes.find(Result.isFailure)?.failure).toBeInstanceOf(
      AvailabilityOfferUnavailable
    )
  })
})
