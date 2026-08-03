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
    `INSERT INTO user (id, email, name, emailVerified) VALUES ('usr_wait', 'wait@example.test', 'Jordan', 1)`,
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_wait', 'Wait Shop', 'wait-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at) VALUES ('mrc_wait', 'usr_wait', 'owner', '${now}')`,
    `INSERT INTO merchant_subscriptions (id, merchant_id, plan, interval, status, created_at, updated_at) VALUES ('sub_wait', 'mrc_wait', 'solo', 'monthly', 'active', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_wait', 'mrc_wait', 'Wait Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_wait', 'brd_wait', 'mrc_wait', 'downtown', 'Wait Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, linked_user_id, display_name, status, booking_access, is_default, created_at, updated_at) VALUES ('prv_wait', 'mrc_wait', 'usr_wait', 'Jordan', 'active', 'public', 1, '${now}', '${now}')`,
    `INSERT INTO services (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at) VALUES ('svc_wait', 'mrc_wait', 'Cut', 5000, 'USD', 30, 'active', '${now}', '${now}')`,
    `INSERT OR IGNORE INTO provider_service_eligibility (merchant_id, provider_id, service_id, created_at) VALUES ('mrc_wait', 'prv_wait', 'svc_wait', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Waiting List', () => {
  it('blocks new applications during Restricted Access', async () => {
    await test.d1
      .prepare(
        "UPDATE merchant_subscriptions SET status = 'restricted' WHERE merchant_id = 'mrc_wait'"
      )
      .run()
    await expect(
      run(
        Effect.flatMap(WaitingList, (waitingList) =>
          waitingList.apply({
            id: 'wla_restricted',
            merchantSlug: 'wait-shop',
            shopId: 'shp_wait',
            capability: 'restricted-secret',
            request: {
              serviceIds: ['svc_wait'],
              providerPreference: { kind: 'specific', providerId: 'prv_wait' },
              from: '2026-07-13T00:00:00.000Z',
              until: '2026-07-14T00:00:00.000Z'
            },
            customer: { name: 'Blocked', email: 'blocked@example.com' },
            now,
            expiresAt: '2026-07-15T00:00:00.000Z'
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'CapabilityDenied', reason: 'restricted_access' })
    const blockedRows = await test.d1.batch([
      test.d1
        .prepare('SELECT count(*) AS count FROM waiting_list_applications WHERE id=?')
        .bind('wla_restricted'),
      test.d1
        .prepare(
          'SELECT count(*) AS count FROM protected_access_grants WHERE resource_id=?'
        )
        .bind('wla_restricted')
    ])
    expect(blockedRows.map((result) => result.results[0])).toEqual([
      { count: 0 },
      { count: 0 }
    ])
    await test.d1
      .prepare(
        "UPDATE merchant_subscriptions SET status = 'active' WHERE merchant_id = 'mrc_wait'"
      )
      .run()
  })

  it('pauses offers and supersedes a pending offer during Restricted Access', async () => {
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* waitingList.apply({
          id: 'wla_restricted_offer',
          merchantSlug: 'wait-shop',
          shopId: 'shp_wait',
          capability: 'restricted-offer-application-secret',
          request: {
            serviceIds: ['svc_wait'],
            providerPreference: { kind: 'specific', providerId: 'prv_wait' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-14T00:00:00.000Z'
          },
          customer: { name: 'Existing', email: 'existing@example.com' },
          now,
          expiresAt: '2026-07-15T00:00:00.000Z'
        })
        yield* waitingList.offer({
          id: 'avo_before_restriction',
          applicationId: 'wla_restricted_offer',
          slot: {
            shopId: 'shp_wait',
            serviceIds: ['svc_wait'],
            providerId: 'prv_wait',
            startsAt: '2026-07-13T09:00:00.000Z',
            endsAt: '2026-07-13T09:30:00.000Z'
          },
          capability: 'restricted-offer-secret',
          now,
          expiresAt: '2026-07-12T13:00:00.000Z'
        })
      })
    )
    await test.d1
      .prepare(
        "UPDATE merchant_subscriptions SET status = 'restricted' WHERE merchant_id = 'mrc_wait'"
      )
      .run()
    await expect(
      run(
        Effect.flatMap(WaitingList, (waitingList) =>
          waitingList.offer({
            id: 'avo_during_restriction',
            applicationId: 'wla_restricted_offer',
            slot: {
              shopId: 'shp_wait',
              serviceIds: ['svc_wait'],
              providerId: 'prv_wait',
              startsAt: '2026-07-13T09:30:00.000Z',
              endsAt: '2026-07-13T10:00:00.000Z'
            },
            capability: 'blocked-secret',
            now: '2026-07-12T12:05:00.000Z',
            expiresAt: '2026-07-12T13:05:00.000Z'
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'CapabilityDenied', reason: 'restricted_access' })
    const pending = await test.d1
      .prepare(
        "SELECT status FROM availability_offers WHERE id = 'avo_before_restriction'"
      )
      .first<{ status: string }>()
    expect(pending?.status).toBe('superseded')
    await test.d1
      .prepare(
        "UPDATE merchant_subscriptions SET status = 'active' WHERE merchant_id = 'mrc_wait'"
      )
      .run()
    await run(
      Effect.flatMap(WaitingList, (waitingList) =>
        waitingList.withdraw(
          'wla_restricted_offer',
          'restricted-offer-application-secret',
          '2026-07-12T12:06:00.000Z'
        )
      )
    )
  })

  it('derives and delivers one deterministic offer per eligible application', async () => {
    await test.d1
      .prepare(
        `INSERT INTO schedule_rules (id, merchant_id, provider_id, weekday, start_time, end_time, created_at, updated_at) VALUES ('scr_wait', 'mrc_wait', 'prv_wait', 1, '09:00', '10:00', '${now}', '${now}')`
      )
      .run()
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* waitingList.apply({
          id: 'wla_delivery',
          merchantSlug: 'wait-shop',
          shopId: 'shp_wait',
          capability: 'application-delivery',
          request: {
            serviceIds: ['svc_wait'],
            providerPreference: { kind: 'specific', providerId: 'prv_wait' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-14T00:00:00.000Z'
          },
          customer: { name: 'Grace', email: 'grace@example.com' },
          now,
          expiresAt: '2026-07-15T00:00:00.000Z'
        })
        const first = yield* waitingList.deliverAvailable(now, {
          currentKeyId: 'v1',
          legacyKeyId: 'v1',
          keys: { v1: 'delivery-key' }
        })
        yield* Effect.promise(() =>
          test.d1
            .prepare(
              "UPDATE availability_offers SET slot_json = json_remove(slot_json, '$.deliveryKeyId') WHERE waiting_list_application_id = 'wla_delivery'"
            )
            .run()
        )
        const retry = yield* waitingList.deliverAvailable(now, {
          currentKeyId: 'v2',
          legacyKeyId: 'v1',
          keys: { v1: 'delivery-key', v2: 'rotated-key' }
        })
        expect(first).toHaveLength(1)
        expect(first[0]?.offer.slot.startsAt).toBe('2026-07-13T09:00:00.000Z')
        expect(retry).toHaveLength(1)
        expect(retry[0]?.capability).toBe(first[0]?.capability)
      })
    )
  })

  it('does not cancel an offer notification after a worker claims it', async () => {
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* waitingList.apply({
          id: 'wla_claimed_expiry',
          merchantSlug: 'wait-shop',
          shopId: 'shp_wait',
          capability: 'claimed-expiry-application',
          request: {
            serviceIds: ['svc_wait'],
            providerPreference: { kind: 'specific', providerId: 'prv_wait' },
            from: '2026-07-13T00:00:00.000Z',
            until: '2026-07-14T00:00:00.000Z'
          },
          customer: { name: 'Lin', email: 'lin@example.com' },
          now,
          expiresAt: '2026-07-15T00:00:00.000Z'
        })
        yield* waitingList.offer({
          id: 'avo_claimed_expiry',
          applicationId: 'wla_claimed_expiry',
          slot: {
            shopId: 'shp_wait',
            serviceIds: ['svc_wait'],
            providerId: 'prv_wait',
            startsAt: '2026-07-13T09:00:00.000Z',
            endsAt: '2026-07-13T09:30:00.000Z'
          },
          capability: 'claimed-expiry-offer',
          now,
          expiresAt: '2026-07-12T12:01:00.000Z'
        })
        expect(
          yield* waitingList.claimOfferDelivery(
            'avo_claimed_expiry',
            '2026-07-12T12:00:30.000Z'
          )
        ).toBe(true)
        yield* waitingList.expire('2026-07-12T12:02:00.000Z')
      })
    )
    const intent = await test.d1
      .prepare(
        "SELECT status FROM notification_intents WHERE source_type = 'availability-offer' AND source_id = 'avo_claimed_expiry'"
      )
      .first<{ status: string }>()
    expect(intent?.status).toBe('processing')
  })

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
