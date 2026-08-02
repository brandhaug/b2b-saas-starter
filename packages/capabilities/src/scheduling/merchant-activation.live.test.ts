import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  testMerchantContext,
  type MerchantContext
} from '../merchant-catalog/merchant-context.ts'
import {
  LiveMerchantActivation,
  MerchantActivation,
  launchBookingPolicies
} from './merchant-activation.ts'
import { LiveScheduling, Scheduling } from './scheduling.ts'

let test: TestD1
const merchant = {
  id: 'mer_activation_live',
  publicName: 'Activation Studio',
  slug: 'activation-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo' as const
}
const now = '2026-08-03T00:00:00.000Z'

const run = <A, E>(
  effect: Effect.Effect<A, E, MerchantActivation | Scheduling | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        LiveMerchantActivation,
        LiveScheduling,
        testMerchantContext(merchant)
      ).pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    `INSERT INTO user (id,email,name,emailVerified,identityClass,createdAt,updatedAt)
     VALUES ('usr_activation','owner@activation.test','Owner',1,'merchant_member',unixepoch(),unixepoch())`,
    `INSERT INTO merchants (id,public_name,slug,status,timezone,currency,plan,created_at,updated_at)
     VALUES ('${merchant.id}','${merchant.publicName}','${merchant.slug}','enabled','${merchant.timezone}','RON','solo','${now}','${now}')`,
    `INSERT INTO merchant_memberships (merchant_id,user_id,role,created_at)
     VALUES ('${merchant.id}','usr_activation','owner','${now}')`,
    `INSERT INTO brands (id,merchant_id,name,created_at,updated_at)
     VALUES ('brd_activation','${merchant.id}','Activation Studio','${now}','${now}')`,
    `INSERT INTO shops (id,brand_id,merchant_id,slug,public_name,timezone,currency,created_at,updated_at)
     VALUES ('shp_activation','brd_activation','${merchant.id}','${merchant.slug}','${merchant.publicName}','${merchant.timezone}','RON','${now}','${now}')`,
    `INSERT INTO shop_addresses (id,shop_id,address_json,created_at,updated_at)
     VALUES ('sad_activation','shp_activation','{}','${now}','${now}')`,
    `INSERT INTO providers (id,merchant_id,linked_user_id,display_name,status,is_default,created_at,updated_at)
     VALUES ('prv_activation','${merchant.id}','usr_activation','Owner Provider','active',1,'${now}','${now}')`,
    `INSERT INTO services (id,merchant_id,name,category,price_minor,currency,duration_minutes,status,booking_config_json,created_at,updated_at)
     VALUES ('svc_activation','${merchant.id}','Haircut','Hair','5000','RON',30,'active','{"beforeBufferMinutes":5,"afterBufferMinutes":5}','${now}','${now}')`,
    ...Array.from(
      { length: 7 },
      (_, weekday) =>
        `INSERT INTO schedule_rules (id,merchant_id,provider_id,weekday,start_time,end_time,created_at,updated_at)
         VALUES ('sch_activation_${weekday}','${merchant.id}','prv_activation',${weekday},'09:00','17:00','${now}','${now}')`
    ),
    `INSERT INTO public_booking_pages (id,merchant_id,status,created_at,updated_at)
     VALUES ('pg_activation','${merchant.id}','unpublished','${now}','${now}')`,
    `INSERT INTO merchant_subscriptions
     (id,merchant_id,plan,interval,status,trial_ends_at,revision,created_at,updated_at)
     VALUES ('sub_activation','${merchant.id}','solo','monthly','trialing','2026-08-17T00:00:00.000Z',1,'${now}','${now}')`,
    `INSERT INTO transactional_email_evidence
     (id,merchant_id,owner_user_id,idempotency_key,purpose,locale,template_key,masked_destination,sender_identity,status,attempted_at,attempt_count,retryable,accepted_at,updated_at)
     VALUES ('tee_activation','${merchant.id}','usr_activation','activation-live','owner_activation_test','en','owner_activation_test_en_v1','o***@activation.test','no-reply@beesolo.test','accepted','${now}',1,0,'${now}','${now}')`
  ]
  for (const statement of statements) await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Solo Merchant Activation', () => {
  it('derives progress, runs a side-effect-free Launch Test, and publishes once atomically', async () => {
    const activation = await run(
      Effect.gen(function* () {
        const service = yield* MerchantActivation
        const initial = yield* service.read()
        const business = yield* service.saveBusinessDetails({
          expectedRevision: initial.revision,
          publicName: merchant.publicName,
          slug: merchant.slug,
          country: 'RO',
          line1: 'Strada Test 10',
          locality: 'București',
          postalCode: '010101',
          publicPhone: '+40 700 000 000'
        })
        return yield* service.saveConfirmations({
          expectedRevision: business.revision,
          ownerProviderConfirmed: true,
          dateOverridesReviewed: true,
          policies: launchBookingPolicies,
          policiesConfirmed: true
        })
      })
    )
    expect(activation.progress.resumeAt).toBe('launch-test')

    const availability = await run(
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.availability({
          providerId: 'prv_activation',
          serviceId: 'svc_activation',
          from: now,
          days: 2
        })
      )
    )
    const startsAt = availability.slots[0]!.startsAt
    const before = await test.d1
      .prepare(
        `SELECT
         (SELECT count(*) FROM appointments) appointments,
         (SELECT count(*) FROM customer_records) customers,
         (SELECT count(*) FROM time_slot_holds) holds,
         (SELECT count(*) FROM booking_outbox) outbox_count`
      )
      .first<Record<string, number>>()

    await run(
      Effect.flatMap(MerchantActivation, (service) =>
        service.runLaunchTest({
          providerId: 'prv_activation',
          serviceId: 'svc_activation',
          startsAt,
          customer: { name: 'Preview Customer', email: 'preview@example.test' }
        })
      )
    )
    const after = await test.d1
      .prepare(
        `SELECT
         (SELECT count(*) FROM appointments) appointments,
         (SELECT count(*) FROM customer_records) customers,
         (SELECT count(*) FROM time_slot_holds) holds,
         (SELECT count(*) FROM booking_outbox) outbox_count`
      )
      .first<Record<string, number>>()
    expect(after).toEqual(before)

    await run(
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.saveProviderRules(
          'prv_activation',
          Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            startTime: '09:00',
            endTime: '17:00'
          }))
        )
      )
    )
    const stale = await run(
      Effect.flatMap(MerchantActivation, (service) => Effect.flip(service.publish()))
    )
    expect(stale._tag).toBe('ActivationNotReady')
    expect(
      await test.d1
        .prepare(`SELECT status FROM public_booking_pages WHERE merchant_id=?`)
        .bind(merchant.id)
        .first()
    ).toEqual({ status: 'unpublished' })
    const refreshedAvailability = await run(
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.availability({
          providerId: 'prv_activation',
          serviceId: 'svc_activation',
          from: now,
          days: 2
        })
      )
    )
    await run(
      Effect.flatMap(MerchantActivation, (service) =>
        service.runLaunchTest({
          providerId: 'prv_activation',
          serviceId: 'svc_activation',
          startsAt: refreshedAvailability.slots[0]!.startsAt,
          customer: { name: 'Preview Customer', email: 'preview@example.test' }
        })
      )
    )

    const first = await run(
      Effect.flatMap(MerchantActivation, (service) => service.publish())
    )
    const replay = await run(
      Effect.flatMap(MerchantActivation, (service) => service.publish())
    )
    expect(replay.firstActivatedAt).toBe(first.firstActivatedAt)
    expect(
      await test.d1
        .prepare(
          `SELECT count(*) count FROM merchant_activation_history
           WHERE merchant_id=? AND kind='first_published'`
        )
        .bind(merchant.id)
        .first<{ count: number }>()
    ).toEqual({ count: 1 })
    expect(
      await test.d1
        .prepare(`SELECT status FROM public_booking_pages WHERE merchant_id=?`)
        .bind(merchant.id)
        .first()
    ).toEqual({ status: 'published' })
  }, 60_000)
})
